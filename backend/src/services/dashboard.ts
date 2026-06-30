import type { Db } from '../db';
import { num, num0 } from '../http/serialize';
import { mskDateString, addDaysStr } from '../domain/dates';
import { needsOrderNow, type SupplyHealth } from '../domain/supply';
import { salePriceFromSale } from '../domain/finance';

const PLAN_HORIZON_DAYS = 6; // today + next 6 days = the week ahead
const STALE_MINUTES = 30;

export interface PlanTask {
  date: string;
  type: 'order' | 'receive';
  nmId: number;
  supplierArticle: string;
  title: string | null;
  qty: number;
  status: string;
  supplyId?: string;
  expectedDate?: string;
}

export async function getDashboard(prisma: Db, userId: string, now = new Date()) {
  const today = mskDateString(now);
  const horizonEnd = addDaysStr(today, PLAN_HORIZON_DAYS);

  const [products, analytics, supplies, hidden, wbKey, latestRun, lastSuccess] = await Promise.all([
    prisma.product.findMany({ where: { userId, archived: false } }),
    prisma.productAnalytics.findMany({ where: { userId } }),
    prisma.supply.findMany({
      where: { userId, status: { in: ['IN_TRANSIT', 'PARTIAL', 'DELAYED', 'WAIT_AFTER_ZERO'] } },
    }),
    prisma.hiddenTask.findMany({ where: { userId } }),
    prisma.wbKey.findUnique({ where: { userId } }),
    prisma.syncRun.findFirst({ where: { userId }, orderBy: { startedAt: 'desc' } }),
    prisma.syncRun.findFirst({ where: { userId, status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } }),
  ]);

  const productByNm = new Map(products.map((p) => [p.nmId, p]));
  const analyticsByNm = new Map(analytics.map((a) => [a.nmId, a]));
  const hiddenSet = new Set(hidden.map((h) => h.nmId));

  // Earliest active supply arrival per nmId (for in-transit coverage).
  const earliestArrivalByNm = new Map<string, string>();
  const suppliesByNm = new Map<number, typeof supplies>();
  for (const s of supplies) {
    const day = mskDateString(s.expectedDate);
    const key = String(s.nmId);
    const cur = earliestArrivalByNm.get(key);
    if (!cur || day < cur) earliestArrivalByNm.set(key, day);
    const list = suppliesByNm.get(s.nmId) ?? [];
    list.push(s);
    suppliesByNm.set(s.nmId, list);
  }

  // ── Finance summary (30 days) ──────────────────────────────────────────
  let revenue30 = 0;
  let profit30 = 0;
  let missed30 = 0;
  let hasAnyProfit = false;
  let allComplete = true;
  for (const p of products) {
    const a = analyticsByNm.get(p.nmId);
    if (!a) continue;
    revenue30 += num0(a.revenue30);
    missed30 += num0(a.missedProfit30);
    if (a.profit30 != null) {
      profit30 += num0(a.profit30);
      hasAnyProfit = true;
    }
    if ((a.units30 ?? 0) > 0 && (a.profit30 == null || a.dataQuality === 'NONE' || a.dataQuality === 'PARTIAL')) {
      allComplete = false;
    }
  }
  const profitStatus: 'full' | 'partial' | 'none' = !hasAnyProfit ? 'none' : allComplete ? 'full' : 'partial';
  const blendedMargin = revenue30 > 0 && hasAnyProfit ? profit30 / revenue30 : null;

  // ── 30-day revenue/profit chart (daily, from sales prices) ─────────────
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sales = await prisma.saleRow.findMany({
    where: { userId, isReturn: false, date: { gte: windowStart } },
    select: { date: true, finishedPrice: true, priceWithDisc: true, totalPrice: true, discountPercent: true, forPay: true },
  });
  const revByDay = new Map<string, number>();
  for (const s of sales) {
    const day = mskDateString(s.date);
    const price = salePriceFromSale({
      finishedPrice: num(s.finishedPrice),
      priceWithDisc: num(s.priceWithDisc),
      totalPrice: num(s.totalPrice),
      discountPercent: num(s.discountPercent),
      forPay: num(s.forPay),
    });
    if (price != null) revByDay.set(day, (revByDay.get(day) ?? 0) + price);
  }
  const chart: Array<{ date: string; revenue: number; profit: number | null }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDaysStr(today, -i);
    const revenue = Math.round((revByDay.get(d) ?? 0) * 100) / 100;
    chart.push({
      date: d,
      revenue,
      profit: blendedMargin != null ? Math.round(revenue * blendedMargin * 100) / 100 : null,
    });
  }

  // ── Action plan + hidden-task auto-cleanup ─────────────────────────────
  const tasks: PlanTask[] = [];
  const autoUnhide: number[] = [];

  for (const p of products) {
    const a = analyticsByNm.get(p.nmId);
    if (!a) continue;
    const health = a.health as SupplyHealth;
    const deficit = a.deficitDate ? mskDateString(a.deficitDate) : null;
    const earliestArrival = earliestArrivalByNm.get(String(p.nmId)) ?? null;
    const wantsOrder =
      a.recommendedQty > 0 && needsOrderNow({ health, deficitDate: deficit, earliestSupplyArrival: earliestArrival });

    // A hidden task auto-returns to the plan once the product no longer needs action.
    if (hiddenSet.has(p.nmId) && !wantsOrder) autoUnhide.push(p.nmId);

    if (wantsOrder && !hiddenSet.has(p.nmId)) {
      const dud = a.daysUntilOrder ?? 0;
      const orderDay = dud <= 0 ? today : addDaysStr(today, dud);
      if (orderDay <= horizonEnd) {
        tasks.push({
          date: orderDay,
          type: 'order',
          nmId: p.nmId,
          supplierArticle: p.supplierArticle,
          title: p.title,
          qty: a.recommendedQty,
          status: health,
        });
      }
    }
  }

  for (const s of supplies) {
    const p = productByNm.get(s.nmId);
    const expected = mskDateString(s.expectedDate);
    // Overdue receipts surface today.
    const receiveDay = expected < today ? today : expected;
    if (receiveDay <= horizonEnd) {
      tasks.push({
        date: receiveDay,
        type: 'receive',
        nmId: s.nmId,
        supplierArticle: p?.supplierArticle ?? String(s.nmId),
        title: p?.title ?? null,
        qty: Math.max(s.quantity - s.acceptedQty, 0),
        status: s.status,
        supplyId: s.id,
        expectedDate: expected,
      });
    }
  }

  if (autoUnhide.length > 0) {
    await prisma.hiddenTask.deleteMany({ where: { userId, nmId: { in: autoUnhide } } });
    for (const nm of autoUnhide) hiddenSet.delete(nm);
  }

  // ── Hidden tasks block (still needing action) ──────────────────────────
  const hiddenList = [...hiddenSet]
    .map((nmId) => {
      const p = productByNm.get(nmId);
      const a = analyticsByNm.get(nmId);
      return p && a
        ? { nmId, supplierArticle: p.supplierArticle, title: p.title, recommendedQty: a.recommendedQty, health: a.health }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ── Top products by profit ─────────────────────────────────────────────
  const topProducts = products
    .map((p) => {
      const a = analyticsByNm.get(p.nmId);
      return {
        nmId: p.nmId,
        supplierArticle: p.supplierArticle,
        category: p.category,
        units30: a?.units30 ?? 0,
        revenue30: num0(a?.revenue30),
        profit30: num(a?.profit30),
      };
    })
    .filter((x) => x.profit30 != null)
    .sort((a, b) => (b.profit30 ?? 0) - (a.profit30 ?? 0))
    .slice(0, 8);

  // ── Sync state ─────────────────────────────────────────────────────────
  const isRunning =
    latestRun?.status === 'RUNNING' &&
    (Date.now() - latestRun.startedAt.getTime()) / 60000 < STALE_MINUTES;

  return {
    setup: {
      hasKey: !!wbKey,
      keyValid: wbKey?.isValid ?? false,
      hasData: products.length > 0,
      firstRun: !wbKey || products.length === 0,
    },
    finance: {
      revenue30: Math.round(revenue30 * 100) / 100,
      profit30: hasAnyProfit ? Math.round(profit30 * 100) / 100 : null,
      missedProfit30: Math.round(missed30 * 100) / 100,
      profitStatus,
    },
    chart,
    tasks,
    hidden: hiddenList,
    topProducts,
    sync: {
      isRunning,
      lastSyncAt: lastSuccess?.finishedAt?.toISOString() ?? null,
      lastStatus: latestRun?.status ?? null,
      lastError: latestRun?.error ?? null,
      steps: latestRun?.steps ?? null,
    },
  };
}
