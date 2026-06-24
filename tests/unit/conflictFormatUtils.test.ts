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

  it('uses CST offset (UTC-6) for Mar 8 2026 06:00 UTC (before spring-forward at 08:00 UTC)', () => {
    const springForwardDay = new Date(2026, 2, 8); // Mar 8 2026
    // Spring-forward in Chicago: 2:00 AM CST = 8:00 UTC. 06:00 UTC is before that, so CST applies.
    // 06:00 UTC - 6 = 12:00 AM CST
    expect(formatUTCTimeToLocal('06:00:00', 'America/Chicago', springForwardDay)).toBe('12:00 AM');
  });

  // America/New_York: fall-back Nov 1 2026 (02:00 → 01:00)
  it('uses EDT offset (UTC-4) for Oct 31 2026 (before fall-back)', () => {
    const beforeFallback = new Date(2026, 9, 31); // Oct 31 — still EDT
    // 04:00 UTC - 4 = midnight EDT = 12:00 AM
    expect(formatUTCTimeToLocal('04:00:00', 'America/New_York', beforeFallback)).toBe('12:00 AM');
  });

  it('uses EDT offset (UTC-4) for Nov 1 2026 05:00 UTC (before fall-back at 06:00 UTC)', () => {
    const fallbackDay = new Date(2026, 10, 1); // Nov 1 — fall-back day
    // Fall-back in NY: 2:00 AM EDT = 6:00 UTC. 05:00 UTC is before that, so EDT (-4) still applies.
    // 05:00 UTC - 4 = 01:00 AM EDT
    expect(formatUTCTimeToLocal('05:00:00', 'America/New_York', fallbackDay)).toBe('1:00 AM');
  });
});

describe('formatUTCTimeToLocal – edge formats', () => {
  // Use a fixed winter date so results are stable and predictable (CST = UTC-6)
  const winterDate = new Date(2026, 0, 15); // Jan 15 2026

  it('handles midnight local (06:00 UTC → 12:00 AM CST)', () => {
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

  it('includes the day label and corrected window when message contains an ISO date', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Conflict on 2026-06-23',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerDate);
    // The core fix: time window must show 10:00/10:30 PM (CDT), not 9:00/9:30 PM (CST).
    expect(result).toContain('10:00 PM – 10:30 PM');
    // Note: extractDayLabel parses the ISO date as UTC midnight, which in CDT (UTC-5) falls
    // on Jun 22. This is a known out-of-scope display issue (design doc non-goal #2).
    // We verify the label is present (whatever day is shown) rather than asserting the exact date.
    expect(result).toMatch(/Jun 2[23]/);
  });

});

describe('formatConflictLine – exception conflict uses exception-date anchor', () => {
  // The exception writer (AvailabilityExceptionDialog) anchors to the exception's own date.
  // If today is CDT (summer) but the exception was written in CST (winter), the reader must
  // use the exception date as the DST anchor — not today — to reproduce the stored local time.
  it('uses winter CST offset for a January exception when today is summer CDT', () => {
    // Exception written on Jan 15 2026 (CST, UTC-6): local 10 PM = 04:00:00 UTC
    // If reader uses today (CDT, UTC-5): 04:00:00 UTC - 5 = 11 PM → wrong
    // If reader uses Jan 15 (CST, UTC-6): 04:00:00 UTC - 6 = 10 PM → correct
    const summerToday = new Date(2026, 5, 23); // June 23 — CDT reference passed as default
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'exception',
      message: 'Shift on 2026-01-15 is outside employee availability window (04:00:00 - 04:30:00)',
      available_start: '04:00:00',
      available_end: '04:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerToday);
    // Must show 10:00 PM / 10:30 PM (CST, Jan anchor), not 11:00 PM / 11:30 PM (CDT, today)
    expect(result).toContain('10:00 PM – 10:30 PM');
  });

  it('uses summer CDT offset for a June exception when today is winter CST', () => {
    // Exception written on Jun 23 2026 (CDT, UTC-5): local 10 PM = 03:00:00 UTC
    // If reader uses today (CST, UTC-6): 03:00:00 UTC - 6 = 9 PM → wrong
    // If reader uses Jun 23 (CDT, UTC-5): 03:00:00 UTC - 5 = 10 PM → correct
    const winterToday = new Date(2026, 0, 15); // Jan 15 — CST reference passed as default
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'exception',
      message: 'Shift on 2026-06-23 is outside employee availability window (03:00:00 - 03:30:00)',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', winterToday);
    // Must show 10:00 PM / 10:30 PM (CDT, Jun anchor), not 9:00 PM / 9:30 PM (CST, today)
    expect(result).toContain('10:00 PM – 10:30 PM');
  });

  it('falls back to referenceDate when exception message has no ISO date', () => {
    const summerDate = new Date(2026, 5, 23);
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'exception',
      available_start: '03:00:00',
      available_end: '03:30:00',
    };
    const result = formatConflictLine(conflict, 'America/Chicago', summerDate);
    // With summer anchor (CDT): 03:00 UTC = 10:00 PM
    expect(result).toContain('10:00 PM – 10:30 PM');
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

// ─── Caller contract verification ─────────────────────────────────────────────
//
// Asserts that formatConflictLine is callable with 2 args (conflict, timezone)
// exactly as ShiftDialog.tsx and AvailabilityConflictDialog.tsx call it.
// The referenceDate parameter must default to today so callers need not change.
// If the signature ever breaks the 2-arg form this test will fail at compile time.
//
// External-importer note: formatUTCTimeToLocal has no external callers (verified
// by grepping src/ — zero external importers). Only conflictFormatUtils.ts uses it
// internally. Both production callers import formatConflictLine only.

describe('formatConflictLine – 2-arg caller contract (ShiftDialog / AvailabilityConflictDialog)', () => {
  it('accepts (conflict, timezone) without referenceDate and returns a non-empty string', () => {
    // Compile error here means a caller-breaking signature change occurred.
    const conflict: ConflictCheck = {
      has_conflict: false,
      conflict_type: 'recurring',
      message: 'No availability set for this day',
    };
    const result = formatConflictLine(conflict, 'America/Chicago');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
