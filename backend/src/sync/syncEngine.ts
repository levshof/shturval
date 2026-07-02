import type { Db } from '../db';
import { WbClient } from '../wb/client';
import { WbError, isWbAuthError } from '../wb/errors';
import type { WbStock } from '../wb/types';
import { decryptSecret } from '../lib/crypto';
import { mskDateString, addDaysStr, parseDateStr } from '../domain/dates';
import {
  arrivalIncrement,
  distributeArrival,
  nextSupplyStatus,
  type SupplyState,
  type SupplyStatus,
} from '../domain/supplyTracking';
import { allocateAdSpend, type AdCampaignDayInput, type AdSpendSource } from '../domain/ads';
import { guardStocks, guardTruncated } from './guards';
import { recomputeUser } from './recompute';

export interface SyncOptions {
  minIntervalMs: number;
  maxPages: number;
  historyDays: number;
  fetchImpl?: typeof fetch;
  logger?: (msg: string, extra?: Record<string, unknown>) => void;
}

type StepStatus = 'ok' | 'warn' | 'error' | 'skipped';
interface Step {
  status: StepStatus;
  message?: string;
  count?: number;
}
type Steps = Record<string, Step>;

/** Parse a Wildberries date string. WB statistics times are MSK; if the string
 *  has no timezone we append +03:00 so the stored UTC instant is correct. */
