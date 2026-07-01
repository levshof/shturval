import { describe, it, expect } from 'vitest';
import {
  summarizeFinanceWindow,
  computeProductView,
  type FinanceLite,
  type FinanceSummary,
} from './economics';
import type { ResolvedSupplySettings } from '../domain/supply';

const SETTINGS: ResolvedSupplySettings = {
  leadTimeDays: 14,
  orderBufferDays: 7,
  orderQuantum: 1,
  targetStockDays: 45,
};

function financeRow(over: Partial<FinanceLite>): FinanceLite {
  return {
    docTypeName: 'Продажа',
    quantity: 0,
    retailAmount: null,
    ppvzForPay: null,
    deliveryRub: null,
    storageFee: null,
    penalty: null,
    deduction: null,
    acceptance: null,
    saleDt: null,
    rrDt: null,
    dateFrom: null,
    ...over,
  };
}

describe('summarizeFinanceWindow', () => {
  const last30 = new Set(['2026-06-20', '2026-06-21']);

  it('nets units and revenue over returns', () => {
    const rows: FinanceLite[] = [
      financeRow({ quantity: 10, retailAmount: 10_000, ppvzForPay: 7_000, saleDt: new Date('2026-06-20T00:00:00+03:00') }),
      financeRow({ docTypeName: 'Возврат', quantity: 2, retailAmount: 2_000, ppvzForPay: -1_400, saleDt: new Date('2026-06-21T00:00:00+03:00') }),
    ];
    const s = summarizeFinanceWindow(rows, last30);
    expect(s.hasFinanceReport).toBe(true);
    expect(s.financeUnits).toBe(8); // 10 sold − 2 returned
    expect(s.financeRevenue).toBe(8_000); // 10000 − 2000
    expect(s.sellerPayout).toBe(5_600); // 7000 + (−1400)
  });

  it('reports nothing when no rows fall in the window', () => {
    const s = summarizeFinanceWindow(
      [financeRow({ quantity: 3, retailAmount: 900, saleDt: new Date('2026-01-01T00:00:00+03:00') })],
      last30,
    );
    expect(s.hasFinanceReport).toBe(false);
    expect(s.financeUnits).toBeNull();
  });
});

describe('computeProductView period consistency (BUG-0002)', () => {
  const baseFinance: FinanceSummary = {
    hasFinanceReport: true,
    financeRevenue: 20_000,
    financeUnits: 20, // report covers 20 reconciled units …
    sellerPayout: 14_000,
    wbExpensesDetail: null,
  };

  it('uses report units (not 30-day sales) for cost when a finance report exists', () => {
    const view = computeProductView({
      today: '2026-06-30',
      points: [],
      currentStock: 50,
      inTransitQty: 0,
      settings: SETTINGS,
      taxPercent: 0,
      units30: 30, // … while 30 units sold in the last 30 days (10 not yet reconciled)
      finance: baseFinance,
      salesFallbackRevenue: null,
      adSpend: 0,
      hasAds: true,
      unitCost: 500,
      missedDays: 0,
    });
    // cost must pair with the 20 reconciled units, not 30 → 500 * 20 = 10 000.
    expect(view.economics.cost).toBe(10_000);
    // profit = payout − cost − ads − tax = 14000 − 10000 − 0 − 0 = 4 000.
    expect(view.economics.profit).toBe(4_000);
    // avgPrice uses the same 20 units → 20000 / 20 = 1 000 (not 20000 / 30).
    expect(view.avgPrice).toBe(1_000);
  });

  it('falls back to 30-day sales units when there is no finance report', () => {
    const view = computeProductView({
      today: '2026-06-30',
      points: [],
      currentStock: 50,
      inTransitQty: 0,
      settings: SETTINGS,
      taxPercent: 0,
      units30: 30,
      finance: { hasFinanceReport: false, financeRevenue: null, financeUnits: null, sellerPayout: null, wbExpensesDetail: null },
      salesFallbackRevenue: 45_000,
      adSpend: 0,
      hasAds: false,
      unitCost: 500,
      missedDays: 0,
    });
    expect(view.economics.revenue).toBe(45_000);
    expect(view.economics.cost).toBe(15_000); // 500 * 30
    expect(view.avgPrice).toBe(1_500); // 45000 / 30
  });
});
