import { RateLimiter, sleep } from './rateLimiter';
import { WbError } from './errors';
import type {
  WbOrder,
  WbSale,
  WbStock,
  WbReportRow,
  WbCard,
  WbCardsResponse,
  WbAdvCampaignCount,
  WbAdvFullStat,
} from './types';

const HOST = {
  statistics: 'https://statistics-api.wildberries.ru',
  content: 'https://content-api.wildberries.ru',
  advert: 'https://advert-api.wildberries.ru',
} as const;

// Lenient spacing for non-statistics endpoints (statistics use the strict default).
const LENIENT_INTERVAL_MS = 1_500;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 4;

export interface WbClientOptions {
  apiKey: string;
  minIntervalMs: number; // strict spacing for statistics endpoints (~60s)
  maxPages: number; // anti-infinite-loop cap per export
  rateLimiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  logger?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface PagedResult<T> {
  rows: T[];
  pages: number;
  truncated: boolean; // hit the maxPages safety cap before exhausting data
}

export class WbClient {
  private readonly apiKey: string;
  private readonly rl: RateLimiter;
  private readonly maxPages: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string, extra?: Record<string, unknown>) => void;

  constructor(opts: WbClientOptions) {
    this.apiKey = opts.apiKey;
    this.maxPages = opts.maxPages;
    this.rl = opts.rateLimiter ?? new RateLimiter(opts.minIntervalMs);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.logger ?? (() => undefined);
  }

  // ── low-level request with retry + error mapping ──────────────────────────
  private async request<T>(args: {
    host: string;
    path: string;
    method?: 'GET' | 'POST';
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    rlKey: string;
    intervalMs?: number;
  }): Promise<T> {
    const { host, path, method = 'GET', query, body, rlKey, intervalMs } = args;
    const url = new URL(path, host);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const endpoint = `${method} ${url.pathname}`;

    return this.rl.schedule(
      rlKey,
      async () => {
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          attempt++;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          try {
            const res = await this.fetchImpl(url.toString(), {
              method,
              headers: {
                Authorization: this.apiKey,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            if (res.status === 401) {
              throw new WbError('AUTH', 'Wildberries rejected the API key (401)', 401, endpoint);
            }
            if (res.status === 400) {
              const text = await safeText(res);
              throw new WbError('BAD_REQUEST', `Bad request (400): ${text}`, 400, endpoint);
            }
            if (res.status === 429) {
              if (attempt > MAX_RETRIES) {
                throw new WbError('RATE_LIMIT', 'Rate limited (429)', 429, endpoint);
              }
              const retryAfter = Number(res.headers.get('retry-after')) || 0;
              const backoff = Math.max(retryAfter * 1000, this.backoffMs(attempt));
              this.log('wb 429, backing off', { endpoint, attempt, backoff });
              await sleep(backoff);
              continue;
            }
            if (res.status >= 500) {
              if (attempt > MAX_RETRIES) {
                throw new WbError('SERVER', `WB server error (${res.status})`, res.status, endpoint);
              }
              await sleep(this.backoffMs(attempt));
              continue;
            }
            if (!res.ok) {
              const text = await safeText(res);
              throw new WbError('SERVER', `Unexpected status ${res.status}: ${text}`, res.status, endpoint);
            }

            // 204 / empty body → empty
            const text = await res.text();
            if (!text) return [] as unknown as T;
            try {
              return JSON.parse(text) as T;
            } catch {
              throw new WbError('PARSE', 'Could not parse WB response as JSON', res.status, endpoint);
            }
          } catch (err) {
            if (err instanceof WbError) throw err;
            // Network / abort error → retry a few times, then surface.
            if (attempt > MAX_RETRIES) {
              throw new WbError('NETWORK', `Network error: ${(err as Error).message}`, undefined, endpoint);
            }
            await sleep(this.backoffMs(attempt));
          } finally {
            clearTimeout(timer);
          }
        }
      },
      intervalMs,
    );
  }

  private backoffMs(attempt: number): number {
    // 2s, 4s, 8s, 16s (+ jitter)
    return 1000 * 2 ** attempt + Math.floor(Math.random() * 500);
  }

  // ── statistics: orders ────────────────────────────────────────────────────
  async fetchOrders(dateFromIso: string): Promise<PagedResult<WbOrder>> {
    return this.paginateStat<WbOrder>('orders', '/api/v1/supplier/orders', dateFromIso, (r) => r.srid);
  }

  async fetchSales(dateFromIso: string): Promise<PagedResult<WbSale>> {
    return this.paginateStat<WbSale>('sales', '/api/v1/supplier/sales', dateFromIso, (r) => r.saleID);
  }

  /**
   * Shared cursor pagination for orders/sales (spec / API notes §3–4).
   * Terminates on: no new rows, cursor not advancing, or the maxPages safety cap.
   */
  private async paginateStat<T extends { lastChangeDate: string }>(
    rlKey: string,
    path: string,
    dateFromIso: string,
    idOf: (row: T) => string,
  ): Promise<PagedResult<T>> {
    const rows: T[] = [];
    const seen = new Set<string>();
    let cursor = dateFromIso;
    let pages = 0;
    let truncated = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.request<T[]>({
        host: HOST.statistics,
        path,
        query: { dateFrom: cursor, flag: 0 },
        rlKey: `stat:${rlKey}`,
      });
      pages++;
      if (!Array.isArray(page) || page.length === 0) break;

      let newRows = 0;
      let maxChange = cursor;
      for (const row of page) {
        const id = idOf(row);
        if (!seen.has(id)) {
          seen.add(id);
          rows.push(row);
          newRows++;
        }
        if (row.lastChangeDate > maxChange) maxChange = row.lastChangeDate;
      }

      if (newRows === 0) break; // no progress → done
      if (pages >= this.maxPages) {
        truncated = true;
        this.log('wb pagination hit maxPages', { path, pages });
        break;
      }
      // Advance cursor; bump by 1s if stuck on an identical lastChangeDate.
      cursor = maxChange === cursor ? bumpIsoSeconds(cursor, 1) : maxChange;
    }

    return { rows, pages, truncated };
  }

  // ── statistics: stocks (current snapshot) ─────────────────────────────────
  async fetchStocks(dateFromIso: string): Promise<WbStock[]> {
    const res = await this.request<WbStock[]>({
      host: HOST.statistics,
      path: '/api/v1/supplier/stocks',
      query: { dateFrom: dateFromIso },
      rlKey: 'stat:stocks',
    });
    return Array.isArray(res) ? res : [];
  }

  // ── statistics: financial report (rrdid pagination) ───────────────────────
  async fetchReportDetail(dateFrom: string, dateTo: string): Promise<PagedResult<WbReportRow>> {
    const rows: WbReportRow[] = [];
    const seen = new Set<number>();
    let rrdid = 0;
    let pages = 0;
    let truncated = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.request<WbReportRow[]>({
        host: HOST.statistics,
        path: '/api/v5/supplier/reportDetailByPeriod',
        query: { dateFrom, dateTo, rrdid, limit: 100000 },
        rlKey: 'stat:report',
      });
      pages++;
      if (!Array.isArray(page) || page.length === 0) break;

      let maxRrd = rrdid;
      let newRows = 0;
      for (const row of page) {
        if (typeof row.rrd_id === 'number' && !seen.has(row.rrd_id)) {
          seen.add(row.rrd_id);
          rows.push(row);
          newRows++;
        }
        if (typeof row.rrd_id === 'number' && row.rrd_id > maxRrd) maxRrd = row.rrd_id;
      }

      if (newRows === 0 || maxRrd <= rrdid) break; // no progress (handles non-monotonic rrd_id)
      if (pages >= this.maxPages) {
        truncated = true;
        break;
      }
      rrdid = maxRrd;
    }

    return { rows, pages, truncated };
  }

