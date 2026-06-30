import { describe, it, expect } from 'vitest';
import { projectCurrentWeek, assessConfidence, type CurrentWeekInputs } from './forecast';

const base: CurrentWeekInputs = {
  elapsedDays: 2,
  currentUnits: 10,
  currentRevenue: 20_000,
  avgPriceFromVerified: null,
  avgWbLoadPercent: 30,
  avgAdLoadPercent: 5,
  avgTaxLoadPercent: 7,
  currentCostPerUnit: 300,
  verifiedWeeksCount: 4,
  typicalWeeklyUnits: 35,
  hasAdGaps: false,
  costChanged: false,
};

describe('projectCurrentWeek (spec 10)', () => {
  it('projects units and revenue from elapsed days', () => {
    const r = projectCurrentWeek(base);
    expect(r.projectedUnits).toBeCloseTo(35, 6); // (10/2)*7
    expect(r.projectedRevenue).toBeCloseTo(70_000, 6); // (20000/2)*7
    expect(r.projectedWbExpenses).toBeCloseTo(21_000, 6);
    expect(r.projectedAdExpenses).toBeCloseTo(3_500, 6);
    expect(r.projectedTax).toBeCloseTo(4_900, 6);
    expect(r.projectedCost).toBeCloseTo(10_500, 6); // 35 * 300
    expect(r.projectedProfit).toBeCloseTo(30_100, 6);
  });

  it('uses average verified price when current revenue is unknown', () => {
    const r = projectCurrentWeek({
      ...base,
      currentRevenue: null,
      avgPriceFromVerified: 2_000,
    });
    expect(r.projectedRevenue).toBeCloseTo(70_000, 6); // 35 * 2000
  });

  it('returns null projected profit when cost per unit is unknown', () => {
    const r = projectCurrentWeek({ ...base, currentCostPerUnit: null });
    expect(r.projectedCost).toBeNull();
    expect(r.projectedProfit).toBeNull();
  });
});

describe('assessConfidence (spec 10)', () => {
  it('is high with enough data and stable velocity', () => {
    const r = assessConfidence({ ...base, elapsedDays: 5 }, 5); // velocity 5 == typical daily 5
    expect(r).toBe('high');
  });
  it('is medium with few elapsed days', () => {
    expect(assessConfidence(base, 5)).toBe('medium'); // elapsedDays 2 → 1 penalty
  });
  it('is low with no verified weeks', () => {
    expect(assessConfidence({ ...base, verifiedWeeksCount: 0 }, 5)).toBe('low');
  });
  it('is low when several signals are off', () => {
    const r = assessConfidence(
      {
        ...base,
        elapsedDays: 1,
        verifiedWeeksCount: 1,
        hasAdGaps: true,
        costChanged: true,
      },
      5,
    );
    expect(r).toBe('low');
  });
});
