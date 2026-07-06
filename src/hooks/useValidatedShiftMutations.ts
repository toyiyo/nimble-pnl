/**
 * useValidatedShiftMutations — the single validate→confirm→mutate pipeline for shift
 * mutations, shared by the planner (`useShiftPlanner`) and the Timeline edit/create surface.
 *
 * Orchestrates `collectShiftIssues` (client-side `validateShift` + DI'd RPC conflict checker)
 * with the `useShifts` mutation hooks. Every write path (create/update-time/reassign/delete)
 * runs the same lock guard; update/reassign run all three validation layers (duration/overlap
 * rules, clopen rest-gap, and server-side time-off/availability conflicts) and surface pending
 * issues instead of silently proceeding, matching `useShiftPlanner.validateAndCreate`'s existing
 * pending-confirmation UX.
 *
 * `validateAndUpdateTime` builds its interval via `ShiftInterval.fromTimestamps` — never the
 * host-TZ `split('T')` + `ShiftInterval.create()` reconstruction, which would silently
 * re-anchor the wall-clock time in the host's timezone instead of the restaurant's.
 */
import { useCallback, useState } from 'react';

import { useCreateShift, useUpdateShift, useDeleteShift } from '@/hooks/useShifts';
import { ShiftInterval } from '@/lib/shiftInterval';
import { ValidationResult } from '@/lib/shiftValidator';
import {
  collectShiftIssues,
  assertNotLockedClient,
  type ConflictChecker,
} from '@/lib/shiftMutationPipeline';
import { buildShiftPayload, buildShiftInsert, type ShiftCreateInput } from '@/hooks/useShiftPlanner';

import type { Shift, ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';

/**
 * TZ-safe create input for the Timeline surface: carries UTC ISO instants (built
 * upstream by `minutesToIso`) rather than host-local `HH:MM`, so the shift is
 * anchored in the restaurant's timezone regardless of the manager's device TZ.
 */
export interface CreateAtTimeInput {
  employeeId: string;
  startIso: string;
  endIso: string;
  businessDate: string;
  position: string;
  breakDuration?: number;
  notes?: string;
  shiftTemplateId?: string;
}

export interface UpdateTimeInput {
  shift: Shift;
  startIso: string;
  endIso: string;
  businessDate: string;
}

/**
 * Full-field edit input for the Timeline popover's edit-mode Save: carries
 * every field `TimelineShiftEditor` exposes (employee, break, notes) in
 * addition to the time range, so a single Save persists all of them together
 * instead of silently dropping the non-time fields (the bug `validateAndUpdateTime`
 * alone produced — it only ever wrote start_time/end_time).
 */
export interface UpdateShiftInput {
  shift: Shift;
  startIso: string;
  endIso: string;
  businessDate: string;
  employeeId: string;
  breakDuration: number;
  notes: string;
}

export interface ReassignInput {
  shift: Shift;
  newEmployeeId: string;
}

export interface CreateOutcome {
  created: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
  pendingInput?: ShiftCreateInput;
}

export interface CreateAtTimeOutcome {
  created: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
  pendingInput?: CreateAtTimeInput;
}

export interface UpdateTimeOutcome {
  updated: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
}

/** Same shape as `UpdateTimeOutcome` — the full-field edit pipeline mirrors the time-only one. */
export type UpdateShiftOutcome = UpdateTimeOutcome;

export interface ReassignOutcome {
  reassigned: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
}

export interface UseValidatedShiftMutationsOptions {
  /** DI'd conflict checker for tests; defaults to the real `checkConflictsImperative`. */
  checkConflicts?: ConflictChecker | false;
  /**
   * When true, suppresses the underlying `useDeleteShift` mutation's generic
   * "Shift deleted" success toast. Used by the Timeline's `deleteShiftWithUndo`
   * flow, which shows its own single toast (with an Undo action) instead of
   * stacking a second, non-undoable one. Defaults to false — the planner's
   * usage (no undo affordance) is unaffected.
   */
  silentDelete?: boolean;
}

export interface UseValidatedShiftMutationsReturn {
  validateAndCreate: (input: ShiftCreateInput) => Promise<CreateOutcome>;
  forceCreate: (input: ShiftCreateInput) => Promise<boolean>;
  validateAndCreateAtTime: (input: CreateAtTimeInput) => Promise<CreateAtTimeOutcome>;
  forceCreateAtTime: (input: CreateAtTimeInput) => Promise<boolean>;
  validateAndUpdateTime: (input: UpdateTimeInput) => Promise<UpdateTimeOutcome>;
  forceUpdateTime: (input: UpdateTimeInput) => Promise<boolean>;
  validateAndUpdateShift: (input: UpdateShiftInput) => Promise<UpdateShiftOutcome>;
  forceUpdateShift: (input: UpdateShiftInput) => Promise<UpdateShiftOutcome>;
  validateAndReassign: (input: ReassignInput) => Promise<ReassignOutcome>;
  forceReassign: (input: ReassignInput) => Promise<boolean>;
  deleteShift: (shiftId: string) => void;
  validationResult: ValidationResult | null;
  clearValidation: () => void;
}

function errorToValidationResult(err: unknown, fallback: string): ValidationResult {
  const message = err instanceof Error ? err.message : fallback;
  return {
    valid: false,
    errors: [{ code: message, message }],
    warnings: [],
  };
}

/** Build the insert payload for a TZ-safe (ISO-instant) timeline create. */
function buildAtTimeInsert(
  restaurantId: string,
  input: CreateAtTimeInput,
  interval: ShiftInterval,
) {
  return buildShiftInsert(
    restaurantId,
    {
      employeeId: input.employeeId,
      position: input.position,
      breakDuration: input.breakDuration,
      notes: input.notes,
      shiftTemplateId: input.shiftTemplateId ?? null,
    },
    interval,
  );
}

/** Find a shift by id in the current in-memory list, throwing if it's missing. */
function findShiftOrThrow(shifts: Shift[], shiftId: string): Shift {
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) {
    throw new Error(`Shift ${shiftId} not found`);
  }
  return shift;
}

