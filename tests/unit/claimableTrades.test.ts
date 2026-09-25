import { describe, it, expect } from 'vitest';

import {
  selectClaimableTrades,
  tradeUrgencyLabel,
  tradeDateTile,
  type MarketplaceTrade,
} from '@/lib/claimableTrades';
import { SHIFT_PROTECTION_DEFAULTS, type ShiftProtectionSettings } from '@/lib/shiftProtection';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-25T15:00:00Z'); // 10:00 in America/Chicago (CDT)

function trade(
  id: string,
  startOffsetHours: number,
  overrides: Partial<MarketplaceTrade> = {},
): MarketplaceTrade {
  const start = new Date(NOW.getTime() + startOffsetHours * HOUR);
  const end = new Date(start.getTime() + 6 * HOUR);
  return {
    id,
    restaurant_id: 'rest-1',
    offered_shift_id: `shift-${id}`,
    offered_by_employee_id: 'emp-poster',
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'open',
    reason: null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    offered_shift: {
      id: `shift-${id}`,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      position: 'Server',
      break_duration: 0,
      is_published: true,
    },
    offered_by: { id: 'emp-poster', name: 'Maria Lopez', email: null, position: 'Server', area: null },
    hasConflict: false,
    ...overrides,
  };
}

const baseOpts = {
  employeeId: 'emp-me',
  now: NOW,
  protection: SHIFT_PROTECTION_DEFAULTS,
  isExemptFromBlock: false,
};

const blockProtection: ShiftProtectionSettings = {
  ...SHIFT_PROTECTION_DEFAULTS,
  trade_deadline_mode: 'block',
  trade_deadline_hours: 24,
};

describe('selectClaimableTrades', () => {
  it('drops the caller own trades', () => {
    const result = selectClaimableTrades(
      [trade('a', 10, { offered_by_employee_id: 'emp-me' }), trade('b', 10)],
      baseOpts,
    );
    expect(result.map((r) => r.trade.id)).toEqual(['b']);
  });

  it('drops a trade whose shift already started, and a trade that starts now', () => {
    const result = selectClaimableTrades([trade('a', -1), trade('b', 0), trade('c', 1)], baseOpts);
    expect(result.map((r) => r.trade.id)).toEqual(['c']);
  });

  it('drops a trade with a conflict', () => {
    const result = selectClaimableTrades(
      [trade('a', 10, { hasConflict: true }), trade('b', 10)],
      baseOpts,
    );
    expect(result.map((r) => r.trade.id)).toEqual(['b']);
  });

  it('drops a trade without a shift join', () => {
    const result = selectClaimableTrades(
      [trade('a', 10, { offered_shift: undefined }), trade('b', 10)],
      baseOpts,
    );
    expect(result.map((r) => r.trade.id)).toEqual(['b']);
  });

  it('drops a block-window trade for a caller without edit:scheduling', () => {
    const result = selectClaimableTrades([trade('a', 24), trade('b', 25), trade('c', 5)], {
      ...baseOpts,
      protection: blockProtection,
    });
    expect(result.map((r) => r.trade.id)).toEqual(['b']);
  });

  it('keeps a block-window trade for an exempt caller', () => {
    const result = selectClaimableTrades([trade('a', 24), trade('c', 5)], {
      ...baseOpts,
      protection: blockProtection,
      isExemptFromBlock: true,
    });
    expect(result.map((r) => r.trade.id)).toEqual(['c', 'a']);
  });

  it('keeps a deadline-window trade in warn mode', () => {
    const result = selectClaimableTrades([trade('a', 5)], {
      ...baseOpts,
      protection: { ...blockProtection, trade_deadline_mode: 'warn' },
    });
    expect(result.map((r) => r.trade.id)).toEqual(['a']);
  });

  it('sorts by start time, soonest first', () => {
    const result = selectClaimableTrades([trade('late', 50), trade('soon', 2), trade('mid', 20)], baseOpts);
    expect(result.map((r) => r.trade.id)).toEqual(['soon', 'mid', 'late']);
  });

  it('marks a trade urgent at 24 h or less, and not urgent after 24 h', () => {
    const result = selectClaimableTrades([trade('a', 24), trade('b', 24.01)], baseOpts);
    const byId = Object.fromEntries(result.map((r) => [r.trade.id, r.urgent]));
    expect(byId).toEqual({ a: true, b: false });
  });

  it('returns startsAt as a Date of the shift start', () => {
    const [row] = selectClaimableTrades([trade('a', 3)], baseOpts);
    expect(row.startsAt.getTime()).toBe(NOW.getTime() + 3 * HOUR);
  });
});

