/**
 * Unit tests for conflictFormatUtils.ts
 *
 * REGRESSION COVERAGE for the DST anchor bug:
 *   formatUTCTimeToLocal hardcoded a Jan-1 anchor (standard time), causing
 *   CDT-era times to display 1h earlier than the employee set them.
 *   Employee stores 10:00 PM CDT → 03:00:00 UTC. Old code reads it as CST
 *   (UTC-6), showing 9:00 PM. Fix anchors to today (same as the writer).
 *
 * TZ-portability: reference dates use new Date(y, m, d) (local midnight),
 * which is portable across TZ=UTC / TZ=America/Los_Angeles / TZ=Asia/Tokyo.
 * The tested logic operates on the restaurant's explicit timezone, so the
 * process TZ must not affect results.
 */

import { describe, it, expect } from 'vitest';
import { formatUTCTimeToLocal, formatConflictLine } from '@/lib/conflictFormatUtils';
import type { ConflictCheck } from '@/types/scheduling';

// ─── formatUTCTimeToLocal ─────────────────────────────────────────────────────

describe('formatUTCTimeToLocal – regression (reported DST bug)', () => {
  // Prod data: employee dff3beb5, America/Chicago, UTC 03:00:00/03:30:00 = 10:00/10:30 PM CDT
  // Old code (Jan-1 anchor) returns "9:00 PM" / "9:30 PM" — these assertions FAIL on buggy code.
  const summerDate = new Date(2026, 5, 23); // June 23 2026 — CDT (UTC-5)

  it('displays 03:00:00 UTC as 10:00 PM CDT (America/Chicago, summer)', () => {
    expect(formatUTCTimeToLocal('03:00:00', 'America/Chicago', summerDate)).toBe('10:00 PM');
  });

  it('displays 03:30:00 UTC as 10:30 PM CDT (America/Chicago, summer)', () => {
    expect(formatUTCTimeToLocal('03:30:00', 'America/Chicago', summerDate)).toBe('10:30 PM');
  });
});

describe('formatUTCTimeToLocal – anchor matters (winter vs summer)', () => {
  // Same UTC time reads differently depending on DST anchor — this documents the contract.
  it('displays 03:00:00 UTC as 9:00 PM CST when referenceDate is Jan 1 (winter)', () => {
    const winterDate = new Date(2026, 0, 1); // Jan 1 2026 — CST (UTC-6)
    expect(formatUTCTimeToLocal('03:00:00', 'America/Chicago', winterDate)).toBe('9:00 PM');
  });

  it('displays 03:00:00 UTC as 10:00 PM CDT when referenceDate is June (summer)', () => {
    const summerDate = new Date(2026, 5, 23); // June 23 2026 — CDT (UTC-5)
    expect(formatUTCTimeToLocal('03:00:00', 'America/Chicago', summerDate)).toBe('10:00 PM');
  });
});

describe('formatUTCTimeToLocal – DST transition correctness', () => {
  // America/Chicago: spring-forward Mar 8 2026 (02:00 → 03:00)
  it('uses CST offset (UTC-6) for Mar 7 2026 (day before spring-forward)', () => {
    const beforeSpring = new Date(2026, 2, 7); // Mar 7 2026 — still CST
    // 06:00 UTC - 6 = midnight CST = 12:00 AM
    expect(formatUTCTimeToLocal('06:00:00', 'America/Chicago', beforeSpring)).toBe('12:00 AM');
  });

  it('uses CDT offset (UTC-5) for Mar 8 2026 (day of spring-forward)', () => {
    const springForwardDay = new Date(2026, 2, 8); // Mar 8 2026 — CDT starts
    // 06:00 UTC - 5 = 01:00 AM CDT
    expect(formatUTCTimeToLocal('06:00:00', 'America/Chicago', springForwardDay)).toBe('1:00 AM');
  });

  // America/New_York: fall-back Nov 1 2026 (02:00 → 01:00)
  it('uses EDT offset (UTC-4) for Oct 31 2026 (before fall-back)', () => {
    const beforeFallback = new Date(2026, 9, 31); // Oct 31 — still EDT
    // 04:00 UTC - 4 = midnight EDT = 12:00 AM
    expect(formatUTCTimeToLocal('04:00:00', 'America/New_York', beforeFallback)).toBe('12:00 AM');
  });

  it('uses EST offset (UTC-5) for Nov 1 2026 (day of fall-back)', () => {
    const fallbackDay = new Date(2026, 10, 1); // Nov 1 — EST starts
    // 05:00 UTC - 5 = midnight EST = 12:00 AM
    expect(formatUTCTimeToLocal('05:00:00', 'America/New_York', fallbackDay)).toBe('12:00 AM');
  });
});