function parseWbDate(s: string | undefined | null): Date {
  if (!s) return new Date(0);
  // Date-only "YYYY-MM-DD" (WB uses this for date_from/date_to/rr_dt) has no
  // time part, so "YYYY-MM-DD+03:00" would be Invalid — treat it as MSK midnight.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00+03:00`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
      ? s
      : `${s}+03:00`;
  const d = new Date(iso);
  // Never hand an Invalid Date to Prisma — it rejects the whole createMany batch.
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Run a full synchronization for one user. Creates and owns the SyncRun record.
 * Phases are explicit: fetch → guard → persist → recompute. Hard failures mark
 * the run FAILED without wiping good data; soft issues become warnings.
 */
export async function runSync(prisma: Db, userId: string, opts: SyncOptions): Promise<string> {
  const log = opts.logger ?? (() => undefined);
  const now = new Date();
  const today = mskDateString(now);
  const steps: Steps = {};
  const stats: Record<string, number> = {};
  const criticalIssues: string[] = [];

  const run = await prisma.syncRun.create({
    data: { userId, status: 'RUNNING', startedAt: now, steps: steps as object },
  });

  const finish = async (
    status: 'SUCCESS' | 'FAILED',
    error?: string,
  ): Promise<string> => {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), steps: steps as object, stats: stats as object, error: error ?? null },
    });
    return run.id;
  };

  try {
    // ── key ───────────────────────────────────────────────────────────────
    const keyRow = await prisma.wbKey.findUnique({ where: { userId } });
    if (!keyRow) {
      steps.key = { status: 'error', message: 'API-ключ Wildberries не подключён' };
      return finish('FAILED', 'API-ключ Wildberries не подключён. Откройте Настройки и добавьте ключ.');
    }
    const apiKey = decryptSecret({
      ciphertext: keyRow.ciphertext,
      iv: keyRow.iv,
      authTag: keyRow.authTag,
    });

    const client = new WbClient({
      apiKey,
      minIntervalMs: opts.minIntervalMs,
      maxPages: opts.maxPages,
      fetchImpl: opts.fetchImpl,
      logger: log,
    });

    const dateFromIso = parseDateStr(addDaysStr(today, -opts.historyDays)).toISOString();
    const dateFromDay = addDaysStr(today, -opts.historyDays);

    // Previous successful sync time → used to estimate sales since last check.
    const prevSuccess = await prisma.syncRun.findFirst({
      where: { userId, status: 'SUCCESS', id: { not: run.id } },
      orderBy: { startedAt: 'desc' },
    });
    const prevSyncTime = prevSuccess?.finishedAt ?? null;

    // ── 1. orders ───────────────────────────────────────────────────────────
    const orders = await client.fetchOrders(dateFromIso);
    stats.orders = orders.rows.length;
    await persistOrders(prisma, userId, orders.rows);
    {
      const g = guardTruncated('Заказы', orders.truncated);
      steps.orders = { status: g.ok ? 'ok' : 'error', message: g.reason, count: orders.rows.length };
      if (!g.ok && g.reason) criticalIssues.push(g.reason);
    }

    // ── 2. sales ──────────────────────────────────────────────────────────
    const sales = await client.fetchSales(dateFromIso);
    stats.sales = sales.rows.length;
    await persistSales(prisma, userId, sales.rows);
    {
      const g = guardTruncated('Продажи', sales.truncated);
      steps.sales = { status: g.ok ? 'ok' : 'error', message: g.reason, count: sales.rows.length };
      if (!g.ok && g.reason) criticalIssues.push(g.reason);
    }

    // ── 3. stocks (current snapshot) ──────────────────────────────────────
    const stocks = await client.fetchStocks(dateFromIso);
    const aggregated = aggregateStocks(stocks);
    const prevSnapshotCount = await countLatestSnapshot(prisma, userId);
    const stockGuard = guardStocks(aggregated.size, prevSnapshotCount);
    let stocksWritten = false;
    if (stockGuard.ok) {
      await writeSnapshot(prisma, userId, today, aggregated);
      stocksWritten = true;
      steps.stocks = { status: 'ok', count: aggregated.size };
      stats.stockItems = aggregated.size;
    } else {
      steps.stocks = { status: 'error', message: stockGuard.reason, count: aggregated.size };
      if (stockGuard.reason) criticalIssues.push(stockGuard.reason);
    }

    // ── 4. finance report ─────────────────────────────────────────────────
    try {
      const finance = await client.fetchReportDetail(dateFromDay, today);
      stats.financeRows = finance.rows.length;
      await persistFinance(prisma, userId, finance.rows);
      const g = guardTruncated('Финансовый отчёт', finance.truncated);
      steps.finance = { status: g.ok ? 'ok' : 'warn', message: g.reason, count: finance.rows.length };
    } catch (err) {
      steps.finance = { status: 'warn', message: describeWbError(err, 'финансовый отчёт') };
    }

    // ── 5. advertising (soft: missing access is a warning, not a failure) ──
    try {
      const ids = await client.fetchAdvCampaignIds();
      if (ids.length === 0) {
        steps.ads = { status: 'warn', message: 'Рекламных кампаний не найдено' };
      } else {
        const adStats = await client.fetchAdvFullStats(ids, addDaysStr(today, -30), today);
        const adResult = await persistAds(prisma, userId, adStats);
        const unattributedNote =
          adResult.unattributedSpend > 0
            ? ` Не удалось привязать к товару ${Math.round(adResult.unattributedSpend)} ₽ расхода (кампании без разбивки по товарам за весь период).`
            : undefined;
        steps.ads = { status: 'ok', count: adResult.count, message: unattributedNote };
        stats.adRows = adResult.count;
      }
    } catch (err) {
      steps.ads = { status: 'warn', message: describeWbError(err, 'реклама') };
    }

    // ── 6. product master (content cards if available, else derived) ───────
    try {
      const cards = await client.fetchCards();
      await upsertProductsFromCards(prisma, userId, cards);
      steps.products = { status: 'ok', count: cards.length };
    } catch (err) {
      steps.products = { status: 'warn', message: describeWbError(err, 'карточки товаров') };
    }
    // Always backfill product master from statistics so nothing is missed.
    await upsertProductsFromStats(prisma, userId, aggregated, orders.rows, sales.rows);

    // ── 7. supply tracking (needs a fresh snapshot) ───────────────────────
    if (stocksWritten) {
      const salesSince = salesSinceByNm(sales.rows, prevSyncTime);
      const updated = await updateSupplyTracking(prisma, userId, today, aggregated, salesSince);
      steps.supplies = { status: 'ok', count: updated };
    } else {
      steps.supplies = { status: 'skipped', message: 'Пропущено: остатки не обновились' };
    }

    // ── 8. recompute analytics from the best available data ───────────────
    const computed = await recomputeUser(prisma, userId, now);
    steps.recompute = { status: 'ok', count: computed };
    stats.products = computed;

    if (criticalIssues.length > 0) {
      return finish('FAILED', criticalIssues.join(' '));
    }
    return finish('SUCCESS');
  } catch (err) {
    log('sync failed', { error: (err as Error).message });
    const message = isWbAuthError(err)
      ? 'Wildberries отклонил API-ключ (401). Проверьте ключ в Настройках.'
      : err instanceof WbError
        ? `Ошибка Wildberries: ${err.message}`
        : `Внутренняя ошибка синхронизации: ${(err as Error).message}`;
    steps.fatal = { status: 'error', message };
    return finish('FAILED', message);
  }
}

// ── persistence helpers ──────────────────────────────────────────────────────

