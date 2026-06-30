import { describe, it, expect } from 'vitest';
import {
  inTransitQty,
  arrivalIncrement,
  distributeArrival,
  deadlineThreshold,
  nextSupplyStatus,
  earliestActiveArrival,
  remainingQty,
  type SupplyState,
} from './supplyTracking';

function supply(p: Partial<SupplyState>): SupplyState {
  return {
    id: p.id ?? 's1',
    quantity: p.quantity ?? 10,
    acceptedQty: p.acceptedQty ?? 0,
    expectedDate: p.expectedDate ?? '2026-07-10',
    orderDate: p.orderDate ?? '2026-06-20',
    status: p.status ?? 'IN_TRANSIT',
    watchAfterZero: p.watchAfterZero ?? false,
  };
}

describe('inTransitQty', () => {
  it('sums remaining of active supplies and ignores delivered/cancelled/zero-not-found', () => {
    const supplies = [
      supply({ id: 'a', quantity: 10, acceptedQty: 3, status: 'IN_TRANSIT' }), // 7
      supply({ id: 'b', quantity: 20, acceptedQty: 0, status: 'PARTIAL' }), // 20
      supply({ id: 'c', quantity: 5, acceptedQty: 5, status: 'DELIVERED' }), // 0 (ignored)
      supply({ id: 'd', quantity: 8, acceptedQty: 0, status: 'CANCELLED' }), // ignored
      supply({ id: 'e', quantity: 8, acceptedQty: 0, status: 'ZERO_NOT_FOUND' }), // ignored
      supply({ id: 'f', quantity: 6, acceptedQty: 1, status: 'WAIT_AFTER_ZERO' }), // 5
    ];
    expect(inTransitQty(supplies)).toBe(32);
  });
});

describe('remainingQty', () => {
  it('never goes negative', () => {
    expect(remainingQty(supply({ quantity: 10, acceptedQty: 12 }))).toBe(0);
  });
});

describe('arrivalIncrement (spec 8.2)', () => {
  it('is max(0, current - previous + sales since check)', () => {
    expect(arrivalIncrement(12, 5, 3)).toBe(10);
    expect(arrivalIncrement(4, 10, 2)).toBe(0); // stock dropped more than sales
  });
});

describe('distributeArrival (spec 8.2 ordering)', () => {
  it('fills earliest expected date first, then earliest order date', () => {
    const supplies = [
      supply({ id: 'late', quantity: 10, acceptedQty: 0, expectedDate: '2026-07-10' }),
      supply({ id: 'early', quantity: 10, acceptedQty: 0, expectedDate: '2026-07-05' }),
    ];
    const dist = distributeArrival(supplies, 15);
    expect(dist).toEqual([
      { id: 'early', addAccepted: 10 },
      { id: 'late', addAccepted: 5 },
    ]);
  });

  it('stops when the increment is exhausted', () => {
    const supplies = [supply({ id: 'a', quantity: 10, acceptedQty: 0 })];
    expect(distributeArrival(supplies, 4)).toEqual([{ id: 'a', addAccepted: 4 }]);
  });

  it('returns nothing for a zero increment', () => {
    expect(distributeArrival([supply({})], 0)).toEqual([]);
  });
});

describe('deadlineThreshold (spec 8.3)', () => {
  it('is ceil(80% of quantity)', () => {
    expect(deadlineThreshold(10)).toBe(8);
    expect(deadlineThreshold(9)).toBe(8); // ceil(7.2)
  });
});

describe('nextSupplyStatus (spec 8.3–8.4)', () => {
  const today = '2026-07-12';

  it('DELIVERED when fully accepted at any time', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ quantity: 10, acceptedQty: 10, expectedDate: '2026-07-20' }),
        today,
        currentStock: 0,
      }),
    ).toBe('DELIVERED');
  });

  it('IN_TRANSIT before due with nothing accepted', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ acceptedQty: 0, expectedDate: '2026-07-20' }),
        today,
        currentStock: 5,
      }),
    ).toBe('IN_TRANSIT');
  });

  it('PARTIAL before due with some accepted', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ acceptedQty: 3, expectedDate: '2026-07-20' }),
        today,
        currentStock: 5,
      }),
    ).toBe('PARTIAL');
  });

  it('DELIVERED on deadline at >= 80%', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ quantity: 10, acceptedQty: 8, expectedDate: '2026-07-10' }),
        today,
        currentStock: 5,
      }),
    ).toBe('DELIVERED');
  });

  it('DELAYED when overdue with < 80% and stock remains', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ quantity: 10, acceptedQty: 2, expectedDate: '2026-07-10' }),
        today,
        currentStock: 5,
      }),
    ).toBe('DELAYED');
  });

  it('ZERO_NOT_FOUND when overdue, under 80%, and stock is 0', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ quantity: 10, acceptedQty: 0, expectedDate: '2026-07-10' }),
        today,
        currentStock: 0,
      }),
    ).toBe('ZERO_NOT_FOUND');
  });

  it('WAIT_AFTER_ZERO when the user opted to keep waiting', () => {
    expect(
      nextSupplyStatus({
        supply: supply({
          quantity: 10,
          acceptedQty: 0,
          expectedDate: '2026-07-10',
          watchAfterZero: true,
        }),
        today,
        currentStock: 0,
      }),
    ).toBe('WAIT_AFTER_ZERO');
  });

  it('keeps CANCELLED terminal', () => {
    expect(
      nextSupplyStatus({
        supply: supply({ status: 'CANCELLED', acceptedQty: 0 }),
        today,
        currentStock: 0,
      }),
    ).toBe('CANCELLED');
  });
});

describe('earliestActiveArrival', () => {
  it('returns the earliest expected date among active supplies', () => {
    const supplies = [
      supply({ expectedDate: '2026-07-20', status: 'IN_TRANSIT' }),
      supply({ expectedDate: '2026-07-05', status: 'PARTIAL' }),
      supply({ expectedDate: '2026-07-01', status: 'DELIVERED' }), // ignored
    ];
    expect(earliestActiveArrival(supplies)).toBe('2026-07-05');
  });
  it('returns null with no active supplies', () => {
    expect(earliestActiveArrival([supply({ status: 'DELIVERED' })])).toBeNull();
  });
});
