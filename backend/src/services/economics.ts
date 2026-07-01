/**
 * Per-product computation orchestrator. Both the sync recompute (bulk) and the
 * product card (single) call THIS, so the assembly of supply metrics + economics
 * lives in exactly one place (spec 0.4 — no duplicated formulas/logic).
 */

import { mskDateString } from '../domain/dates';
import { computeSupplyMetrics, type DayPoint, type SupplyMetrics, type ResolvedSupplySettings } from '../domain/supply';
import { computeEconomics, missedProfit, type EconomicsResult } from '../domain/finance';

export interface FinanceLite {
  docTypeName: string | null;
  quantity: number | null;
  retailAmount: number | null;
  ppvzForPay: number | null;
  deliveryRub: number | null;
  storageFee: number | null;
  penalty: number | null;
  deduction: number | null;
  acceptance: number | null;
  saleDt: Date | null;
  rrDt: Date | null;
  dateFrom: Date | null;
}

function isReturnDoc(docTypeName: string | null): boolean {
  return !!docTypeName && docTypeName.toLowerCase().includes('возврат');
}

export interface FinanceSummary {
  hasFinanceReport: boolean;
  financeRevenue: number | null;
  /** Net units the report actually covers (returns subtract). Used so revenue,
   *  cost and per-unit metrics all share the same "verified weeks" period. */
  financeUnits: number | null;
  sellerPayout: number | null;
  wbExpensesDetail: number | null;
}

/** Aggregate finance rows that fall inside the last-30-days set (by attribution date). */
export function summarizeFinanceWindow(rows: FinanceLite[], last30: Set<string>): FinanceSummary {
  const inWindow = rows.filter((r) => {
    const attr = mskDateString(r.saleDt ?? r.rrDt ?? r.dateFrom ?? new Date(0));
    return last30.has(attr);
  });
  if (inWindow.length === 0) {
    return {
      hasFinanceReport: false,
      financeRevenue: null,
      financeUnits: null,
      sellerPayout: null,
      wbExpensesDetail: null,
    };
  }
  let rev = 0;
  let units = 0;
  let payout = 0;
  let parts = 0;
  for (const r of inWindow) {
    const sign = isReturnDoc(r.docTypeName) ? -1 : 1;
    rev += sign * (r.retailAmount ?? 0);
    units += sign * (r.quantity ?? 0);
    payout += r.ppvzForPay ?? 0; // returns already carry negative ppvz_for_pay
    parts += (r.deliveryRub ?? 0) + (r.storageFee ?? 0) + (r.penalty ?? 0) + (r.deduction ?? 0) + (r.acceptance ?? 0);
  }
  return { hasFinanceReport: true, financeRevenue: rev, financeUnits: units, sellerPayout: payout, wbExpensesDetail: parts };
}

export interface ProductComputeInput {
  today: string;
  points: DayPoint[];
  currentStock: number;
  inTransitQty: number;
  settings: ResolvedSupplySettings;
  taxPercent: number;
  units30: number;
  finance: FinanceSummary;
  salesFallbackRevenue: number | null;
  adSpend: number | null;
  hasAds: boolean;
  unitCost: number | null;
  missedDays: number;
}

export interface ProductComputeResult {
  metrics: SupplyMetrics;
  economics: EconomicsResult;
  avgPrice: number | null;
  missedProfit: number;
}

export function computeProductView(input: ProductComputeInput): ProductComputeResult {
  const metrics = computeSupplyMetrics({
    points: input.points,
    today: input.today,
    currentStock: input.currentStock,
    inTransitQty: input.inTransitQty,
    settings: input.settings,
  });

  // Keep revenue and units on the same period. When a finance report is present,
  // revenue/payout come from the closed ("verified") weeks it covers, so cost and
  // per-unit metrics must use the units from THAT report — not the full 30-day
  // sales count (which includes not-yet-reconciled sales). Otherwise cost is
  // overstated and profit/margin come out wrong (BUG-0002).
  const economicsUnits =
    input.finance.hasFinanceReport && input.finance.financeUnits != null && input.finance.financeUnits > 0
      ? input.finance.financeUnits
      : input.units30;

  const economics = computeEconomics({
    units: economicsUnits,
    financeRevenue: input.finance.financeRevenue,
    salesFallbackRevenue: input.finance.hasFinanceReport ? null : input.salesFallbackRevenue,
    sellerPayout: input.finance.sellerPayout,
    wbExpensesDetail: input.finance.wbExpensesDetail,
    adSpend: input.adSpend,
    adEstimated: false,
    unitCost: input.unitCost,
    taxRatePercent: input.taxPercent,
    hasFinanceReport: input.finance.hasFinanceReport,
    hasAds: input.hasAds,
    hasProjection: input.finance.hasFinanceReport,
  });

  const avgPrice = economicsUnits > 0 ? economics.revenue / economicsUnits : null;
  const missed =
    metrics.health === 'NO_STOCK'
      ? missedProfit(metrics.avgDailySales, input.missedDays, economics.profitPerUnit)
      : 0;

  return { metrics, economics, avgPrice, missedProfit: missed };
}