describe('formatUTCTimeToLocal – edge formats', () => {
  // Use a fixed winter date so results are stable and predictable (CST = UTC-6)
  const winterDate = new Date(2026, 0, 15); // Jan 15 2026

  it('handles 00:00:00 — midnight boundary', () => {
    // 06:00 UTC - 6 = 12:00 AM CST
    expect(formatUTCTimeToLocal('06:00:00', 'America/Chicago', winterDate)).toBe('12:00 AM');
  });

  it('handles noon — 12:00 PM boundary', () => {
    // 18:00 UTC - 6 = 12:00 PM CST
    expect(formatUTCTimeToLocal('18:00:00', 'America/Chicago', winterDate)).toBe('12:00 PM');
  });

  it('handles single-digit hour — no leading zero in output', () => {
    // 15:00 UTC - 6 = 9:00 AM CST  (single-digit output "9:00 AM" not "09:00 AM")
    expect(formatUTCTimeToLocal('15:00:00', 'America/Chicago', winterDate)).toBe('9:00 AM');
  });

  it('handles HH:MM input without seconds', () => {
    // Same as above but without seconds component in input
    expect(formatUTCTimeToLocal('15:00', 'America/Chicago', winterDate)).toBe('9:00 AM');
  });

  it('handles minutes correctly', () => {
    // 15:30 UTC - 6 = 9:30 AM CST
    expect(formatUTCTimeToLocal('15:30:00', 'America/Chicago', winterDate)).toBe('9:30 AM');
  });
});

// ─── formatConflictLine ──────────────────────────────────────────────────────

describe('formatConflictLine – time-off passthrough', () => {
  it('returns the message directly for time-off conflicts', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'time-off',
      message: 'Employee has approved time-off on 2026-06-23',
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).toBe(
      'Employee has approved time-off on 2026-06-23',
    );
  });

  it('returns fallback for time-off conflict with no message', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'time-off',
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).toBe('Time-off conflict');
  });
});

describe('formatConflictLine – availability conflict with time window', () => {
  // Pin referenceDate to June 23 summer so DST offset is CDT (UTC-5).
  // 03:00 UTC = 10:00 PM CDT, 03:30 UTC = 10:30 PM CDT.
  const summerDate = new Date(2026, 5, 23);

  it('composes the availability window string using pinned referenceDate', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerDate);
    expect(result).toContain('available 10:00 PM – 10:30 PM');
  });

  it('includes the day label when the message contains an ISO date', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Conflict on 2026-06-23',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerDate);
    // Should contain the formatted availability window and some day context
    expect(result).toContain('10:00 PM – 10:30 PM');
    expect(result).toContain('Jun 23');
  });

  it('falls back to plain window string when no date in message', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerDate);
    expect(result).toMatch(/Outside availability window \(available .+ – .+\)/);
  });
});

describe('formatConflictLine – fallback cases', () => {
  it('returns message when no available_start/end present', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'No availability set for this day',
    };
    const result = formatConflictLine(conflict, 'America/Chicago');
    expect(result).toBe('No availability set for this day');
  });

  it('returns generic fallback when message is empty and no window', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).toBe('Scheduling conflict');
  });
});
