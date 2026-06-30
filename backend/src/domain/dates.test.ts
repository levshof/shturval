import { describe, it, expect } from 'vitest';
import {
  mskDateString,
  todayMsk,
  addDaysStr,
  diffDaysStr,
  weekStartStr,
  elapsedWeekDays,
  parseDateStr,
} from './dates';

describe('mskDateString (MSK = UTC+3)', () => {
  it('rolls to the next day when UTC time + 3h crosses midnight', () => {
    expect(mskDateString(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
  });
  it('stays on the same day before the boundary', () => {
    expect(mskDateString(new Date('2026-06-30T20:00:00Z'))).toBe('2026-06-30');
  });
});

describe('todayMsk', () => {
  it('uses the injected now', () => {
    expect(todayMsk(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('addDaysStr', () => {
  it('adds days across month boundaries', () => {
    expect(addDaysStr('2026-06-30', 1)).toBe('2026-07-01');
  });
  it('subtracts days (non-leap February)', () => {
    expect(addDaysStr('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('diffDaysStr', () => {
  it('counts whole days', () => {
    expect(diffDaysStr('2026-07-10', '2026-06-30')).toBe(10);
    expect(diffDaysStr('2026-06-30', '2026-07-10')).toBe(-10);
  });
});

describe('weekStartStr / elapsedWeekDays (ISO week, Monday start)', () => {
  it('returns Monday for a mid-week date', () => {
    // 2026-01-07 is a Wednesday; that week starts Monday 2026-01-05.
    expect(weekStartStr('2026-01-07')).toBe('2026-01-05');
    expect(parseDateStr('2026-01-05').getUTCDay()).toBe(1); // Monday
    expect(elapsedWeekDays('2026-01-07')).toBe(3);
  });
  it('handles Sunday as the last day of the ISO week', () => {
    // 2026-01-04 is a Sunday; its week starts Monday 2025-12-29.
    expect(weekStartStr('2026-01-04')).toBe('2025-12-29');
    expect(elapsedWeekDays('2026-01-04')).toBe(7);
  });
  it('always returns a Monday', () => {
    for (const d of ['2026-06-30', '2026-02-15', '2026-12-31', '2026-03-01']) {
      expect(parseDateStr(weekStartStr(d)).getUTCDay()).toBe(1);
    }
  });
});