  // ── content: product cards ────────────────────────────────────────────────
  async fetchCards(): Promise<WbCard[]> {
    const cards: WbCard[] = [];
    const limit = 100;
    let updatedAt: string | undefined;
    let nmID: number | undefined;
    let pages = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const body = {
        settings: {
          cursor: { limit, ...(updatedAt ? { updatedAt } : {}), ...(nmID ? { nmID } : {}) },
          filter: { withPhoto: -1 },
        },
      };
      const resp = await this.request<WbCardsResponse>({
        host: HOST.content,
        path: '/content/v2/get/cards/list',
        method: 'POST',
        body,
        rlKey: 'content:cards',
        intervalMs: LENIENT_INTERVAL_MS,
      });
      const batch = resp.cards ?? [];
      cards.push(...batch);
      pages++;
      if (batch.length < limit || pages >= this.maxPages) break;
      updatedAt = resp.cursor?.updatedAt;
      nmID = resp.cursor?.nmID;
      if (!updatedAt && !nmID) break;
    }
    return cards;
  }

  // ── advertising: campaigns + per-nm stats (v3) ────────────────────────────
  async fetchAdvCampaignIds(): Promise<number[]> {
    const resp = await this.request<WbAdvCampaignCount>({
      host: HOST.advert,
      path: '/adv/v1/promotion/count',
      rlKey: 'adv:count',
      intervalMs: LENIENT_INTERVAL_MS,
    });
    const ids: number[] = [];
    for (const group of resp.adverts ?? []) {
      for (const a of group.advert_list ?? []) ids.push(a.advertId);
    }
    return ids;
  }

  async fetchAdvFullStats(
    ids: number[],
    beginDate: string,
    endDate: string,
  ): Promise<WbAdvFullStat[]> {
    if (ids.length === 0) return [];
    const out: WbAdvFullStat[] = [];
    // Chunk ids to keep the query string sane.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const resp = await this.request<WbAdvFullStat[]>({
        host: HOST.advert,
        path: '/adv/v3/fullstats',
        query: { ids: chunk.join(','), beginDate, endDate },
        rlKey: 'adv:fullstats',
        intervalMs: LENIENT_INTERVAL_MS,
      });
      if (Array.isArray(resp)) out.push(...resp);
    }
    return out;
  }

  /** Lightweight validation used when a key is connected (spec: show key is valid). */
  async validateKey(): Promise<boolean> {
    // A cheap statistics call with a recent dateFrom; 401 → invalid.
    const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await this.request<WbStock[]>({
      host: HOST.statistics,
      path: '/api/v1/supplier/stocks',
      query: { dateFrom },
      rlKey: 'stat:stocks',
    });
    return true;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** Add seconds to an RFC3339/ISO timestamp string, preserving format loosely. */
export function bumpIsoSeconds(iso: string, seconds: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(d.getTime() + seconds * 1000).toISOString();
}
