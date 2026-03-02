/**
 * ShiftValidator — runs business-rule checks against existing shifts.
 *
 * Returns errors (block mutation) and warnings (show in UI, allow override).
 */
import { ShiftInterval } from './shiftInterval';
import type { Shift, TimeOffRequest } from '@/types/scheduling';

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
  timeOffRequests?: TimeOffRequest[];
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

/** Check time-off conflicts for an employee. */
function checkTimeOffConflicts(
  proposed: { employeeId: string; interval: ShiftInterval },
  timeOffRequests: TimeOffRequest[],
  errors: ValidationIssue[],
): void {
  const relevant = timeOffRequests.filter(
    (r) =>
      r.employee_id === proposed.employeeId &&
      (r.status === 'approved' || r.status === 'pending'),
  );

  for (const request of relevant) {
    const requestStart = new Date(`${request.start_date}T00:00:00`);
    const requestEnd = new Date(`${request.end_date}T23:59:59`);

    if (
      proposed.interval.startAt <= requestEnd &&
      proposed.interval.endAt >= requestStart
    ) {
      errors.push({
        code: 'TIME_OFF',
        message: `Employee has ${request.status} time-off from ${request.start_date} to ${request.end_date}`,
      });
    }
  }
}

export function validateShift(
  proposed: { employeeId: string; interval: ShiftInterval },
  existingShifts: Shift[],
  options?: ValidateOptions,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

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
      errors.push({
        code: 'OVERLAP',
        message: `Overlaps with existing shift (${formatTime(existing.start_time)} - ${formatTime(existing.end_time)})`,
      });
    }

    checkRestGap(existingInterval.restHoursUntil(proposed.interval), 'after', warnings);
    checkRestGap(proposed.interval.restHoursUntil(existingInterval), 'before', warnings);
  }

  if (options?.timeOffRequests) {
    checkTimeOffConflicts(proposed, options.timeOffRequests, errors);
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
