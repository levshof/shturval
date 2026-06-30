/**
 * Current-week projection — SINGLE SOURCE OF TRUTH (spec section 10).
 *
 * Closed weeks come from verified WB finance data; the open current week is
 * projected from elapsed days and the typical "load" of verified weeks. The
 * result carries an explicit confidence so the UI never confuses a forecast
 * with a fact (spec 9–11, DECISIONS.md D-0009).
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface CurrentWeekInputs {
  /** Days of the current week already elapsed (1..7). */
  elapsedDays: number;
  /** Units sold so far this week (returns excluded). */
  currentUnits: number;
  /** Revenue so far this week, or null if unknown. */
  currentRevenue: number | null;
  /** Average sale price from verified weeks, used when current revenue is unknown. */
  avgPriceFromVerified: number | null;
  /** Average WB-expense load (% of revenue) across verified weeks. */
  avgWbLoadPercent: number;
  /** Average advertising load (% of revenue) across verified weeks. */
  avgAdLoadPercent: number;
  /** Average tax load (% of revenue) across verified weeks. */
  avgTaxLoadPercent: number;
  /** Current per-unit cost, or null. */
  currentCostPerUnit: number | null;

  // ── confidence context ───────────────────────────────────────────────
  /** Number of verified (closed) weeks available. */
  verifiedWeeksCount: number;
  /** Typical units per week from verified weeks, or null. */
  typicalWeeklyUnits: number | null;
  /** True if advertising data has gaps in the period. */
  hasAdGaps: boolean;
  /** True if the unit cost changed within the projection horizon. */
  costChanged: boolean;
}

export interface CurrentWeekProjection {
  projectedUnits: number;
  projectedRevenue: number;
  projectedWbExpenses: number;
  projectedAdExpenses: number;
  projectedTax: number;
  projectedCost: number | null;
  projectedProfit: number | null;
  confidence: Confidence;
}

export function projectCurrentWeek(input: CurrentWeekInputs): CurrentWeekProjection {
  const elapsed = Math.min(Math.max(input.elapsedDays, 1), 7);

  const salesVelocity = input.currentUnits / elapsed;
  const projectedUnits = salesVelocity * 7;

  let projectedRevenue: number;
  if (input.currentRevenue != null && input.currentRevenue > 0) {
    projectedRevenue = (input.currentRevenue / elapsed) * 7;
  } else if (input.avgPriceFromVerified != null) {
    projectedRevenue = projectedUnits * input.avgPriceFromVerified;
  } else {
    projectedRevenue = 0;
  }

  const projectedWbExpenses = (projectedRevenue * input.avgWbLoadPercent) / 100;
  const projectedAdExpenses = (projectedRevenue * input.avgAdLoadPercent) / 100;
  const projectedTax = (projectedRevenue * input.avgTaxLoadPercent) / 100;
  const projectedCost =
    input.currentCostPerUnit != null ? projectedUnits * input.currentCostPerUnit : null;

  const projectedProfit =
    projectedCost != null
      ? projectedRevenue - projectedWbExpenses - projectedAdExpenses - projectedTax - projectedCost
      : null;

  return {
    projectedUnits,
    projectedRevenue,
    projectedWbExpenses,
    projectedAdExpenses,
    projectedTax,
    projectedCost,
    projectedProfit,
    confidence: assessConfidence(input, salesVelocity),
  };
}

/**
 * Confidence drops with: too few verified weeks, too few elapsed days, current
 * velocity far from typical, ad gaps, or a cost change (spec 10).
 */
export function assessConfidence(input: CurrentWeekInputs, salesVelocity: number): Confidence {
  if (input.verifiedWeeksCount === 0) return 'low';

  let penalties = 0;
  if (input.verifiedWeeksCount < 2) penalties += 1;
  if (input.elapsedDays < 3) penalties += 1;

  if (input.typicalWeeklyUnits != null && input.typicalWeeklyUnits > 0) {
    const typicalDaily = input.typicalWeeklyUnits / 7;
    if (typicalDaily > 0) {
      const ratio = salesVelocity / typicalDaily;
      if (ratio > 1.5 || ratio < 0.5) penalties += 1; // velocity far from usual
    }
  }

  if (input.hasAdGaps) penalties += 1;
  if (input.costChanged) penalties += 1;

  if (penalties === 0) return 'high';
  if (penalties <= 2) return 'medium';
  return 'low';
}
