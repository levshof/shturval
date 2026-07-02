import { describe, it, expect } from 'vitest';
import { allocateAdSpend, type AdCampaignDayInput } from './ads';

function nm(nmId: number, spend: number, extra: Partial<{ views: number; clicks: number; orders: number }> = {}) {
  return { nmId, spend, views: extra.views ?? 0, clicks: extra.clicks ?? 0, orders: extra.orders ?? 0 };
}

describe('allocateAdSpend', () => {
  it('passes through fully precise days unchanged (nm total matches campaign total)', () => {
    const days: AdCampaignDayInput[] = [
      { advertId: 1, date: '2026-06-20', totalSpend: 500, nm: [nm(111, 300, { views: 10 }), nm(222, 200, { views: 5 })] },
    ];
    const { rows, unattributed } = allocateAdSpend(days);
    expect(unattributed).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'PRECISE')).toBe(true);
    expect(rows.find((r) => r.nmId === 111)?.spend).toBe(300);
    expect(rows.find((r) => r.nmId === 222)?.spend).toBe(200);
  });

  it('allocates the unattributed remainder proportionally by known spend share (BUG-0001-adjacent auto-campaign gap)', () => {
    const days: AdCampaignDayInput[] = [
      // Day 1: full breakdown establishes a 3:1 spend ratio between 111 and 222.
      { advertId: 1, date: '2026-06-19', totalSpend: 400, nm: [nm(111, 300), nm(222, 100)] },
      // Day 2: WB reports a real total (1000) but zero product breakdown (the known quirk).
      { advertId: 1, date: '2026-06-20', totalSpend: 1000, nm: [] },
    ];
    const { rows, unattributed } = allocateAdSpend(days);
    expect(unattributed).toEqual([]);

    const day2 = rows.filter((r) => r.date === '2026-06-20');
    expect(day2).toHaveLength(2);
    expect(day2.every((r) => r.source === 'ALLOCATED')).toBe(true);
    const spend111 = day2.find((r) => r.nmId === 111)!.spend;
    const spend222 = day2.find((r) => r.nmId === 222)!.spend;
    expect(spend111).toBeCloseTo(750); // 1000 * 300/400
    expect(spend222).toBeCloseTo(250); // 1000 * 100/400
  });

  it('splits equally when known products exist but none ever had precise spend', () => {
    const days: AdCampaignDayInput[] = [
      { advertId: 2, date: '2026-06-20', totalSpend: 600, nm: [nm(111, 0), nm(222, 0), nm(333, 0)] },
    ];
    const { rows } = allocateAdSpend(days);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.source).toBe('ALLOCATED');
      expect(r.spend).toBeCloseTo(200);
    }
  });

  it('reports spend as unattributed when a campaign never lists any product', () => {
    const days: AdCampaignDayInput[] = [{ advertId: 3, date: '2026-06-20', totalSpend: 750, nm: [] }];
    const { rows, unattributed } = allocateAdSpend(days);
    expect(rows).toEqual([]);
    expect(unattributed).toEqual([{ advertId: 3, spend: 750 }]);
  });

  it('merges nm entries that appear more than once in a day and never allocates a negative remainder', () => {
    const days: AdCampaignDayInput[] = [
      // nm 111 spend is split across two "apps" for the same day; total already covers (exceeds) the day total.
      { advertId: 4, date: '2026-06-20', totalSpend: 100, nm: [nm(111, 60), nm(111, 50)] },
    ];
    const { rows } = allocateAdSpend(days);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nmId: 111, spend: 110, source: 'PRECISE' });
  });
});
