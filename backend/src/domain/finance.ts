/**
 * Finance formulas — SINGLE SOURCE OF TRUTH (spec sections 9 and 11).
 *
 * Pure functions. Profit is only computed when we can do it honestly; otherwise
 * it is `null` and the data-quality flag explains why. We never silently invent
 * a profit number (spec 0.4: no quiet substitution of "strange" data).
 */

export type DataQuality = 'VERIFIED' | 'VERIFIED_BUFFER' | 'PARTIAL' | 'NONE';

/** Spec 9.1 — unit cost from optional components. */
export interface CostComponents {
  purchaseCost?: number | null;
  inboundLogisticsCost?: number | null;
  packagingCost?: number | null;
  labelingCost?: number | null;
  customsCertificationCost?: number | null;
  otherPreWbCost?: number | null;
}

export function unitCostFromComponents(c: CostComponents): number {
  return (
    (c.purchaseCost ?? 0) +
    (c.inboundLogisticsCost ?? 0) +
    (c.packagingCost ?? 0) +
    (c.labelingCost ?? 0) +
    (c.customsCertificationCost ?? 0) +
    (c.otherPreWbCost ?? 0)
  );
}

/**
 * Spec 9.2 — sale price for a single sale row, used when no reliable finance
 * report is available (e.g. for the chart). Fallback chain:
 *   finishedPrice → priceWithDisc → totalPrice*(1-discount%) → forPay
 * Returns null if none is usable.
 */
export function salePriceFromSale(s: {
  finishedPrice?: number | null;
  priceWithDisc?: number | null;
  totalPrice?: number | null;
  discountPercent?: number | null;
  forPay?: number | null;
}): number | null {
  if (s.finishedPrice != null && s.finishedPrice > 0) return s.finishedPrice;
  if (s.priceWithDisc != null && s.priceWithDisc > 0) return s.priceWithDisc;
  if (s.totalPrice != null && s.totalPrice > 0) {
    const disc = s.discountPercent ?? 0;
    return s.totalPrice * (1 - disc / 100);
  }
  if (s.forPay != null && s.forPay > 0) return s.forPay;
  return null;
}

export interface EconomicsInputs {
  /** Units sold in the period (returns excluded). */
  units: number;
  /** Σ retail_amount from the finance report (closed weeks), or null. */
  financeRevenue: number | null;
  /** Σ sale price from sales rows (fallback when no finance report), or null. */
  salesFallbackRevenue: number | null;
  /** Σ ppvz_for_pay — reliable seller payout, or null. */
  sellerPayout: number | null;
  /** Σ of WB expense parts (commission+logistics+storage+returns+penalty+deduction+acceptance+other), or null. */
  wbExpensesDetail: number | null;
  /** Advertising spend in the period, or null if unknown. */
  adSpend: number | null;
  /** True if adSpend was distributed proportionally rather than reported per product. */
  adEstimated: boolean;
  /** Per-unit cost of goods, or null if not filled in. */
  unitCost: number | null;
  /** Tax rate, percent. */
  taxRatePercent: number;
  /** Whether the period is backed by a finance report (closed weeks). */
  hasFinanceReport: boolean;
  /** Whether advertising data is present. */
  hasAds: boolean;
  /** Whether the period includes a projected (open) current week. */
  hasProjection: boolean;
}

export interface EconomicsResult {
  units: number;
  revenue: number;
  revenueKnown: boolean;
  cost: number | null;
  wbExpenses: number | null;
  adSpend: number;
  adEstimated: boolean;
  tax: number;
  profit: number | null;
  marginPercent: number | null;
  profitPerUnit: number | null;
  expensesSharePercent: number | null;
  dataQuality: DataQuality;
  flags: {
    hasFinanceReport: boolean;
    hasCost: boolean;
    hasAds: boolean;
  };
}

/**
 * Spec 9.3–9.9 + 11 — period economics with data-quality assessment.
 *
 * Profit requires BOTH a known unit cost AND a way to get WB expenses
 * (a reliable payout OR an itemised WB-expenses figure). Otherwise profit and
 * its derivatives are null.
 */
export function computeEconomics(input: EconomicsInputs): EconomicsResult {
  const revenueKnown = input.financeRevenue != null || input.salesFallbackRevenue != null;
  const revenue = input.financeRevenue ?? input.salesFallbackRevenue ?? 0;

  const hasCost = input.unitCost != null;
  const cost = hasCost ? input.unitCost! * input.units : null;

  // Spec 9.3 — WB expenses: prefer (revenue - payout) when payout is reliable.
  let wbExpenses: number | null;
  if (input.sellerPayout != null) {
    wbExpenses = revenue - input.sellerPayout;
  } else if (input.wbExpensesDetail != null) {
    wbExpenses = input.wbExpensesDetail;
  } else {
    wbExpenses = null;
  }

  const adSpend = input.adSpend ?? 0;

  // Spec 9.5 — tax basis defaults to revenue.
  const tax = (revenue * input.taxRatePercent) / 100;

  // Spec 9.6 — profit.
  let profit: number | null = null;
  if (hasCost) {
    if (input.sellerPayout != null) {
      profit = input.sellerPayout - cost! - adSpend - tax;
    } else if (input.wbExpensesDetail != null) {
      profit = revenue - cost! - input.wbExpensesDetail - adSpend - tax;
    }
  }

  // Spec 9.7–9.9 — derivatives (only when profit is real).
  const marginPercent = profit != null && revenue > 0 ? (profit / revenue) * 100 : null;
  const profitPerUnit = profit != null && input.units > 0 ? profit / input.units : null;
  const expensesSharePercent =
    profit != null && revenue > 0 ? ((revenue - profit) / revenue) * 100 : null;

  const dataQuality = assessDataQuality({
    profitComputable: profit != null,
    hasFinanceReport: input.hasFinanceReport,
    hasAds: input.hasAds,
    adEstimated: input.adEstimated,
    hasProjection: input.hasProjection,
  });

  return {
    units: input.units,
    revenue,
    revenueKnown,
    cost,
    wbExpenses,
    adSpend,
    adEstimated: input.adEstimated,
    tax,
    profit,
    marginPercent,
    profitPerUnit,
    expensesSharePercent,
    dataQuality,
    flags: {
      hasFinanceReport: input.hasFinanceReport,
      hasCost,
      hasAds: input.hasAds,
    },
  };
}

/** Spec 11 — classify the completeness of the financial picture. */
export function assessDataQuality(args: {
  profitComputable: boolean;
  hasFinanceReport: boolean;
  hasAds: boolean;
  adEstimated: boolean;
  hasProjection: boolean;
}): DataQuality {
  if (!args.profitComputable) return 'NONE';
  // Fully closed, fully sourced, nothing estimated → verified.
  if (args.hasFinanceReport && args.hasAds && !args.adEstimated && !args.hasProjection) {
    return 'VERIFIED';
  }
  // Verified closed weeks + a projected current week → verified + buffer.
  if (args.hasFinanceReport && args.hasProjection) {
    return 'VERIFIED_BUFFER';
  }
  // Something is missing or estimated.
  return 'PARTIAL';
}

/**
 * Spec 9.10 — missed profit for an out-of-stock product with known positive
 * per-unit profit. `missedDays` is days since the deficit date, capped at 30.
 */
export function missedProfit(
  avgDailySales: number,
  missedDays: number,
  profitPerUnit: number | null,
): number {
  if (profitPerUnit == null || profitPerUnit <= 0) return 0;
  const days = Math.min(Math.max(missedDays, 0), 30);
  return avgDailySales * days * profitPerUnit;
}