export function useValidatedShiftMutations(
  restaurantId: string | null,
  shifts: Shift[],
  options: UseValidatedShiftMutationsOptions = {},
): UseValidatedShiftMutationsReturn {
  const { checkConflicts, silentDelete = false } = options;

  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShiftMutation = useDeleteShift({ silent: silentDelete });

  const clearValidation = useCallback(() => {
    setValidationResult(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Create (unchanged shape — host-local ShiftInterval.create, matching the
  // planner's existing convention; the timeline builds ISO inputs upstream via
  // minutesToIso before calling this).
  // ---------------------------------------------------------------------------

  const validateAndCreate = useCallback(
    async (input: ShiftCreateInput): Promise<CreateOutcome> => {
      if (!restaurantId) return { created: false };

      try {
        const interval = ShiftInterval.create(input.date, input.startTime, input.endTime);

        const { warnings, conflicts } = await collectShiftIssues({
          employeeId: input.employeeId,
          restaurantId,
          interval,
          shifts,
          checkConflicts,
        });

        setValidationResult({ valid: true, errors: [], warnings });

        if (warnings.length > 0 || conflicts.length > 0) {
          return {
            created: false,
            pendingConflicts: conflicts,
            pendingWarnings: warnings,
            pendingInput: input,
          };
        }

        await createShift.mutateAsync(buildShiftPayload(restaurantId, input, interval));

        setValidationResult(null);
        return { created: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift'));
        return { created: false };
      }
    },
    [restaurantId, shifts, checkConflicts, createShift],
  );

  const forceCreate = useCallback(
    async (input: ShiftCreateInput): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        const interval = ShiftInterval.create(input.date, input.startTime, input.endTime);

        await createShift.mutateAsync(buildShiftPayload(restaurantId, input, interval));

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Failed to create shift'));
        return false;
      }
    },
    [restaurantId, createShift],
  );

  // ---------------------------------------------------------------------------
  // Create at time — TZ-safe timeline path. Builds the interval via
  // ShiftInterval.fromTimestamps (never host-local .create), so ISO instants
  // produced by minutesToIso are anchored in the restaurant's timezone.
  // ---------------------------------------------------------------------------

  const validateAndCreateAtTime = useCallback(
    async (input: CreateAtTimeInput): Promise<CreateAtTimeOutcome> => {
      if (!restaurantId) return { created: false };

      try {
        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        const { warnings, conflicts } = await collectShiftIssues({
          employeeId: input.employeeId,
          restaurantId,
          interval,
          shifts,
          checkConflicts,
        });

        setValidationResult({ valid: true, errors: [], warnings });

        if (warnings.length > 0 || conflicts.length > 0) {
          return {
            created: false,
            pendingConflicts: conflicts,
            pendingWarnings: warnings,
            pendingInput: input,
          };
        }

        await createShift.mutateAsync(buildAtTimeInsert(restaurantId, input, interval));

        setValidationResult(null);
        return { created: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift'));
        return { created: false };
      }
    },
    [restaurantId, shifts, checkConflicts, createShift],
  );

  const forceCreateAtTime = useCallback(
    async (input: CreateAtTimeInput): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        await createShift.mutateAsync(buildAtTimeInsert(restaurantId, input, interval));

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Failed to create shift'));
        return false;
      }
    },
    [restaurantId, createShift],
  );

  // ---------------------------------------------------------------------------
  // Update time — ShiftInterval.fromTimestamps (never host-TZ split+create).
  // ---------------------------------------------------------------------------

  const validateAndUpdateTime = useCallback(
    async (input: UpdateTimeInput): Promise<UpdateTimeOutcome> => {
      if (!restaurantId) return { updated: false };

      try {
        assertNotLockedClient(input.shift);

        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        const { warnings, conflicts } = await collectShiftIssues({
          employeeId: input.shift.employee_id,
          restaurantId,
          interval,
          shifts,
          excludeShiftId: input.shift.id,
          checkConflicts,
        });

        setValidationResult({ valid: true, errors: [], warnings });

        if (warnings.length > 0 || conflicts.length > 0) {
          return { updated: false, pendingConflicts: conflicts, pendingWarnings: warnings };
        }

        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
        });

        setValidationResult(null);
        return { updated: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift time'));
        return { updated: false };
      }
    },
    [restaurantId, shifts, checkConflicts, updateShift],
  );

  const forceUpdateTime = useCallback(
    async (input: UpdateTimeInput): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        assertNotLockedClient(input.shift);

        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
        });

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Failed to update shift'));
        return false;
      }
    },
    [restaurantId, updateShift],
  );

  // ---------------------------------------------------------------------------
  // Update shift (full-field edit — the Timeline popover's edit-mode Save).
  // Unlike validateAndUpdateTime (time-only), this persists every field
  // TimelineShiftEditor exposes — employee, break duration, notes — in a
  // single mutateAsync call, and validates against the possibly-NEW employee
  // (a reassign-on-save), not the shift's original one.
  // ---------------------------------------------------------------------------

  const validateAndUpdateShift = useCallback(
    async (input: UpdateShiftInput): Promise<UpdateShiftOutcome> => {
      if (!restaurantId) return { updated: false };

      try {
        assertNotLockedClient(input.shift);

        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        const { warnings, conflicts } = await collectShiftIssues({
          employeeId: input.employeeId,
          restaurantId,
          interval,
          shifts,
          excludeShiftId: input.shift.id,
          checkConflicts,
        });

        setValidationResult({ valid: true, errors: [], warnings });

        if (warnings.length > 0 || conflicts.length > 0) {
          return { updated: false, pendingConflicts: conflicts, pendingWarnings: warnings };
        }

        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
          employee_id: input.employeeId,
          break_duration: input.breakDuration,
          notes: input.notes,
        });

        setValidationResult(null);
        return { updated: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift'));
        return { updated: false };
      }
    },
    [restaurantId, shifts, checkConflicts, updateShift],
  );

  const forceUpdateShift = useCallback(
    async (input: UpdateShiftInput): Promise<UpdateShiftOutcome> => {
      if (!restaurantId) return { updated: false };

      try {
        assertNotLockedClient(input.shift);

        const interval = ShiftInterval.fromTimestamps(
          input.startIso,
          input.endIso,
          input.businessDate,
        );

        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
          employee_id: input.employeeId,
          break_duration: input.breakDuration,
          notes: input.notes,
        });

        setValidationResult(null);
        return { updated: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Failed to update shift'));
        return { updated: false };
      }
    },
    [restaurantId, updateShift],
  );

  // ---------------------------------------------------------------------------
  // Reassign
  // ---------------------------------------------------------------------------

  const validateAndReassign = useCallback(
    async (input: ReassignInput): Promise<ReassignOutcome> => {
      if (!restaurantId) return { reassigned: false };

      assertNotLockedClient(input.shift);

      try {
        const interval = ShiftInterval.fromTimestamps(
          input.shift.start_time,
          input.shift.end_time,
          input.shift.start_time.split('T')[0],
        );

        const { warnings, conflicts } = await collectShiftIssues({
          employeeId: input.newEmployeeId,
          restaurantId,
          interval,
          shifts,
          excludeShiftId: input.shift.id,
          checkConflicts,
        });

        setValidationResult({ valid: true, errors: [], warnings });

        if (warnings.length > 0 || conflicts.length > 0) {
          return { reassigned: false, pendingConflicts: conflicts, pendingWarnings: warnings };
        }

        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          employee_id: input.newEmployeeId,
        });

        setValidationResult(null);
        return { reassigned: true };
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Cannot reassign this shift'));
        return { reassigned: false };
      }
    },
    [restaurantId, shifts, checkConflicts, updateShift],
  );

  const forceReassign = useCallback(
    async (input: ReassignInput): Promise<boolean> => {
      if (!restaurantId) return false;

      assertNotLockedClient(input.shift);

      try {
        await updateShift.mutateAsync({
          id: input.shift.id,
          restaurant_id: restaurantId,
          employee_id: input.newEmployeeId,
        });

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Cannot reassign this shift'));
        return false;
      }
    },
    [restaurantId, updateShift],
  );

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDeleteShift = useCallback(
    (shiftId: string) => {
      if (!restaurantId) return;

      const shift = findShiftOrThrow(shifts, shiftId);
      assertNotLockedClient(shift);

      deleteShiftMutation.mutate({ id: shiftId, restaurantId });
    },
    [restaurantId, shifts, deleteShiftMutation],
  );

  return {
    validateAndCreate,
    forceCreate,
    validateAndCreateAtTime,
    forceCreateAtTime,
    validateAndUpdateTime,
    forceUpdateTime,
    validateAndUpdateShift,
    forceUpdateShift,
    validateAndReassign,
    forceReassign,
    deleteShift: handleDeleteShift,
    validationResult,
    clearValidation,
  };
}
