import { describe, it, expect } from 'vitest';
import {
  scheduleThreadHeaders,
  shiftBusinessDay,
} from '../../supabase/functions/_shared/scheduleEmailThread';

describe('scheduleThreadHeaders', () => {
  it('builds References and In-Reply-To from the same id', () => {
    const headers = scheduleThreadHeaders(
      'aaaaaaaa-1111-2222-3333-444444444444',
      '2026-08-17',
    );
    const expectedId =
      '<schedule-aaaaaaaa-1111-2222-3333-444444444444-2026-08-17@easyshifthq.com>';
    expect(headers).toEqual({
      References: expectedId,
      'In-Reply-To': expectedId,
    });
  });
});

describe('shiftBusinessDay', () => {
  it('lands a late-evening shift on the correct business day in America/New_York', () => {
    // 2026-08-17T23:30:00-04:00 is 2026-08-18T03:30:00Z. In UTC this is
    // already the 18th, but in America/New_York it is still the 17th.
    const result = shiftBusinessDay(
      '2026-08-18T03:30:00.000Z',
      'America/New_York',
    );
    expect(result).toBe('2026-08-17');
  });

  it('falls back to the default timezone for an invalid IANA string instead of throwing', () => {
    expect(() =>
      shiftBusinessDay('2026-08-18T03:30:00.000Z', 'Not/A_Real_Zone'),
    ).not.toThrow();
    const result = shiftBusinessDay(
      '2026-08-18T03:30:00.000Z',
      'Not/A_Real_Zone',
    );
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null for a missing start_time', () => {
    expect(shiftBusinessDay(undefined, 'America/New_York')).toBeNull();
    expect(shiftBusinessDay(null, 'America/New_York')).toBeNull();
  });

  it('returns null for a non-string start_time', () => {
    expect(shiftBusinessDay(12345 as unknown as string, 'America/New_York')).toBeNull();
  });

  it('returns null for an unparseable start_time', () => {
    expect(shiftBusinessDay('not-a-date', 'America/New_York')).toBeNull();
  });
});
