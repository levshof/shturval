import { describe, it, expect } from 'vitest';
import {
  isDayAvailable,
  velocityForWindow,
  computeVelocity,
  daysOfStock,
  daysUntilOrder,
  recommendedQty,
  overstockQty,
  deficitDate,
  supplyHealth,
  needsOrderNow,
  type DayPoint,
  type ResolvedSupplySettings,
} from './supply';

const settings: ResolvedSupplySettings = {
  leadTimeDays: 14,
  orderBufferDays: 7,
  orderQuantum: 10,
  targetStockDays: 45,
};

/** Build N consecutive day points ending at `endDate` (inclusive). */
function series(endDate: string, days: Array<{ sales: number; stock: number | null }>): DayPoint[] {
  // days[0] is the EARLIEST; last element corresponds to endDate.
  const out: DayPoint[] = [];
  const n = days.length;
  for (let i = 0; i < n; i++) {
    const offset = n - 1 - i; // earliest has largest offset
    out.push({ date: shift(endDate, -offset), sales: days[i].sales, stock: days[i].stock });
  }
  return out;
}
function shift(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
}

describe('isDayAvailable (spec 6.1)', () => {
  it('counts a day with sales', () => {
    expect(isDayAvailable({ date: 'd', sales: 1, stock: 0 })).toBe(true);
  });
  it('counts a day with positive stock', () => {
    expect(isDayAvailable({ date: 'd', sales: 0, stock: 5 })).toBe(true);
  });
  it('counts a day with unknown stock (no evidence of OOS)', () => {
    expect(isDayAvailable({ date: 'd', sales: 0, stock: null })).toBe(true);
  });
  it('excludes a known zero-stock day with no sales', () => {
    expect(isDayAvailable({ date: 'd', sales: 0, stock: 0 })).toBe(false);
  });
});

describe('velocityForWindow (spec 6.2)', () => {
  const today = '2026-06-30';

  it('averages over available days only', () => {
    // 7 complete days before today, 2 sales each, always in stock.
    const pts = series('2026-06-29', Array(7).fill({ sales: 2, stock: 10 }));
    expect(velocityForWindow(pts, 7, today)).toBeCloseTo(2, 6);
  });

  it('excludes out-of-stock days from the denominator (raises velocity)', () => {
    // 6 days of 3 sales (in stock) + 1 day OOS (0 sales, stock 0).
    const days = [
      { sales: 3, stock: 10 },
      { sales: 3, stock: 10 },
      { sales: 0, stock: 0 }, // OOS — excluded
      { sales: 3, stock: 10 },
      { sales: 3, stock: 10 },
      { sales: 3, stock: 10 },
      { sales: 3, stock: 10 },
    ];
    const pts = series('2026-06-29', days);
    // 18 sales / 6 available days = 3
    expect(velocityForWindow(pts, 7, today)).toBeCloseTo(3, 6);
  });

  it('does not penalise a brand-new product for days before it existed', () => {
    // Only one day of data (yesterday), 5 sales. V30 should reflect that one day.
    const pts: DayPoint[] = [{ date: '2026-06-29', sales: 5, stock: 8 }];
    expect(velocityForWindow(pts, 30, today)).toBeCloseTo(5, 6);
  });

  it('treats post-existence gaps as available days with 0 sales', () => {
    const pts: DayPoint[] = [
      { date: '2026-06-23', sales: 7, stock: 5 },
      { date: '2026-06-29', sales: 7, stock: 5 },
    ];
    // window 7 days (06-23..06-29): 2 selling days + 5 gap days = 7 available, 14 sales
    expect(velocityForWindow(pts, 7, today)).toBeCloseTo(2, 6);
  });

  it('returns 0 when there are no available days', () => {
    expect(velocityForWindow([], 7, today)).toBe(0);
  });
});

describe('computeVelocity (spec 6.3 weighting)', () => {
  it('weights 0.5*V7 + 0.3*V14 + 0.2*V30', () => {
    const today = '2026-06-30';
    const pts = series('2026-06-29', Array(30).fill({ sales: 2, stock: 10 }));
    const v = computeVelocity(pts, today);
    expect(v.v7).toBeCloseTo(2, 6);
    expect(v.v14).toBeCloseTo(2, 6);
    expect(v.v30).toBeCloseTo(2, 6);
    expect(v.avgDailySales).toBeCloseTo(2, 6);
  });
});