async function persistOrders(prisma: Db, userId: string, rows: import('../wb/types').WbOrder[]) {
  if (rows.length === 0) return;
  const data = rows.map((o) => ({
    userId,
    srid: o.srid,
    nmId: o.nmId,
    supplierArticle: o.supplierArticle ?? '',
    date: parseWbDate(o.date),
    lastChangeDate: parseWbDate(o.lastChangeDate),
    isCancel: !!o.isCancel,
    totalPrice: o.totalPrice ?? null,
    discountPercent: o.discountPercent ?? null,
    finishedPrice: o.finishedPrice ?? null,
    priceWithDisc: o.priceWithDisc ?? null,
    warehouseName: o.warehouseName ?? null,
  }));
  for (const part of chunk(data, 1000)) {
    await prisma.orderRow.createMany({ data: part, skipDuplicates: true });
  }
  // Capture cancellations that flipped after first insert.
  const cancelled = rows.filter((o) => o.isCancel).map((o) => o.srid);
  for (const part of chunk(cancelled, 500)) {
    if (part.length) {
      await prisma.orderRow.updateMany({
        where: { userId, srid: { in: part } },
        data: { isCancel: true },
      });
    }
  }
}

async function persistSales(prisma: Db, userId: string, rows: import('../wb/types').WbSale[]) {
  if (rows.length === 0) return;
  const data = rows.map((s) => ({
    userId,
    saleID: s.saleID,
    nmId: s.nmId,
    supplierArticle: s.supplierArticle ?? '',
    date: parseWbDate(s.date),
    lastChangeDate: parseWbDate(s.lastChangeDate),
    isReturn: s.saleID?.startsWith('R') ?? false,
    forPay: s.forPay ?? null,
    finishedPrice: s.finishedPrice ?? null,
    priceWithDisc: s.priceWithDisc ?? null,
    totalPrice: s.totalPrice ?? null,
    discountPercent: s.discountPercent ?? null,
    warehouseName: s.warehouseName ?? null,
  }));
  for (const part of chunk(data, 1000)) {
    await prisma.saleRow.createMany({ data: part, skipDuplicates: true });
  }
}

async function persistFinance(prisma: Db, userId: string, rows: import('../wb/types').WbReportRow[]) {
  if (rows.length === 0) return;
  const data = rows
    .filter((r) => typeof r.rrd_id === 'number')
    .map((r) => ({
      userId,
      rrdId: BigInt(r.rrd_id),
      realizationReportId: r.realizationreport_id != null ? BigInt(r.realizationreport_id) : null,
      nmId: r.nm_id ?? null,
      supplierArticle: r.sa_name ?? null,
      docTypeName: r.doc_type_name ?? null,
      quantity: r.quantity ?? 0,
      retailPrice: r.retail_price ?? null,
      retailAmount: r.retail_amount ?? null,
      ppvzForPay: r.ppvz_for_pay ?? null,
      deliveryRub: r.delivery_rub ?? null,
      storageFee: r.storage_fee ?? null,
      penalty: r.penalty ?? null,
      deduction: r.deduction ?? null,
      acceptance: r.acceptance ?? null,
      returnAmount: r.return_amount ?? null,
      commissionPercent: r.commission_percent ?? null,
      dateFrom: r.date_from ? parseWbDate(r.date_from) : null,
      dateTo: r.date_to ? parseWbDate(r.date_to) : null,
      saleDt: r.sale_dt ? parseWbDate(r.sale_dt) : null,
      rrDt: r.rr_dt ? parseWbDate(r.rr_dt) : null,
    }));
  for (const part of chunk(data, 1000)) {
    await prisma.financeRow.createMany({ data: part, skipDuplicates: true });
  }
}

