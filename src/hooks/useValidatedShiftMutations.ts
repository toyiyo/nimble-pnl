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
import { buildShiftPayload, type ShiftCreateInput } from '@/hooks/useShiftPlanner';

import type { Shift, ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';

export interface UpdateTimeInput {
  shift: Shift;
  startIso: string;
  endIso: string;
  businessDate: string;
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

export interface UpdateTimeOutcome {
  updated: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
}

export interface ReassignOutcome {
  reassigned: boolean;
  pendingConflicts?: ConflictCheck[];
  pendingWarnings?: ValidationIssue[];
}

export interface UseValidatedShiftMutationsOptions {
  /** DI'd conflict checker for tests; defaults to the real `checkConflictsImperative`. */
  checkConflicts?: ConflictChecker | false;
}

export interface UseValidatedShiftMutationsReturn {
  validateAndCreate: (input: ShiftCreateInput) => Promise<CreateOutcome>;
  forceCreate: (input: ShiftCreateInput) => Promise<boolean>;
  validateAndUpdateTime: (input: UpdateTimeInput) => Promise<UpdateTimeOutcome>;
  forceUpdateTime: (input: UpdateTimeInput) => Promise<boolean>;
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
  const { checkConflicts } = options;

  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShiftMutation = useDeleteShift();

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
  // Update time — ShiftInterval.fromTimestamps (never host-TZ split+create).
  // ---------------------------------------------------------------------------

  const validateAndUpdateTime = useCallback(
    async (input: UpdateTimeInput): Promise<UpdateTimeOutcome> => {
      if (!restaurantId) return { updated: false };

      assertNotLockedClient(input.shift);

      try {
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

      assertNotLockedClient(input.shift);

      try {
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
    validateAndUpdateTime,
    forceUpdateTime,
    validateAndReassign,
    forceReassign,
    deleteShift: handleDeleteShift,
    validationResult,
    clearValidation,
  };
}
