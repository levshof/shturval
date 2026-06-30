import { describe, it, expect } from 'vitest';
import {
  unitCostFromComponents,
  salePriceFromSale,
  computeEconomics,
  assessDataQuality,
  missedProfit,
  type EconomicsInputs,
} from './finance';

describe('unitCostFromComponents (spec 9.1)', () => {
  it('sums all provided components', () => {
    expect(
      unitCostFromComponents({
        purchaseCost: 100,
        inboundLogisticsCost: 20,
        packagingCost: 5,
        labelingCost: 3,
        customsCertificationCost: 2,
        otherPreWbCost: 1,
      }),
    ).toBe(131);
  });
  it('treats missing components as 0', () => {
    expect(unitCostFromComponents({ purchaseCost: 100 })).toBe(100);
  });
});

describe('salePriceFromSale (spec 9.2 fallback chain)', () => {
  it('prefers finishedPrice', () => {
    expect(salePriceFromSale({ finishedPrice: 500, priceWithDisc: 480 })).toBe(500);
  });
  it('falls back to priceWithDisc', () => {
    expect(salePriceFromSale({ finishedPrice: null, priceWithDisc: 480 })).toBe(480);
  });
  it('falls back to totalPrice with discount', () => {
    expect(salePriceFromSale({ totalPrice: 1000, discountPercent: 20 })).toBe(800);
  });
  it('falls back to forPay', () => {
    expect(salePriceFromSale({ forPay: 300 })).toBe(300);
  });
  it('returns null when nothing usable', () => {
    expect(salePriceFromSale({})).toBeNull();
  });
});

const base: EconomicsInputs = {
  units: 100,
  financeRevenue: 100_000,
  salesFallbackRevenue: null,
  sellerPayout: 70_000,
  wbExpensesDetail: null,
  adSpend: 5_000,
  adEstimated: false,
  unitCost: 300,
  taxRatePercent: 7,
  hasFinanceReport: true,
  hasAds: true,
  hasProjection: false,
};

describe('computeEconomics (spec 9.3–9.9)', () => {
  it('computes profit from seller payout', () => {
    const r = computeEconomics(base);
    expect(r.revenue).toBe(100_000);
    expect(r.cost).toBe(30_000); // 300 * 100
    expect(r.wbExpenses).toBe(30_000); // revenue - payout
    expect(r.tax).toBeCloseTo(7_000, 6);
    expect(r.profit).toBeCloseTo(28_000, 6); // 70000 - 30000 - 5000 - 7000
    expect(r.marginPercent).toBeCloseTo(28, 6);
    expect(r.profitPerUnit).toBeCloseTo(280, 6);
    expect(r.expensesSharePercent).toBeCloseTo(72, 6);
    expect(r.dataQuality).toBe('VERIFIED');
  });

  it('returns null profit and NONE quality when cost is unknown', () => {
    const r = computeEconomics({ ...base, unitCost: null });
    expect(r.cost).toBeNull();
    expect(r.profit).toBeNull();
    expect(r.marginPercent).toBeNull();
    expect(r.dataQuality).toBe('NONE');
    expect(r.flags.hasCost).toBe(false);
    expect(r.revenueKnown).toBe(true); // revenue is still known
  });

  it('computes profit from itemised WB expenses when no payout (sales fallback revenue)', () => {
    const r = computeEconomics({
      ...base,
      financeRevenue: null,
      salesFallbackRevenue: 50_000,
      sellerPayout: null,
      wbExpensesDetail: 15_000,
      adSpend: 2_000,
      taxRatePercent: 0,
      unitCost: 100,
      hasFinanceReport: false,
    });
    expect(r.revenue).toBe(50_000);
    expect(r.cost).toBe(10_000);
    expect(r.wbExpenses).toBe(15_000);
    expect(r.profit).toBeCloseTo(23_000, 6); // 50000 - 10000 - 15000 - 2000
    expect(r.dataQuality).toBe('PARTIAL'); // no finance report
  });

  it('marks VERIFIED_BUFFER when a projection is included', () => {
    const r = computeEconomics({ ...base, hasProjection: true });
    expect(r.dataQuality).toBe('VERIFIED_BUFFER');
  });
});

describe('assessDataQuality (spec 11)', () => {
  it('NONE when profit not computable', () => {
    expect(
      assessDataQuality({
        profitComputable: false,
        hasFinanceReport: true,
        hasAds: true,
        adEstimated: false,
        hasProjection: false,
      }),
    ).toBe('NONE');
  });
  it('PARTIAL when ad spend is estimated', () => {
    expect(
      assessDataQuality({
        profitComputable: true,
        hasFinanceReport: true,
        hasAds: true,
        adEstimated: true,
        hasProjection: false,
      }),
    ).toBe('PARTIAL');
  });
});

describe('missedProfit (spec 9.10)', () => {
  it('multiplies velocity, missed days and per-unit profit', () => {
    expect(missedProfit(2, 10, 280)).toBe(5_600);
  });
  it('caps missed days at 30', () => {
    expect(missedProfit(2, 40, 280)).toBe(16_800); // 2 * 30 * 280
  });
  it('is 0 when per-unit profit is non-positive or unknown', () => {
    expect(missedProfit(2, 10, 0)).toBe(0);
    expect(missedProfit(2, 10, -5)).toBe(0);
    expect(missedProfit(2, 10, null)).toBe(0);
  });
});
