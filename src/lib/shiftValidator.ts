/**
 * ShiftValidator — runs business-rule checks against existing shifts.
 *
 * Returns errors (block mutation) and warnings (show in UI, allow override).
 *
 * Scope note: time-off and availability conflicts are NOT checked here. They are
 * owned by the `check_timeoff_conflict` / `check_availability_conflict` RPCs
 * (see `useConflictDetection`), which resolve calendar days in the restaurant's
 * timezone. A client-side mirror of the time-off check used to live here; it was
 * unreachable (no caller ever supplied the requests) and bucketed by the
 * viewer's browser timezone, so it would have disagreed with the server. Don't
 * reintroduce one — the dialog would render the same warning twice.
 */
import { ShiftInterval } from './shiftInterval';
import type { Shift } from '@/types/scheduling';

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidateOptions {
  excludeShiftId?: string;
}

const MIN_REST_HOURS = 8;

/** Check if rest gap triggers a clopen warning. */
function checkRestGap(
  gap: number,
  direction: 'after' | 'before',
  warnings: ValidationIssue[],
): void {
  if (gap > 0 && gap < MIN_REST_HOURS) {
    const label = direction === 'after' ? 'after previous shift' : 'before next shift';
    warnings.push({
      code: 'CLOPEN',
      message: `Only ${gap.toFixed(1)}h rest ${label} (minimum ${MIN_REST_HOURS}h)`,
    });
  }
}

export function validateShift(
  proposed: { employeeId: string; interval: ShiftInterval },
  existingShifts: Shift[],
  options?: ValidateOptions,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Surface duration warnings from the proposed shift interval
  for (const dw of proposed.interval.durationWarnings) {
    warnings.push({ code: dw.code, message: dw.message });
  }

  const employeeShifts = existingShifts.filter(
    (s) =>
      s.employee_id === proposed.employeeId &&
      s.status !== 'cancelled' &&
      s.id !== options?.excludeShiftId,
  );

  for (const existing of employeeShifts) {
    const existingInterval = ShiftInterval.fromTimestamps(
      existing.start_time,
      existing.end_time,
      existing.start_time.split('T')[0],
    );

    if (proposed.interval.overlapsWith(existingInterval)) {
      warnings.push({
        code: 'OVERLAP',
        message: `Overlaps with existing shift (${formatTime(existing.start_time)} - ${formatTime(existing.end_time)})`,
      });
    }

    checkRestGap(existingInterval.restHoursUntil(proposed.interval), 'after', warnings);
    checkRestGap(proposed.interval.restHoursUntil(existingInterval), 'before', warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
