/**
 * Advertising spend allocation (spec 9.4 — estimated distribution, flagged).
 *
 * WB's adv/v3/fullstats gives a reliable day-level total spend per campaign,
 * but the nested per-product (`nm`) breakdown can be incomplete or zeroed for
 * individual products — a documented WB-side quirk, especially on
 * auto-targeting campaigns (dev.wildberries.ru/forum/1441). Precise per-nm
 * spend is kept as-is. Any unattributed remainder for a campaign/day (day
 * total minus known per-nm spend) is split across that campaign's own
 * products, weighted by their precise spend share elsewhere in the fetched
 * window — so a campaign's full spend lands on its products instead of
 * disappearing. If a campaign never shows ANY product for the whole window,
 * its remainder cannot be attributed to a specific product and is reported
 * as unattributed rather than guessed (spec 0.4: no silent invented data).
 */

export interface AdCampaignDayInput {
  advertId: number;
  /** MSK day string, e.g. "2026-06-20". */
  date: string;
  /** WB's day-level total spend for the campaign; the source of truth for "how much". */
  totalSpend: number;
  nm: Array<{ nmId: number; spend: number; views: number; clicks: number; orders: number }>;
}

export type AdSpendSource = 'PRECISE' | 'ALLOCATED';

export interface AllocatedAdRow {
  nmId: number;
  date: string;
  spend: number;
  views: number;
  clicks: number;
  orders: number;
  source: AdSpendSource;
}

export interface AdAllocationResult {
  rows: AllocatedAdRow[];
  /** Campaign spend that could not be attributed to any product (no nm data anywhere in the window). */
  unattributed: Array<{ advertId: number; spend: number }>;
}

/**
 * Merge WB's real charged spend (from /adv/v1/upd — the billing write-off
 * history) into per-campaign/day inputs derived from adv/v3/fullstats.
 *
 * WB's adv/v3/fullstats is known to return zeroed `sum`/`views`/`clicks` while
 * still listing which products a campaign touched (dev.wildberries.ru/forum/1441,
 * BUG-0006). The /adv/v1/upd endpoint is the reliable "how much was actually
 * charged" source and is not affected by that bug. So we take spend from `upd`
 * (keyed by campaign+day) as the source of truth, and keep the `nm[]` product
 * breakdown from fullstats purely for *how it splits across products*. Downstream
 * `allocateAdSpend` then distributes the real spend across the campaign's
 * products (precisely where fullstats has non-zero per-nm data, otherwise
 * proportionally/equally — see below).
 *
 * `realSpendByCampDay` is keyed `${advertId}|${date}` (MSK day string).
 */
export function mergeRealSpend(
  fsCampDays: AdCampaignDayInput[],
  realSpendByCampDay: Map<string, number>,
): AdCampaignDayInput[] {
  const keyOf = (advertId: number, date: string) => `${advertId}|${date}`;
  const seen = new Set<string>();
  const merged: AdCampaignDayInput[] = [];

  for (const d of fsCampDays) {
    const key = keyOf(d.advertId, d.date);
    seen.add(key);
    const real = realSpendByCampDay.get(key);
    // Prefer the real charged amount; fall back to fullstats' own total when
    // upd has nothing for this campaign/day (no silent zeroing either way).
    merged.push({ ...d, totalSpend: real ?? d.totalSpend });
  }

  // Campaign/days that WB charged for but fullstats never reported at all:
  // keep the spend (it's real) with no product breakdown — allocateAdSpend
  // will report it as unattributed rather than invent an nmId.
  for (const [key, spend] of realSpendByCampDay) {
    if (seen.has(key)) continue;
    const [advertIdStr, date] = key.split('|');
    merged.push({ advertId: Number(advertIdStr), date, totalSpend: spend, nm: [] });
  }

  return merged;
}

export function allocateAdSpend(days: AdCampaignDayInput[]): AdAllocationResult {
  const byCampaign = new Map<number, AdCampaignDayInput[]>();
  for (const d of days) {
    const list = byCampaign.get(d.advertId) ?? [];
    list.push(d);
    byCampaign.set(d.advertId, list);
  }

  const rows: AllocatedAdRow[] = [];
  const unattributed: Array<{ advertId: number; spend: number }> = [];

  for (const [advertId, campaignDays] of byCampaign) {
    // Precise weight per nmId = total precise spend for that product across the whole window.
    const weightByNm = new Map<number, number>();
    for (const d of campaignDays) {
      for (const nm of d.nm) {
        weightByNm.set(nm.nmId, (weightByNm.get(nm.nmId) ?? 0) + Math.max(nm.spend, 0));
      }
    }
    const totalWeight = [...weightByNm.values()].reduce((a, b) => a + b, 0);
    const knownNmIds = [...weightByNm.keys()];

    for (const d of campaignDays) {
      // Merge nm entries within the day (a product can appear under multiple app types).
      const dayNm = new Map<number, { spend: number; views: number; clicks: number; orders: number }>();
      for (const nm of d.nm) {
        const cur = dayNm.get(nm.nmId) ?? { spend: 0, views: 0, clicks: 0, orders: 0 };
        cur.spend += nm.spend;
        cur.views += nm.views;
        cur.clicks += nm.clicks;
        cur.orders += nm.orders;
        dayNm.set(nm.nmId, cur);
      }
      let preciseTotal = 0;
      for (const [nmId, v] of dayNm) {
        preciseTotal += v.spend;
        // Skip empty rows (WB listed the product with nothing to report) — they
        // carry no information and would just add noise to AdStat.
        if (v.spend <= 0 && v.views <= 0 && v.clicks <= 0 && v.orders <= 0) continue;
        rows.push({ nmId, date: d.date, spend: v.spend, views: v.views, clicks: v.clicks, orders: v.orders, source: 'PRECISE' });
      }

      const remainder = Math.max(d.totalSpend - preciseTotal, 0);
      if (remainder <= 0) continue;

      if (totalWeight > 0) {
        for (const nmId of knownNmIds) {
          const share = (weightByNm.get(nmId) ?? 0) / totalWeight;
          const add = remainder * share;
          if (add <= 0) continue;
          rows.push({ nmId, date: d.date, spend: add, views: 0, clicks: 0, orders: 0, source: 'ALLOCATED' });
        }
      } else if (knownNmIds.length > 0) {
        // Every known nm had zero precise spend everywhere (e.g. WB listed the
        // product but zeroed its sum) — split the remainder equally among them.
        const share = remainder / knownNmIds.length;
        for (const nmId of knownNmIds) {
          rows.push({ nmId, date: d.date, spend: share, views: 0, clicks: 0, orders: 0, source: 'ALLOCATED' });
        }
      } else {
        unattributed.push({ advertId, spend: remainder });
      }
    }
  }

  return { rows, unattributed };
}
