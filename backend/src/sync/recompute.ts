import type { Db } from '../db';
import { mskDateString, addDaysStr, parseDateStr } from '../domain/dates';
import { type DayPoint, type ResolvedSupplySettings } from '../domain/supply';
import { salePriceFromSale } from '../domain/finance';
import { computeProductView, summarizeFinanceWindow, type FinanceLite } from '../services/economics';
import {
  inTransitQty,
  type SupplyState,
  type SupplyStatus,
} from '../domain/supplyTracking';
import {
  resolveSupplySettings,
  resolveTaxPercent,
  DEFAULT_SUPPLY_DEFAULTS,
  type GlobalSupplyDefaults,
  type ProductSupplyOverride,
} from '../services/settings';
import { currentUnitCost } from '../services/cost';

/** Convert a Prisma Decimal | number | null to a plain number | null. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  return Number(v as { toString(): string });
}
function n0(v: unknown): number {
  return toNum(v) ?? 0;
}

/**
 * Recompute ProductAnalytics for one user from the stored raw data. Pure data
 * loading + domain functions + persistence — no business math is done here, it
 * all lives in src/domain (anti-duplication, spec 0.4).
 */
export async function recomputeUser(prisma: Db, userId: string, now: Date = new Date()): Promise<number> {
  const today = mskDateString(now);
  const windowStart = addDaysStr(today, -40);
  const windowStartDate = parseDateStr(windowStart);

  const [products, settingsRow, productSettings, costs, supplies, sales, snapshots, finance, ads] =
    await Promise.all([
      prisma.product.findMany({ where: { userId } }),
      prisma.supplySettings.findUnique({ where: { userId } }),
      prisma.productSettings.findMany({ where: { userId } }),
      prisma.productCost.findMany({ where: { userId } }),
      prisma.supply.findMany({ where: { userId } }),
      prisma.saleRow.findMany({ where: { userId, date: { gte: windowStartDate } } }),
      prisma.stockSnapshot.findMany({ where: { userId, date: { gte: windowStartDate } } }),
      prisma.financeRow.findMany({
        where: {
          userId,
          OR: [{ rrDt: { gte: windowStartDate } }, { dateFrom: { gte: windowStartDate } }],
        },
      }),
      prisma.adStat.findMany({ where: { userId, date: { gte: windowStartDate } } }),
    ]);

  const global: GlobalSupplyDefaults = settingsRow
    ? {
        leadTimeDays: settingsRow.leadTimeDays,
        orderBufferDays: settingsRow.orderBufferDays,
        orderQuantum: settingsRow.orderQuantum,
        targetStockDays: settingsRow.targetStockDays,
        taxPercent: n0(settingsRow.taxPercent),
      }
    : DEFAULT_SUPPLY_DEFAULTS;

  const overrideByNm = new Map(productSettings.map((p) => [p.nmId, p]));
  const costsByNm = new Map<number, { unitCost: number; effectiveFrom: Date }[]>();
  for (const c of costs) {
    const list = costsByNm.get(c.nmId) ?? [];
    list.push({ unitCost: n0(c.unitCost), effectiveFrom: c.effectiveFrom });
    costsByNm.set(c.nmId, list);
  }

  const suppliesByNm = new Map<number, SupplyState[]>();
  for (const s of supplies) {
    const list = suppliesByNm.get(s.nmId) ?? [];
    list.push({
      id: s.id,
      quantity: s.quantity,
      acceptedQty: s.acceptedQty,
      expectedDate: mskDateString(s.expectedDate),
      orderDate: mskDateString(s.orderDate),
      status: s.status as SupplyStatus,
      watchAfterZero: s.watchAfterZero,
    });
    suppliesByNm.set(s.nmId, list);
  }

  // Sales grouped by nmId/day (non-returns) + fallback revenue per nmId/day.
  const salesCountByNm = new Map<number, Map<string, number>>();
  const salesPriceByNm = new Map<number, Map<string, number>>();
  for (const sale of sales) {
    if (sale.isReturn) continue;
    const day = mskDateString(sale.date);
    const cmap = salesCountByNm.get(sale.nmId) ?? new Map();
    cmap.set(day, (cmap.get(day) ?? 0) + 1);
    salesCountByNm.set(sale.nmId, cmap);

    const price = salePriceFromSale({
      finishedPrice: toNum(sale.finishedPrice),
      priceWithDisc: toNum(sale.priceWithDisc),
      totalPrice: toNum(sale.totalPrice),
      discountPercent: toNum(sale.discountPercent),
      forPay: toNum(sale.forPay),
    });
    if (price != null) {
      const pmap = salesPriceByNm.get(sale.nmId) ?? new Map();
      pmap.set(day, (pmap.get(day) ?? 0) + price);
      salesPriceByNm.set(sale.nmId, pmap);
    }
  }

  // Stock snapshots grouped by nmId/day + latest snapshot per nmId.
  const stockByNm = new Map<number, Map<string, number>>();
  const latestStock = new Map<number, { date: string; quantity: number }>();
  for (const snap of snapshots) {
    const day = mskDateString(snap.date);
    const smap = stockByNm.get(snap.nmId) ?? new Map();
    smap.set(day, snap.quantity);
    stockByNm.set(snap.nmId, smap);
    const cur = latestStock.get(snap.nmId);
    if (!cur || day > cur.date) latestStock.set(snap.nmId, { date: day, quantity: snap.quantity });
  }

  // Finance rows grouped by nmId.
  const financeByNm = new Map<number, typeof finance>();
  for (const row of finance) {
    if (row.nmId == null) continue;
    const list = financeByNm.get(row.nmId) ?? [];
    list.push(row);
    financeByNm.set(row.nmId, list);
  }

  // Ad spend grouped by nmId (within 30 days).
  const last30 = new Set<string>();
  for (let i = 0; i < 30; i++) last30.add(addDaysStr(today, -i));
  const adByNm = new Map<number, number>();
  const adEstimatedByNm = new Set<number>();
  for (const a of ads) {
    const day = mskDateString(a.date);
    if (!last30.has(day)) continue;
    adByNm.set(a.nmId, (adByNm.get(a.nmId) ?? 0) + n0(a.spend));
    if (a.source === 'ALLOCATED') adEstimatedByNm.add(a.nmId);
  }
  const hasAnyAds = ads.length > 0;

  let computed = 0;
  for (const product of products) {
    const nmId = product.nmId;
    const overrideRow = overrideByNm.get(nmId) ?? null;
    const override: ProductSupplyOverride | null = overrideRow
      ? {
          leadTimeDays: overrideRow.leadTimeDays,
          orderBufferDays: overrideRow.orderBufferDays,
          orderQuantum: overrideRow.orderQuantum,
          targetStockDays: overrideRow.targetStockDays,
          taxPercent: toNum(overrideRow.taxPercent),
          active: overrideRow.active,
        }
      : null;
    const resolved: ResolvedSupplySettings = resolveSupplySettings(global, override);
    const taxPercent = resolveTaxPercent(global, override);

    const points = buildDayPoints(nmId, salesCountByNm, stockByNm);
    const currentStock = latestStock.get(nmId)?.quantity ?? 0;
    const inTransit = inTransitQty(suppliesByNm.get(nmId) ?? []);

    // 30-day sales aggregates
    let units30 = 0;
    const salesCount = salesCountByNm.get(nmId);
    if (salesCount) for (const day of last30) units30 += salesCount.get(day) ?? 0;

    let fallbackRevenue = 0;
    const salesPrice = salesPriceByNm.get(nmId);
    if (salesPrice) for (const day of last30) fallbackRevenue += salesPrice.get(day) ?? 0;

    const financeLite: FinanceLite[] = (financeByNm.get(nmId) ?? []).map((r) => ({
      docTypeName: r.docTypeName ?? null,
      quantity: r.quantity ?? 0,
      retailAmount: toNum(r.retailAmount),
      ppvzForPay: toNum(r.ppvzForPay),
      deliveryRub: toNum(r.deliveryRub),
      storageFee: toNum(r.storageFee),
      penalty: toNum(r.penalty),
      deduction: toNum(r.deduction),
      acceptance: toNum(r.acceptance),
      saleDt: r.saleDt,
      rrDt: r.rrDt,
      dateFrom: r.dateFrom,
    }));
    const finance = summarizeFinanceWindow(financeLite, last30);

    let missedDays = 0;
    const smap = stockByNm.get(nmId);
    if (smap) for (const day of last30) if (smap.get(day) === 0) missedDays++;

    const { metrics, economics, missedProfit: missed } = computeProductView({
      today,
      points,
      currentStock,
      inTransitQty: inTransit,
      settings: resolved,
      taxPercent,
      units30,
      finance,
      salesFallbackRevenue: fallbackRevenue > 0 ? fallbackRevenue : null,
      adSpend: adByNm.get(nmId) ?? (hasAnyAds ? 0 : null),
      hasAds: hasAnyAds,
      adEstimated: adEstimatedByNm.has(nmId),
      unitCost: currentUnitCost(costsByNm.get(nmId) ?? [], now),
      missedDays,
    });

    const data = {
      currentStock,
      inTransitQty: inTransit,
      v7: round4(metrics.v7),
      v14: round4(metrics.v14),
      v30: round4(metrics.v30),
      avgDailySales: round4(metrics.avgDailySales),
      daysOfStock: metrics.daysOfStock == null ? null : round2(metrics.daysOfStock),
      daysUntilOrder: metrics.daysUntilOrder,
      health: metrics.health,
      recommendedQty: metrics.recommendedQty,
      overstockQty: Math.round(metrics.overstockQty),
      deficitDate: metrics.deficitDate ? parseDateStr(metrics.deficitDate) : null,
      revenue30: round2(economics.revenue),
      profit30: economics.profit == null ? null : round2(economics.profit),
      units30,
      missedProfit30: round2(missed),
      dataQuality: economics.dataQuality,
      computedAt: now,
    };
    await prisma.productAnalytics.upsert({
      where: { userId_nmId: { userId, nmId } },
      create: { userId, nmId, ...data },
      update: data,
    });
    computed++;
  }

  return computed;
}

/** Build day points for a product from the dates that actually have data. */
function buildDayPoints(
  nmId: number,
  salesByNm: Map<number, Map<string, number>>,
  stockByNm: Map<number, Map<string, number>>,
): DayPoint[] {
  const salesMap = salesByNm.get(nmId);
  const stockMap = stockByNm.get(nmId);
  const dates = new Set<string>();
  if (salesMap) for (const d of salesMap.keys()) dates.add(d);
  if (stockMap) for (const d of stockMap.keys()) dates.add(d);

  const points: DayPoint[] = [];
  for (const date of dates) {
    points.push({
      date,
      sales: salesMap?.get(date) ?? 0,
      stock: stockMap?.has(date) ? (stockMap.get(date) as number) : null,
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
