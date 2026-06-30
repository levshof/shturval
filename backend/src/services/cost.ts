/**
 * Resolve the unit cost that was in effect at a given date from cost history
 * (spec 4.8 — "what cost applied in a given period"). Single source of truth.
 */

export interface CostHistoryRow {
  unitCost: number;
  effectiveFrom: Date;
}

/** Latest cost whose effectiveFrom is on/before `asOf`, or null if none. */
export function currentUnitCost(history: CostHistoryRow[], asOf: Date): number | null {
  let best: CostHistoryRow | null = null;
  for (const row of history) {
    if (row.effectiveFrom.getTime() <= asOf.getTime()) {
      if (!best || row.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = row;
    }
  }
  return best ? best.unitCost : null;
}

/** True if the unit cost changed within [since, asOf] (affects forecast confidence). */
export function costChangedWithin(history: CostHistoryRow[], since: Date, asOf: Date): boolean {
  const within = history.filter(
    (r) => r.effectiveFrom.getTime() >= since.getTime() && r.effectiveFrom.getTime() <= asOf.getTime(),
  );
  return within.length > 0 && currentUnitCost(history, since) !== currentUnitCost(history, asOf);
}
