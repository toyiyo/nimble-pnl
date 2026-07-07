/**
 * shiftMutationPipeline — pure orchestration of shift-mutation validation.
 *
 * Composes the client-side `validateShift` business-rule checks with an
 * injected (DI'd) server-side conflict checker (time-off / availability RPCs)
 * so callers get a single `{ warnings, conflicts }` result to drive the
 * pending-confirmation UX. No side effects beyond the injected checker call —
 * this module performs no mutations itself.
 */
import { ShiftInterval } from './shiftInterval';
import { validateShift, type ValidationIssue } from './shiftValidator';
import { checkConflictsImperative } from '@/hooks/useConflictDetection';
import type { Shift, ConflictCheck } from '@/types/scheduling';

export type ConflictChecker = typeof checkConflictsImperative;

export interface CollectShiftIssuesArgs {
  employeeId: string;
  restaurantId: string;
  interval: ShiftInterval;
  shifts: Shift[];
  excludeShiftId?: string;
  /**
   * DI'd conflict checker (time-off / availability RPCs). Defaults to the
   * real `checkConflictsImperative`. Pass `false` to skip the RPC check
   * entirely (e.g. when the caller only needs client-side rule warnings).
   */
  checkConflicts?: ConflictChecker | false;
}

export interface CollectShiftIssuesResult {
  warnings: ValidationIssue[];
  conflicts: ConflictCheck[];
}

/**
 * Collects every shift-mutation issue: local business-rule warnings
 * (duration, overlap, clopen rest-gap) plus server-side conflicts (time-off,
 * availability) via the injected checker. Never swallows a checker
 * rejection — it propagates so callers can surface a real error instead of
 * silently proceeding as if no conflicts existed.
 */
export async function collectShiftIssues(
  args: CollectShiftIssuesArgs,
): Promise<CollectShiftIssuesResult> {
  const { employeeId, restaurantId, interval, shifts, excludeShiftId, checkConflicts } = args;

  const { warnings } = validateShift(
    { employeeId, interval },
    shifts,
    { excludeShiftId },
  );

  if (checkConflicts === false) {
    return { warnings, conflicts: [] };
  }

  const checker = checkConflicts ?? checkConflictsImperative;
  const { conflicts } = await checker({
    employeeId,
    restaurantId,
    startTime: interval.startAt.toISOString(),
    endTime: interval.endAt.toISOString(),
  });

  return { warnings, conflicts };
}

/** Typed error thrown when a mutation is attempted against a locked (published) shift. */
export class LockedShiftError extends Error {
  readonly shiftId: string;

  constructor(shiftId: string) {
    super('Cannot modify a locked shift. The schedule has been published.');
    this.name = 'LockedShiftError';
    this.shiftId = shiftId;
  }
}

/** Throws `LockedShiftError` if the shift is locked; no-op otherwise. */
export function assertNotLockedClient(shift: Shift): void {
  if (shift.locked) {
    throw new LockedShiftError(shift.id);
  }
}
