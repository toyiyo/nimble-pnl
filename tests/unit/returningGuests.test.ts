import { describe, it, expect } from 'vitest';
import {
  percentChange,
  describeChange,
  canViewReturningGuests,
  parseCampaignStart,
  parseWeeks,
  noteForQuality,
  warmupNote,
  toChartRows,
  type ReturningGuestWeek,
} from '@/lib/returningGuests';

describe('percentChange', () => {
  it('returns the percent change', () => {
    expect(percentChange(100, 112)).toBe(12);
    expect(percentChange(200, 150)).toBe(-25);
  });
  it('returns null when before is zero', () => {
    expect(percentChange(0, 10)).toBeNull();
  });
  it('returns null for null, undefined or NaN input', () => {
    expect(percentChange(null, 10)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
    expect(percentChange(undefined, 10)).toBeNull();
    expect(percentChange(NaN, 10)).toBeNull();
  });
  it('returns 0 when the values are equal', () => {
    expect(percentChange(50, 50)).toBe(0);
  });
});

describe('parseCampaignStart', () => {
  const today = '2026-11-12';
  it('accepts a valid past date and today', () => {
    expect(parseCampaignStart('2026-10-01', today)).toBe('2026-10-01');
    expect(parseCampaignStart('2026-11-12', today)).toBe('2026-11-12');
  });
  it('ignores a future date', () => {
    expect(parseCampaignStart('2026-11-13', today)).toBeNull();
  });
  it('ignores bad formats and impossible dates', () => {
    expect(parseCampaignStart(null, today)).toBeNull();
    expect(parseCampaignStart('', today)).toBeNull();
    expect(parseCampaignStart('10/01/2026', today)).toBeNull();
    expect(parseCampaignStart('2026-02-30', today)).toBeNull();
    expect(parseCampaignStart('2026-13-01', today)).toBeNull();
  });
});

describe('parseWeeks', () => {
  it('accepts 4, 8 and 12', () => {
    expect(parseWeeks('4')).toBe(4);
    expect(parseWeeks('8')).toBe(8);
    expect(parseWeeks('12')).toBe(12);
  });
  it('falls back to 8', () => {
    expect(parseWeeks(null)).toBe(8);
    expect(parseWeeks('6')).toBe(8);
    expect(parseWeeks('abc')).toBe(8);
    expect(parseWeeks('0')).toBe(8);
  });
});

describe('noteForQuality', () => {
  it('returns the strong note', () => {
    expect(noteForQuality('strong')).toContain('card ID from Square');
  });
  it('returns the same note for good and fair', () => {
    expect(noteForQuality('good')).toBe(noteForQuality('fair'));
    expect(noteForQuality('good')).toContain('card brand and card digits');
  });
  it('returns the weak note', () => {
    expect(noteForQuality('weak')).toContain('Rough estimate');
  });
  it('returns null for none', () => {
    expect(noteForQuality('none')).toBeNull();
  });
  it('mentions cash in every note', () => {
    for (const q of ['strong', 'good', 'fair', 'weak'] as const) {
      expect(noteForQuality(q)).toContain('Cash payments are not included.');
    }
  });
});

describe('warmupNote', () => {
  it('names the history start date', () => {
    expect(warmupNote('2026-08-14')).toBe(
      'Your card history starts on 2026-08-14. Weeks near that date show too many new guests.',
    );
  });
});

describe('toChartRows', () => {
  const week = (week_start: string, period: 'before' | 'after'): ReturningGuestWeek => ({
    week_start,
    period,
    warmup: false,
    returning_spend: 100,
    new_spend: 50,
    returning_visits: 5,
    returning_cards: 4,
    new_cards: 3,
  });
  it('maps weeks to indexes relative to the campaign start', () => {
    const rows = toChartRows(
      [week('2026-09-17', 'before'), week('2026-09-24', 'before'), week('2026-10-01', 'after')],
      '2026-10-01',
    );
    expect(rows.map((r) => r.weekIndex)).toEqual([-2, -1, 0]);
    expect(rows[0]).toMatchObject({ returning: 100, new: 50, period: 'before' });
    expect(rows[2].period).toBe('after');
  });
  it('returns an empty list for no weeks', () => {
    expect(toChartRows([], '2026-10-01')).toEqual([]);
  });
});

describe('describeChange', () => {
  it('describes an increase and a decrease', () => {
    expect(describeChange(12.4)).toEqual({ direction: 'up', sign: '+', word: 'increased', rounded: 12 });
    expect(describeChange(-7)).toEqual({ direction: 'down', sign: '-', word: 'decreased', rounded: 7 });
  });
  it('treats a change that rounds to 0 as flat', () => {
    expect(describeChange(0.3).direction).toBe('flat');
    expect(describeChange(-0.4).sign).toBe('');
  });
});

describe('canViewReturningGuests', () => {
  it('allows owner and manager only', () => {
    expect(canViewReturningGuests('owner')).toBe(true);
    expect(canViewReturningGuests('manager')).toBe(true);
    expect(canViewReturningGuests('chef')).toBe(false);
    expect(canViewReturningGuests(undefined)).toBe(false);
  });
});