async function persistAds(
  prisma: Db,
  userId: string,
  stats: import('../wb/types').WbAdvFullStat[],
): Promise<{ count: number; unattributedSpend: number }> {
  // Build per-campaign/day inputs for the allocator: WB's day-level `sum` is
  // the reliable "how much was spent" figure; `nm[]` (merged across apps) is
  // "how it splits across products", which can be incomplete (BUG-0004).
  const campaignDays: AdCampaignDayInput[] = [];
  for (const camp of stats) {
    for (const day of camp.days ?? []) {
      const date = day.date ? mskDateString(parseWbDate(day.date)) : null;
      if (!date) continue;
      const nmRows = (day.apps ?? []).flatMap((app) =>
        (app.nm ?? []).map((nm) => ({
          nmId: nm.nmId,
          spend: nm.sum ?? 0,
          views: nm.views ?? 0,
          clicks: nm.clicks ?? 0,
          orders: nm.orders ?? 0,
        })),
      );
      const nmTotal = nmRows.reduce((s, r) => s + r.spend, 0);
      // Fall back to the precise total when WB gives no day-level figure, so
      // behaviour degrades to "precise only" (no invented allocation) rather
      // than guessing — see domain/ads.ts for the allocation rule itself.
      const totalSpend = day.sum ?? nmTotal;
      campaignDays.push({ advertId: camp.advertId, date, totalSpend, nm: nmRows });
    }
  }

  const { rows, unattributed } = allocateAdSpend(campaignDays);

  // Multiple campaigns can contribute to the same nmId/date/source — aggregate before upsert.
  const byKey = new Map<string, { nmId: number; date: string; spend: number; views: number; clicks: number; orders: number; source: AdSpendSource }>();
  for (const r of rows) {
    const key = `${r.nmId}|${r.date}|${r.source}`;
    const cur = byKey.get(key) ?? { nmId: r.nmId, date: r.date, spend: 0, views: 0, clicks: 0, orders: 0, source: r.source };
    cur.spend += r.spend;
    cur.views += r.views;
    cur.clicks += r.clicks;
    cur.orders += r.orders;
    byKey.set(key, cur);
  }

  let count = 0;
  for (const v of byKey.values()) {
    await prisma.adStat.upsert({
      where: { userId_nmId_date_source: { userId, nmId: v.nmId, date: parseDateStr(v.date), source: v.source } },
      create: {
        userId,
        nmId: v.nmId,
        date: parseDateStr(v.date),
        spend: v.spend,
        views: v.views,
        clicks: v.clicks,
        orders: v.orders,
        source: v.source,
      },
      update: { spend: v.spend, views: v.views, clicks: v.clicks, orders: v.orders },
    });
    count++;
  }
  const unattributedSpend = unattributed.reduce((s, u) => s + u.spend, 0);
  return { count, unattributedSpend };
}

// ── stocks helpers ───────────────────────────────────────────────────────────

interface AggStock {
  quantity: number;
  inWayToClient: number;
  quantityFull: number;
  supplierArticle: string;
  category?: string;
  subject?: string;
  brand?: string;
}

function aggregateStocks(stocks: WbStock[]): Map<number, AggStock> {
  const map = new Map<number, AggStock>();
  for (const s of stocks) {
    const cur =
      map.get(s.nmId) ??
      {
        quantity: 0,
        inWayToClient: 0,
        quantityFull: 0,
        supplierArticle: s.supplierArticle ?? '',
        category: s.category,
        subject: s.subject,
        brand: s.brand,
      };
    cur.quantity += s.quantity ?? 0;
    cur.inWayToClient += s.inWayToClient ?? 0;
    cur.quantityFull += s.quantityFull ?? 0;
    map.set(s.nmId, cur);
  }
  return map;
}

async function countLatestSnapshot(prisma: Db, userId: string): Promise<number> {
  const latest = await prisma.stockSnapshot.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (!latest) return 0;
  return prisma.stockSnapshot.count({ where: { userId, date: latest.date } });
}

async function writeSnapshot(prisma: Db, userId: string, today: string, agg: Map<number, AggStock>) {
  const date = parseDateStr(today);
  for (const [nmId, s] of agg) {
    await prisma.stockSnapshot.upsert({
      where: { userId_nmId_date: { userId, nmId, date } },
      create: {
        userId,
        nmId,
        date,
        quantity: s.quantity,
        inWayToClient: s.inWayToClient,
        quantityFull: s.quantityFull,
      },
      update: { quantity: s.quantity, inWayToClient: s.inWayToClient, quantityFull: s.quantityFull },
    });
  }
}

// ── product master helpers ───────────────────────────────────────────────────

async function upsertProductsFromCards(
  prisma: Db,
  userId: string,
  cards: import('../wb/types').WbCard[],
) {
  for (const c of cards) {
    const photo = c.photos?.[0]?.c246x328 ?? c.photos?.[0]?.square ?? c.photos?.[0]?.big ?? null;
    await prisma.product.upsert({
      where: { userId_nmId: { userId, nmId: c.nmID } },
      create: {
        userId,
        nmId: c.nmID,
        supplierArticle: c.vendorCode ?? '',
        brand: c.brand ?? null,
        title: c.title ?? null,
        subject: c.subjectName ?? null,
        category: c.subjectName ?? null,
        photoUrl: photo,
        source: 'CONTENT',
      },
      update: {
        supplierArticle: c.vendorCode || undefined,
        brand: c.brand ?? undefined,
        title: c.title ?? undefined,
        subject: c.subjectName ?? undefined,
        photoUrl: photo ?? undefined,
        source: 'CONTENT',
      },
    });
  }
}