describe('daysOfStock (spec 6.4)', () => {
  it('divides stock by velocity', () => {
    expect(daysOfStock(20, 2)).toBe(10);
  });
  it('is null when velocity is 0', () => {
    expect(daysOfStock(20, 0)).toBeNull();
  });
});

describe('daysUntilOrder (spec 6.5)', () => {
  it('floors dos - (lead+buffer)', () => {
    expect(daysUntilOrder(30, settings)).toBe(9); // floor(30-21)
    expect(daysUntilOrder(10, settings)).toBe(-11);
  });
  it('is null when dos is null', () => {
    expect(daysUntilOrder(null, settings)).toBeNull();
  });
});

describe('recommendedQty (spec 6.6)', () => {
  it('rounds need up to the order quantum', () => {
    // need = 2*45 - 20 - 5 = 65 → ceil(65/10)*10 = 70
    expect(recommendedQty(20, 5, 2, settings)).toBe(70);
  });
  it('is 0 when there is no need', () => {
    expect(recommendedQty(200, 0, 2, settings)).toBe(0);
  });
});

describe('overstockQty (spec 6.7)', () => {
  it('is stock minus 90 days of demand', () => {
    expect(overstockQty(300, 2)).toBe(120); // 300 - 180
  });
  it('is the full stock when velocity is 0', () => {
    expect(overstockQty(50, 0)).toBe(50);
  });
  it('is 0 when within 90 days', () => {
    expect(overstockQty(100, 2)).toBe(0);
  });
});

describe('deficitDate (spec 6.8)', () => {
  it('is today + floor(dos)', () => {
    expect(deficitDate('2026-06-30', 10)).toBe('2026-07-10');
  });
  it('is null when dos is null', () => {
    expect(deficitDate('2026-06-30', null)).toBeNull();
  });
});

describe('supplyHealth (spec 7)', () => {
  it('NO_STOCK when stock is 0', () => {
    expect(supplyHealth(0, 5, null, settings)).toBe('NO_STOCK');
  });
  it('OVERSTOCK when stock>0 but velocity is 0', () => {
    expect(supplyHealth(5, 0, null, settings)).toBe('OVERSTOCK');
  });
  it('CRITICAL when dos <= lead time', () => {
    expect(supplyHealth(20, 2, 10, settings)).toBe('CRITICAL'); // dos 10 <= 14
  });
  it('ORDER when dos <= lead+buffer', () => {
    expect(supplyHealth(42, 2, 21, settings)).toBe('ORDER'); // dos 21 <= 21
  });
  it('NORMAL when between order window and 90', () => {
    expect(supplyHealth(50, 2, 25, settings)).toBe('NORMAL');
  });
  it('OVERSTOCK when dos > 90', () => {
    expect(supplyHealth(200, 2, 100, settings)).toBe('OVERSTOCK');
  });
});

describe('needsOrderNow (spec 7.6 in-transit consideration)', () => {
  it('not urgent when a supply arrives before the deficit date', () => {
    expect(
      needsOrderNow({
        health: 'CRITICAL',
        deficitDate: '2026-07-10',
        earliestSupplyArrival: '2026-07-05',
      }),
    ).toBe(false);
  });
  it('urgent when supply arrives after the deficit date', () => {
    expect(
      needsOrderNow({
        health: 'CRITICAL',
        deficitDate: '2026-07-10',
        earliestSupplyArrival: '2026-07-20',
      }),
    ).toBe(true);
  });
  it('urgent when there is no supply', () => {
    expect(
      needsOrderNow({ health: 'ORDER', deficitDate: '2026-07-10', earliestSupplyArrival: null }),
    ).toBe(true);
  });
  it('not urgent for healthy products', () => {
    expect(
      needsOrderNow({ health: 'NORMAL', deficitDate: null, earliestSupplyArrival: null }),
    ).toBe(false);
  });
});