describe('tradeUrgencyLabel', () => {
  const tz = 'America/Chicago';
  const at = (ms: number) => new Date(NOW.getTime() + ms);

  it('shows minutes under 1 h, rounded down', () => {
    expect(tradeUrgencyLabel(at(45 * 60_000 + 59_000), NOW, tz)).toEqual({
      short: 'Starts in 45 min',
      spoken: 'Starts in 45 minutes',
    });
  });

  it('uses the singular for 1 minute and never shows 0 minutes', () => {
    expect(tradeUrgencyLabel(at(30_000), NOW, tz)).toEqual({
      short: 'Starts in 1 min',
      spoken: 'Starts in 1 minute',
    });
  });

  it('shows hours from 1 h to under 12 h, rounded down', () => {
    expect(tradeUrgencyLabel(at(5 * HOUR + 59 * 60_000), NOW, tz)).toEqual({
      short: 'Starts in 5 h',
      spoken: 'Starts in 5 hours',
    });
    expect(tradeUrgencyLabel(at(HOUR), NOW, tz)).toEqual({
      short: 'Starts in 1 h',
      spoken: 'Starts in 1 hour',
    });
    expect(tradeUrgencyLabel(at(12 * HOUR - 1), NOW, tz)?.short).toBe('Starts in 11 h');
  });

  it('shows "Today" at 12 h or more on the same restaurant day', () => {
    // NOW is 10:00 CDT. 13 h later is 23:00 CDT, the same day.
    expect(tradeUrgencyLabel(at(13 * HOUR), NOW, tz)).toEqual({ short: 'Today', spoken: 'Today' });
  });

  it('shows "Tomorrow" on the next restaurant day', () => {
    // 14 h later is 00:00 CDT on the next day (midnight edge).
    expect(tradeUrgencyLabel(at(14 * HOUR), NOW, tz)).toEqual({ short: 'Tomorrow', spoken: 'Tomorrow' });
    // 37 h 59 min later is 23:59 CDT on the next day.
    expect(tradeUrgencyLabel(at(37 * HOUR + 59 * 60_000), NOW, tz)?.short).toBe('Tomorrow');
  });

  it('returns null for a later day', () => {
    // 38 h later is 00:00 CDT two days out.
    expect(tradeUrgencyLabel(at(38 * HOUR), NOW, tz)).toBeNull();
  });

  it('returns null for a start in the past', () => {
    expect(tradeUrgencyLabel(at(-HOUR), NOW, tz)).toBeNull();
  });

  it('uses the restaurant day, not the UTC day', () => {
    // 2026-09-25T22:00Z is 07:00 on 2026-09-26 in Asia/Tokyo.
    const now = new Date('2026-09-25T22:00:00Z');
    // 2026-09-26T13:00Z is 22:00 on 2026-09-26 in Tokyo: the same Tokyo day,
    // but the next UTC day.
    const start = new Date('2026-09-26T13:00:00Z');
    expect(tradeUrgencyLabel(start, now, 'Asia/Tokyo')?.short).toBe('Today');
    expect(tradeUrgencyLabel(start, now, 'UTC')?.short).toBe('Tomorrow');
  });
});

describe('tradeDateTile', () => {
  it('returns weekday, day and month in the restaurant zone', () => {
    expect(tradeDateTile(new Date('2026-09-26T22:00:00Z'), 'America/Chicago')).toEqual({
      weekday: 'Sat',
      day: '26',
      month: 'Sep',
    });
  });

  it('puts a shift after local midnight on the restaurant day, not the UTC day', () => {
    // 2026-09-27T04:30Z is 23:30 on 2026-09-26 in Chicago.
    expect(tradeDateTile(new Date('2026-09-27T04:30:00Z'), 'America/Chicago')).toEqual({
      weekday: 'Sat',
      day: '26',
      month: 'Sep',
    });
    // 2026-09-30T15:30Z is 00:30 on 2026-10-01 in Tokyo.
    expect(tradeDateTile(new Date('2026-09-30T15:30:00Z'), 'Asia/Tokyo')).toEqual({
      weekday: 'Thu',
      day: '1',
      month: 'Oct',
    });
  });
});
