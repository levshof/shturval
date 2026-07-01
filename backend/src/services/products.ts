import type { Db } from '../db';
import { num, num0, dateOnly } from '../http/serialize';
import { mskDateString, addDaysStr, parseDateStr, weekStartStr } from '../domain/dates';
import type { DayPoint, SupplyHealth } from '../domain/supply';
import { salePriceFromSale } from '../domain/finance';
import { earliestActiveArrival, type SupplyState, type SupplyStatus } from '../domain/supplyTracking';
import { computeProductView, summarizeFinanceWindow, type FinanceLite } from './economics';
import { resolveSupplySettings, resolveTaxPercent, DEFAULT_SUPPLY_DEFAULTS, type GlobalSupplyDefaults } from './settings';
import { currentUnitCost } from './cost';

const ACTIVE_SUPPLY: SupplyStatus[] = ['IN_TRANSIT', 'PARTIAL', 'DELAYED', 'WAIT_AFTER_ZERO'];

export type ProductFilter =
  | 'all'
  | 'no_stock'
  | 'critical'
  | 'order'
  | 'normal'
  | 'overstock'
  | 'archive';

export type ProductSort = 'article' | 'stock' | 'perDay' | 'days' | 'profit' | 'status';

const HEALTH_BY_FILTER: Record<string, SupplyHealth> = {
  no_stock: 'NO_STOCK',
  critical: 'CRITICAL',
  order: 'ORDER',
  normal: 'NORMAL',
  overstock: 'OVERSTOCK',
};

const STATUS_ORDER: Record<SupplyHealth, number> = {
  NO_STOCK: 0,
  CRITICAL: 1,
  ORDER: 2,
  NORMAL: 3,
  OVERSTOCK: 4,
};

export async function listProducts(
  prisma: Db,
  userId: string,
  params: { filter: ProductFilter; sort: ProductSort; search?: string },
) {
  const isArchiveView = params.filter === 'archive';
  const products = await prisma.product.findMany({
    where: { userId, archived: isArchiveView },
  });
  const analytics = await prisma.productAnalytics.findMany({ where: { userId } });
  const analyticsByNm = new Map(analytics.map((a) => [a.nmId, a]));
  const costNmIds = new Set(
    (await prisma.productCost.findMany({ where: { userId }, select: { nmId: true } })).map((c) => c.nmId),
  );

  const search = params.search?.trim().toLowerCase();

  let items = products
    .filter((p) => {
      if (!search) return true;
      return (
        p.supplierArticle.toLowerCase().includes(search) ||
        String(p.nmId).includes(search) ||
        (p.title?.toLowerCase().includes(search) ?? false)
      );
    })
    .map((p) => {
      const a = analyticsByNm.get(p.nmId);
      return {
        nmId: p.nmId,
        supplierArticle: p.supplierArticle,
        title: p.title,
        category: p.category,
        photoUrl: p.photoUrl,
        archived: p.archived,
        currentStock: a?.currentStock ?? 0,
        inTransitQty: a?.inTransitQty ?? 0,
        avgDailySales: num0(a?.avgDailySales),
        daysOfStock: num(a?.daysOfStock),
        health: (a?.health ?? 'OVERSTOCK') as SupplyHealth,
        recommendedQty: a?.recommendedQty ?? 0,
        revenue30: num0(a?.revenue30),
        profit30: num(a?.profit30),
        units30: a?.units30 ?? 0,
        dataQuality: a?.dataQuality ?? 'NONE',
        hasCost: costNmIds.has(p.nmId),
      };
    });

  // Filter by health (non-archive views).
  if (!isArchiveView && params.filter !== 'all') {
    const health = HEALTH_BY_FILTER[params.filter];
    items = items.filter((i) => i.health === health);
  }

  items.sort((a, b) => {
    switch (params.sort) {
      case 'stock':
        return b.currentStock - a.currentStock;
      case 'perDay':
        return b.avgDailySales - a.avgDailySales;
      case 'days':
        return (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity);
      case 'profit':
        return (b.profit30 ?? -Infinity) - (a.profit30 ?? -Infinity);
      case 'status':
        return STATUS_ORDER[a.health] - STATUS_ORDER[b.health];
      case 'article':
      default:
        return a.supplierArticle.localeCompare(b.supplierArticle);
    }
  });

  // Counts for filter tabs (over non-archived analytics).
  const counts = { all: 0, no_stock: 0, critical: 0, order: 0, normal: 0, overstock: 0, archive: 0 };
  const archivedNm = new Set(
    (await prisma.product.findMany({ where: { userId, archived: true }, select: { nmId: true } })).map((p) => p.nmId),
  );
  counts.archive = archivedNm.size;
  for (const p of await prisma.product.findMany({ where: { userId, archived: false }, select: { nmId: true } })) {
    const a = analyticsByNm.get(p.nmId);
    const h = (a?.health ?? 'OVERSTOCK') as SupplyHealth;
    counts.all++;
    if (h === 'NO_STOCK') counts.no_stock++;
    else if (h === 'CRITICAL') counts.critical++;
    else if (h === 'ORDER') counts.order++;
    else if (h === 'NORMAL') counts.normal++;
    else counts.overstock++;
  }

  const missingCostCount = (
    await prisma.product.findMany({ where: { userId, archived: false }, select: { nmId: true } })
  ).filter((p) => !costNmIds.has(p.nmId)).length;

  return { items, counts, missingCostCount };
}