async function upsertProductsFromStats(
  prisma: Db,
  userId: string,
  agg: Map<number, AggStock>,
  orders: import('../wb/types').WbOrder[],
  sales: import('../wb/types').WbSale[],
) {
  const info = new Map<number, { supplierArticle: string; category?: string; subject?: string; brand?: string }>();
  const add = (nmId: number, supplierArticle?: string, category?: string, subject?: string, brand?: string) => {
    if (!info.has(nmId)) info.set(nmId, { supplierArticle: supplierArticle ?? '', category, subject, brand });
  };
  for (const [nmId, s] of agg) add(nmId, s.supplierArticle, s.category, s.subject, s.brand);
  for (const o of orders) add(o.nmId, o.supplierArticle, o.category, o.subject, o.brand);
  for (const s of sales) add(s.nmId, s.supplierArticle, s.category, s.subject, s.brand);

  for (const [nmId, i] of info) {
    await prisma.product.upsert({
      where: { userId_nmId: { userId, nmId } },
      create: {
        userId,
        nmId,
        supplierArticle: i.supplierArticle,
        category: i.category ?? null,
        subject: i.subject ?? null,
        brand: i.brand ?? null,
        source: 'DERIVED',
      },
      // Only fill gaps; never overwrite richer Content data.
      update: {
        supplierArticle: i.supplierArticle || undefined,
        category: i.category ?? undefined,
        subject: i.subject ?? undefined,
        brand: i.brand ?? undefined,
      },
    });
  }
}

// ── supply tracking ──────────────────────────────────────────────────────────

function salesSinceByNm(sales: import('../wb/types').WbSale[], since: Date | null): Map<number, number> {
  const map = new Map<number, number>();
  if (!since) return map;
  for (const s of sales) {
    if (s.saleID?.startsWith('R')) continue;
    if (parseWbDate(s.date).getTime() >= since.getTime()) {
      map.set(s.nmId, (map.get(s.nmId) ?? 0) + 1);
    }
  }
  return map;
}

async function updateSupplyTracking(
  prisma: Db,
  userId: string,
  today: string,
  agg: Map<number, AggStock>,
  salesSince: Map<number, number>,
): Promise<number> {
  const active = await prisma.supply.findMany({
    where: { userId, status: { in: ['IN_TRANSIT', 'PARTIAL', 'DELAYED', 'WAIT_AFTER_ZERO'] } },
  });
  if (active.length === 0) return 0;

  // Group supplies by nmId.
  const byNm = new Map<number, typeof active>();
  for (const s of active) {
    const list = byNm.get(s.nmId) ?? [];
    list.push(s);
    byNm.set(s.nmId, list);
  }

  let updated = 0;
  for (const [nmId, group] of byNm) {
    const currentStock = agg.get(nmId)?.quantity ?? 0;
    const previousStock = group[0].lastCheckedStock; // shared per-nm baseline
    const states: SupplyState[] = group.map((s) => ({
      id: s.id,
      quantity: s.quantity,
      acceptedQty: s.acceptedQty,
      expectedDate: mskDateString(s.expectedDate),
      orderDate: mskDateString(s.orderDate),
      status: s.status as SupplyStatus,
      watchAfterZero: s.watchAfterZero,
    }));

    // Distribute arrival increment if we have a baseline.
    if (previousStock != null) {
      const increment = arrivalIncrement(currentStock, previousStock, salesSince.get(nmId) ?? 0);
      const dist = distributeArrival(states, increment);
      const addById = new Map(dist.map((d) => [d.id, d.addAccepted]));
      for (const st of states) st.acceptedQty += addById.get(st.id) ?? 0;
    }

    // Recompute status + persist.
    for (const st of states) {
      const status = nextSupplyStatus({ supply: st, today, currentStock });
      await prisma.supply.update({
        where: { id: st.id },
        data: { acceptedQty: st.acceptedQty, status, lastCheckedStock: currentStock },
      });
      updated++;
    }
  }
  return updated;
}

function describeWbError(err: unknown, source: string): string {
  if (isWbAuthError(err)) return `Нет доступа к разделу «${source}» (проверьте категории ключа)`;
  if (err instanceof WbError) return `Не удалось загрузить ${source}: ${err.message}`;
  return `Не удалось загрузить ${source}: ${(err as Error).message}`;
}
