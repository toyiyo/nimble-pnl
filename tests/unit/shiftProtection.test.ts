import { describe, it, expect } from 'vitest';

import {
  SHIFT_PROTECTION_DEFAULTS,
  tradeDeadlineFinding,
  timeoffNoticeFinding,
  parseShiftProtectionError,
  type ShiftProtectionSettings,
} from '@/lib/shiftProtection';

const settings = (overrides: Partial<ShiftProtectionSettings>): ShiftProtectionSettings => ({
  ...SHIFT_PROTECTION_DEFAULTS,
  ...overrides,
});

describe('tradeDeadlineFinding', () => {
  const now = new Date('2026-09-03T12:00:00Z');

  it('returns null when the mode is off', () => {
    const s = settings({ trade_deadline_mode: 'off', trade_deadline_hours: 24 });
    expect(tradeDeadlineFinding(s, '2026-09-03T18:00:00Z', now)).toBeNull();
  });

  it('returns null when the shift start is outside the window', () => {
    const s = settings({ trade_deadline_mode: 'warn', trade_deadline_hours: 24 });
    // Starts in 48 hours.
    expect(tradeDeadlineFinding(s, '2026-09-05T12:00:00Z', now)).toBeNull();
  });

  it('returns null exactly at the window boundary', () => {
    const s = settings({ trade_deadline_mode: 'warn', trade_deadline_hours: 24 });
    // Starts in exactly 24 hours.
    expect(tradeDeadlineFinding(s, '2026-09-04T12:00:00Z', now)).toBeNull();
  });

  it('returns a warn finding inside the window', () => {
    const s = settings({ trade_deadline_mode: 'warn', trade_deadline_hours: 24 });
    const finding = tradeDeadlineFinding(s, '2026-09-04T09:00:00Z', now);
    expect(finding).not.toBeNull();
    expect(finding?.rule).toBe('trade_deadline');
    expect(finding?.mode).toBe('warn');
    expect(finding?.message).toContain('21');
  });

  it('returns a block finding when the mode is block', () => {
    const s = settings({ trade_deadline_mode: 'block', trade_deadline_hours: 24 });
    const finding = tradeDeadlineFinding(s, '2026-09-03T18:00:00Z', now);
    expect(finding?.mode).toBe('block');
  });

  it('reports a started shift with dedicated copy', () => {
    const s = settings({ trade_deadline_mode: 'warn', trade_deadline_hours: 24 });
    const finding = tradeDeadlineFinding(s, '2026-09-03T10:00:00Z', now);
    expect(finding).not.toBeNull();
    expect(finding?.message.toLowerCase()).toContain('started');
  });

  it('returns null for an invalid start time', () => {
    const s = settings({ trade_deadline_mode: 'warn', trade_deadline_hours: 24 });
    expect(tradeDeadlineFinding(s, 'not-a-date', now)).toBeNull();
    expect(tradeDeadlineFinding(s, undefined, now)).toBeNull();
  });
});

describe('timeoffNoticeFinding', () => {
  const today = '2026-09-03';

  it('returns null when the mode is off', () => {
    const s = settings({ timeoff_notice_mode: 'off', timeoff_notice_days: 7 });
    expect(timeoffNoticeFinding(s, '2026-09-04', today)).toBeNull();
  });

  it('returns null when the start date honors the notice', () => {
    const s = settings({ timeoff_notice_mode: 'warn', timeoff_notice_days: 7 });
    // Exactly 7 days out satisfies a 7-day notice.
    expect(timeoffNoticeFinding(s, '2026-09-10', today)).toBeNull();
    expect(timeoffNoticeFinding(s, '2026-10-01', today)).toBeNull();
  });

  it('returns a finding inside the notice window', () => {
    const s = settings({ timeoff_notice_mode: 'warn', timeoff_notice_days: 7 });
    const finding = timeoffNoticeFinding(s, '2026-09-09', today);
    expect(finding).not.toBeNull();
    expect(finding?.rule).toBe('timeoff_notice');
    expect(finding?.mode).toBe('warn');
    expect(finding?.message).toContain('7');
  });

  it('returns a finding for a same-day start', () => {
    const s = settings({ timeoff_notice_mode: 'block', timeoff_notice_days: 7 });
    const finding = timeoffNoticeFinding(s, today, today);
    expect(finding?.mode).toBe('block');
  });

  it('returns null for an invalid date', () => {
    const s = settings({ timeoff_notice_mode: 'warn', timeoff_notice_days: 7 });
    expect(timeoffNoticeFinding(s, 'nope', today)).toBeNull();
    expect(timeoffNoticeFinding(s, undefined, today)).toBeNull();
  });
});

describe('parseShiftProtectionError', () => {
  it('parses a prefixed trigger message', () => {
    const parsed = parseShiftProtectionError(
      'shift_protection:timeoff_notice This restaurant needs 7 days of notice for time off.'
    );
    expect(parsed).toEqual({
      rule: 'timeoff_notice',
      message: 'This restaurant needs 7 days of notice for time off.',
    });
  });

  it('parses a message embedded in Postgres decoration', () => {
    const parsed = parseShiftProtectionError(
      'P0001: shift_protection:trade_deadline Trades close 24 hours before the shift.'
    );
    expect(parsed?.rule).toBe('trade_deadline');
    expect(parsed?.message).toBe('Trades close 24 hours before the shift.');
  });

  it('returns null for an unrelated message', () => {
    expect(parseShiftProtectionError('duplicate key value violates unique constraint')).toBeNull();
    expect(parseShiftProtectionError('')).toBeNull();
  });
});
