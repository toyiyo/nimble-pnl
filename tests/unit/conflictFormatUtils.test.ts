/**
 * Unit tests for conflictFormatUtils.ts
 *
 * Availability windows are stored and returned in restaurant local time
 * (available_start_local, available_end_local). The formatter shows them with
 * no time zone conversion.
 */
import { describe, it, expect } from 'vitest';
import type { ConflictCheck } from '@/types/scheduling';
import { formatConflictLine } from '@/lib/conflictFormatUtils';

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

describe('formatConflictLine – availability conflict with local window', () => {
  it('shows the local window with no conversion', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Shift on 2026-12-16 is outside employee availability',
      available_start_local: '10:00:00',
      available_end_local: '22:00:00',
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).toBe(
      'Shift on Wed, Dec 16 is outside availability (available 10:00 AM – 10:00 PM)',
    );
  });

  it('gives the same local text in summer and winter', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'exception',
      message: 'Shift on 2026-06-23 is outside employee availability',
      available_start_local: '17:00:00',
      available_end_local: '00:00:00',
    };
    expect(formatConflictLine(conflict, 'America/Chicago', new Date(2026, 0, 5))).toContain(
      'available 5:00 PM – 12:00 AM',
    );
  });

  it('shows a window with no date in the message', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Outside window',
      available_start_local: '09:30:00',
      available_end_local: '17:00:00',
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).toBe(
      'Outside availability window (available 9:30 AM – 5:00 PM)',
    );
  });

  it('does not show a legacy UTC window when the local fields are null', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Shift on 2026-12-16 is outside employee availability',
      available_start: '16:00:00',
      available_end: '04:00:00',
      available_start_local: null,
      available_end_local: null,
    };
    const line = formatConflictLine(conflict, 'America/Chicago');
    expect(line).not.toContain('10:00 AM');
    expect(line).not.toContain('available ');
    expect(line).toContain('Wed, Dec 16');
  });

  it('does not show a legacy UTC window when no local fields exist', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Shift on 2026-12-16 is outside employee availability',
      available_start: '16:00:00',
      available_end: '04:00:00',
    };
    expect(formatConflictLine(conflict, 'America/Chicago')).not.toContain('10:00 AM');
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

  it('does not throw on a regex-matching but calendar-invalid date', () => {
    // The SQL only emits real dates, so this is unreachable in production, but
    // formatConflictLine runs inside render — a throw here would crash the
    // conflict dialog. A malformed date must degrade to the raw string, not raise.
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Shift on 2026-02-31 is outside availability',
    };
    let result = '';
    expect(() => {
      result = formatConflictLine(conflict, 'America/Chicago');
    }).not.toThrow();
    expect(result).toContain('2026-02-31');
  });
});

// ─── Caller contract verification ─────────────────────────────────────────────
//
// Asserts that formatConflictLine is callable with 2 args (conflict, timezone)
// exactly as ShiftDialog.tsx and AvailabilityConflictDialog.tsx call it.
// The referenceDate parameter must default to today so callers need not change.
// If the signature ever breaks the 2-arg form this test will fail at compile time.
//

describe('formatConflictLine – 2-arg caller contract (ShiftDialog / AvailabilityConflictDialog)', () => {
  it('accepts (conflict, timezone) without referenceDate and returns a non-empty string', () => {
    const conflict: ConflictCheck = {
      has_conflict: false,
      conflict_type: 'recurring',
      message: 'No availability set for this day',
    };
    const result = formatConflictLine(conflict, 'America/Chicago');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('renders the hard-off recurring line without a window', () => {
    const conflict: ConflictCheck = {
      has_conflict: true,
      conflict_type: 'recurring',
      message: 'Employee is not available on this day of the week',
    };
    expect(formatConflictLine(conflict, 'America/New_York')).toBe(
      'Employee is not available on this day of the week',
    );
  });
});