export function recommendationText(
  health: SupplyHealth,
  recommendedQty: number,
  earliestArrival: string | null,
  deficitDate: string | null,
): string {
  if (earliestArrival && deficitDate && earliestArrival <= deficitDate && health !== 'NO_STOCK') {
    return 'Поставка в пути закроет спрос — срочный заказ не нужен.';
  }
  switch (health) {
    case 'NO_STOCK':
      return recommendedQty > 0
        ? `Нет в наличии. Закажите ${recommendedQty} шт как можно скорее.`
        : 'Нет в наличии.';
    case 'CRITICAL':
      return `Критичный остаток. Рекомендуем заказать ${recommendedQty} шт.`;
    case 'ORDER':
      return `Пора заказать ${recommendedQty} шт.`;
    case 'NORMAL':
      return 'Запаса достаточно, действий не требуется.';
    case 'OVERSTOCK':
    default:
      return 'Избыток запаса — заказывать не нужно.';
  }
}

/** Build the full product card (single product), computing economics on-demand
 *  via the shared computeProductView (same math as sync recompute). */
export async function getProductCard(prisma: Db, userId: string, nmId: number, now = new Date()) {
  const product = await prisma.product.findUnique({ where: { userId_nmId: { userId, nmId } } });
  if (!product) return null;

  const today = mskDateString(now);
  const windowStart = parseDateStr(addDaysStr(today, -40));

  const [settingsRow, override, costs, supplies, sales, snapshots, finance, ads] = await Promise.all([
    prisma.supplySettings.findUnique({ where: { userId } }),
    prisma.productSettings.findUnique({ where: { userId_nmId: { userId, nmId } } }),
    prisma.productCost.findMany({ where: { userId, nmId }, orderBy: { effectiveFrom: 'desc' } }),
    prisma.supply.findMany({ where: { userId, nmId } }),
    prisma.saleRow.findMany({ where: { userId, nmId, date: { gte: windowStart } } }),
    prisma.stockSnapshot.findMany({ where: { userId, nmId, date: { gte: windowStart } } }),
    prisma.financeRow.findMany({
      where: { userId, nmId, OR: [{ rrDt: { gte: windowStart } }, { dateFrom: { gte: windowStart } }] },
    }),
    prisma.adStat.findMany({ where: { userId, nmId, date: { gte: windowStart } } }),
  ]);

  const global: GlobalSupplyDefaults = settingsRow
    ? {
        leadTimeDays: settingsRow.leadTimeDays,
        orderBufferDays: settingsRow.orderBufferDays,
        orderQuantum: settingsRow.orderQuantum,
        targetStockDays: settingsRow.targetStockDays,
        taxPercent: num0(settingsRow.taxPercent),
      }
    : DEFAULT_SUPPLY_DEFAULTS;
  const overrideNorm = override
    ? {
        leadTimeDays: override.leadTimeDays,
        orderBufferDays: override.orderBufferDays,
        orderQuantum: override.orderQuantum,
        targetStockDays: override.targetStockDays,
        taxPercent: num(override.taxPercent),
        active: override.active,
      }
    : null;
  const resolved = resolveSupplySettings(global, overrideNorm);
  const taxPercent = resolveTaxPercent(global, overrideNorm);

  // Build day points + daily series.
  const last30 = new Set<string>();
  for (let i = 0; i < 30; i++) last30.add(addDaysStr(today, -i));

  const salesByDay = new Map<string, number>();
  const revenueByDay = new Map<string, number>();
  for (const s of sales) {
    if (s.isReturn) continue;
    const day = mskDateString(s.date);
    salesByDay.set(day, (salesByDay.get(day) ?? 0) + 1);
    const price = salePriceFromSale({
      finishedPrice: num(s.finishedPrice),
      priceWithDisc: num(s.priceWithDisc),
      totalPrice: num(s.totalPrice),
      discountPercent: num(s.discountPercent),
      forPay: num(s.forPay),
    });
    if (price != null) revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + price);
  }
  const stockByDay = new Map<string, number>();
  let latest: { date: string; quantity: number } | null = null;
  for (const snap of snapshots) {
    const day = mskDateString(snap.date);
    stockByDay.set(day, snap.quantity);
    if (!latest || day > latest.date) latest = { date: day, quantity: snap.quantity };
  }
  const points: DayPoint[] = [];
  const dates = new Set<string>([...salesByDay.keys(), ...stockByDay.keys()]);
  for (const d of dates) {
    points.push({ date: d, sales: salesByDay.get(d) ?? 0, stock: stockByDay.has(d) ? (stockByDay.get(d) as number) : null });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  const currentStock = latest?.quantity ?? 0;
  const supplyStates: SupplyState[] = supplies.map((s) => ({
    id: s.id,
    quantity: s.quantity,
    acceptedQty: s.acceptedQty,
    expectedDate: mskDateString(s.expectedDate),
    orderDate: mskDateString(s.orderDate),
    status: s.status as SupplyStatus,
    watchAfterZero: s.watchAfterZero,
  }));
  const activeStates = supplyStates.filter((s) => ACTIVE_SUPPLY.includes(s.status));
  const inTransit = activeStates.reduce((sum, s) => sum + Math.max(s.quantity - s.acceptedQty, 0), 0);

  let units30 = 0;
  let fallbackRevenue = 0;
  for (const day of last30) {
    units30 += salesByDay.get(day) ?? 0;
    fallbackRevenue += revenueByDay.get(day) ?? 0;
  }
  const financeLite: FinanceLite[] = finance.map((r) => ({
    docTypeName: r.docTypeName,
    quantity: r.quantity ?? 0,
    retailAmount: num(r.retailAmount),
    ppvzForPay: num(r.ppvzForPay),
    deliveryRub: num(r.deliveryRub),
    storageFee: num(r.storageFee),
    penalty: num(r.penalty),
    deduction: num(r.deduction),
    acceptance: num(r.acceptance),
    saleDt: r.saleDt,
    rrDt: r.rrDt,
    dateFrom: r.dateFrom,
  }));
  const financeSummary = summarizeFinanceWindow(financeLite, last30);

  let missedDays = 0;
  for (const day of last30) if (stockByDay.get(day) === 0) missedDays++;

  const view = computeProductView({
    today,
    points,
    currentStock,
    inTransitQty: inTransit,
    settings: resolved,
    taxPercent,
    units30,
    finance: financeSummary,
    salesFallbackRevenue: fallbackRevenue > 0 ? fallbackRevenue : null,
    adSpend: ads.length > 0 ? ads.reduce((s, a) => s + num0(a.spend), 0) : null,
    hasAds: ads.length > 0,
    unitCost: currentUnitCost(costs.map((c) => ({ unitCost: num0(c.unitCost), effectiveFrom: c.effectiveFrom })), now),
    missedDays,
  });

  const earliestArrival = earliestActiveArrival(activeStates);

  // Chart series (last 30 days). Current-week portion is flagged as projected.
  const currentWeekStart = weekStartStr(today);
  const chart: Array<{ date: string; units: number; revenue: number; profit: number | null; projected: boolean }> = [];
  const marginFraction =
    view.economics.marginPercent != null ? view.economics.marginPercent / 100 : null;
  for (let i = 29; i >= 0; i--) {
    const d = addDaysStr(today, -i);
    const revenue = Math.round((revenueByDay.get(d) ?? 0) * 100) / 100;
    chart.push({
      date: d,
      units: salesByDay.get(d) ?? 0,
      revenue,
      profit: marginFraction != null ? Math.round(revenue * marginFraction * 100) / 100 : null,
      projected: d >= currentWeekStart,
    });
  }

  const latestCost = costs[0] ?? null;

  return {
    info: {
      nmId,
      supplierArticle: product.supplierArticle,
      title: product.title,
      category: product.category,
      brand: product.brand,
      photoUrl: product.photoUrl,
      archived: product.archived,
      recommendation: recommendationText(view.metrics.health, view.metrics.recommendedQty, earliestArrival, view.metrics.deficitDate),
    },
    kpis: {
      currentStock,
      inTransitQty: inTransit,
      deficitDate: view.metrics.deficitDate,
      avgDailySales: round2(view.metrics.avgDailySales),
      daysOfStock: view.metrics.daysOfStock == null ? null : round2(view.metrics.daysOfStock),
      health: view.metrics.health,
    },
    recommendedQty: view.metrics.recommendedQty,
    economics: {
      revenue: round2(view.economics.revenue),
      profit: view.economics.profit == null ? null : round2(view.economics.profit),
      units: units30,
      avgPrice: view.avgPrice == null ? null : round2(view.avgPrice),
      cost: view.economics.cost == null ? null : round2(view.economics.cost),
      wbExpenses: view.economics.wbExpenses == null ? null : round2(view.economics.wbExpenses),
      adSpend: round2(view.economics.adSpend),
      tax: round2(view.economics.tax),
      profitPerUnit: view.economics.profitPerUnit == null ? null : round2(view.economics.profitPerUnit),
      marginPercent: view.economics.marginPercent == null ? null : round2(view.economics.marginPercent),
      expensesSharePercent:
        view.economics.expensesSharePercent == null ? null : round2(view.economics.expensesSharePercent),
      dataQuality: view.economics.dataQuality,
      flags: view.economics.flags,
    },
    settings: { ...resolved, taxPercent, active: overrideNorm?.active ?? true },
    cost: latestCost
      ? {
          unitCost: num0(latestCost.unitCost),
          purchaseCost: num(latestCost.purchaseCost),
          inboundLogisticsCost: num(latestCost.inboundLogisticsCost),
          packagingCost: num(latestCost.packagingCost),
          labelingCost: num(latestCost.labelingCost),
          customsCertificationCost: num(latestCost.customsCertificationCost),
          otherPreWbCost: num(latestCost.otherPreWbCost),
        }
      : null,
    supplies: supplyStates
      .filter((s) => s.status !== 'DELIVERED' && s.status !== 'CANCELLED')
      .map((s) => ({
        id: s.id,
        quantity: s.quantity,
        acceptedQty: s.acceptedQty,
        remaining: Math.max(s.quantity - s.acceptedQty, 0),
        expectedDate: s.expectedDate,
        status: s.status,
        watchAfterZero: s.watchAfterZero,
      })),
    chart,
    chartProjectedFrom: currentWeekStart,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export { dateOnly };
