/**
 * useShiftPlanner — orchestrates week navigation, grid data computation,
 * and validated mutations for the shift planner view.
 *
 * Pure utility functions (getWeekDays, buildGridData) are exported separately
 * for testability without React.
 */
import { useState, useMemo, useCallback } from 'react';

import { useShifts, useCreateShift, useUpdateShift, useDeleteShift } from '@/hooks/useShifts';
import { useEmployees } from '@/hooks/useEmployees';

import { ShiftInterval, formatLocalDate } from '@/lib/shiftInterval';
import { validateShift, ValidationResult } from '@/lib/shiftValidator';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Pure utility functions (tested without React)
// ---------------------------------------------------------------------------

/**
 * Extract local-timezone HH:MM:SS from an ISO timestamp string.
 * Handles both 'Z' and '+00:00' suffixed UTC strings from Supabase,
 * as well as naive strings without timezone.
 */
export function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Returns an array of 7 date strings (YYYY-MM-DD) starting from weekStart.
 * Uses local timezone date formatting (not toISOString).
 */
export function getWeekDays(weekStart: Date): string[] {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    days.push(formatLocalDate(day));
  }
  return days;
}

/**
 * Groups shifts into a Map<employeeId, Map<dayString, Shift[]>>.
 * Shifts without an employee_id are grouped under '__open__'.
 * Only includes shifts whose start_time date falls within weekDays.
 */
export function buildGridData(
  shifts: Shift[],
  weekDays: string[],
): Map<string, Map<string, Shift[]>> {
  const weekDaySet = new Set(weekDays);
  const grid = new Map<string, Map<string, Shift[]>>();

  for (const shift of shifts) {
    // Extract the date portion from start_time using local timezone
    const dayStr = formatLocalDate(new Date(shift.start_time));

    // Only include shifts that fall within the week
    if (!weekDaySet.has(dayStr)) continue;

    const empId = shift.employee_id || '__open__';

    let employeeDays = grid.get(empId);
    if (!employeeDays) {
      employeeDays = new Map<string, Shift[]>();
      grid.set(empId, employeeDays);
    }

    let dayShifts = employeeDays.get(dayStr);
    if (!dayShifts) {
      dayShifts = [];
      employeeDays.set(dayStr, dayShifts);
    }

    dayShifts.push(shift);
  }

  return grid;
}

/** Push a shift into the nested Map<dayString, Shift[]> bucket. */
function pushToGridBucket(
  bucket: Map<string, Shift[]>,
  dayStr: string,
  shift: Shift,
): void {
  let dayShifts = bucket.get(dayStr);
  if (!dayShifts) {
    dayShifts = [];
    bucket.set(dayStr, dayShifts);
  }
  dayShifts.push(shift);
}

/** Find the first template that matches a shift's time and position. */
function findMatchingTemplate(
  templates: ShiftTemplate[],
  shiftStart: string,
  shiftEnd: string,
  position: string,
): ShiftTemplate | undefined {
  return templates.find(
    (t) => t.start_time === shiftStart && t.end_time === shiftEnd && t.position === position,
  );
}

/**
 * Groups shifts into a Map<templateId, Map<dayString, Shift[]>>.
 * Matches shifts to templates by comparing start_time (HH:MM:SS),
 * end_time (HH:MM:SS), and position.
 * Unmatched shifts go under '__unmatched__'. Cancelled shifts are excluded.
 */
export function buildTemplateGridData(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): Map<string, Map<string, Shift[]>> {
  const weekDaySet = new Set(weekDays);
  const grid = new Map<string, Map<string, Shift[]>>();

  for (const t of templates) {
    grid.set(t.id, new Map());
  }
  grid.set('__unmatched__', new Map());

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const dayStr = formatLocalDate(new Date(shift.start_time));
    if (!weekDaySet.has(dayStr)) continue;

    const shiftStart = formatLocalTime(shift.start_time);
    const shiftEnd = formatLocalTime(shift.end_time);
    const match = findMatchingTemplate(templates, shiftStart, shiftEnd, shift.position);

    const bucketKey = match ? match.id : '__unmatched__';
    pushToGridBucket(grid.get(bucketKey)!, dayStr, shift);
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errorToValidationResult(err: unknown, fallback: string): ValidationResult {
  const message = err instanceof Error ? err.message : fallback;
  return {
    valid: false,
    errors: [{ code: message, message }],
    warnings: [],
  };
}

/**
 * Get the Monday of the week containing the given date.
 * Sets time to midnight local.
 */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // If Sunday, go back 6 days
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Compute the end of the week (Sunday 23:59:59.999) from a Monday start.
 */
export function getWeekEnd(monday: Date): Date {
  const end = new Date(monday);
  end.setDate(monday.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Compute total scheduled hours across all shifts (excluding breaks).
 */
export function computeTotalHours(shifts: Shift[]): number {
  let total = 0;
  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const startMs = new Date(shift.start_time).getTime();
    const endMs = new Date(shift.end_time).getTime();
    const durationMinutes = (endMs - startMs) / 60_000;
    const netMinutes = durationMinutes - (shift.break_duration || 0);
    if (netMinutes > 0) {
      total += netMinutes / 60;
    }
  }
  return Math.round(total * 100) / 100; // Round to 2 decimal places
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface UseShiftPlannerReturn {
  // Week navigation
  weekStart: Date;
  weekEnd: Date;
  weekDays: string[];
  goToNextWeek: () => void;
  goToPrevWeek: () => void;
  goToToday: () => void;

  // Data
  shifts: Shift[];
  employees: ReturnType<typeof useEmployees>['employees'];
  isLoading: boolean;
  error: Error | null;

  // Mutations
  validateAndCreate: (input: {
    employeeId: string;
    date: string;
    startTime: string;
    endTime: string;
    position: string;
    breakDuration?: number;
    notes?: string;
  }) => Promise<boolean>;
  validateAndUpdateTime: (input: {
    shift: Shift;
    newStartTime: string;
    newEndTime: string;
  }) => Promise<boolean>;
  validateAndReassign: (input: {
    shift: Shift;
    newEmployeeId: string;
  }) => Promise<boolean>;
  deleteShift: (shiftId: string) => void;

  // Validation
  validationResult: ValidationResult | null;
  clearValidation: () => void;

  // Summary
  totalHours: number;
}

export function useShiftPlanner(
  restaurantId: string | null,
): UseShiftPlannerReturn {
  // Week navigation state
  const [weekStart, setWeekStart] = useState<Date>(() =>
    getMondayOfWeek(new Date()),
  );

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Validation state
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);

  // Data hooks
  const { shifts, loading: shiftsLoading, error: shiftsError } = useShifts(
    restaurantId,
    weekStart,
    weekEnd,
  );
  const { employees, loading: employeesLoading, error: employeesError } = useEmployees(restaurantId, {
    status: 'active',
  });

  // Mutation hooks
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShiftMutation = useDeleteShift();

  // Computed data
  const totalHours = useMemo(() => computeTotalHours(shifts), [shifts]);

  const isLoading = shiftsLoading || employeesLoading;
  const error = shiftsError || employeesError;

  // Navigation
  const goToNextWeek = useCallback(() => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  }, []);

  const goToPrevWeek = useCallback(() => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  }, []);

  const goToToday = useCallback(() => {
    setWeekStart(getMondayOfWeek(new Date()));
  }, []);

  // Validation helper
  const clearValidation = useCallback(() => {
    setValidationResult(null);
  }, []);

  // Validated mutations
  const validateAndCreate = useCallback(
    async (input: {
      employeeId: string;
      date: string;
      startTime: string;
      endTime: string;
      position: string;
      breakDuration?: number;
      notes?: string;
    }): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        const interval = ShiftInterval.create(
          input.date,
          input.startTime,
          input.endTime,
        );

        const result = validateShift(
          { employeeId: input.employeeId, interval },
          shifts,
        );

        setValidationResult(result);

        if (!result.valid) return false;

        await createShift.mutateAsync({
          restaurant_id: restaurantId,
          employee_id: input.employeeId,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
          position: input.position,
          break_duration: input.breakDuration ?? 0,
          notes: input.notes,
          status: 'scheduled',
          is_published: false,
          locked: false,
        });

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift'));
        return false;
      }
    },
    [restaurantId, shifts, createShift],
  );

  const validateAndUpdateTime = useCallback(
    async (input: {
      shift: Shift;
      newStartTime: string;
      newEndTime: string;
    }): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        const [date, startTimePart] = input.newStartTime.split('T');
        const [, endTimePart] = input.newEndTime.split('T');

        if (!startTimePart || !endTimePart) {
          setValidationResult(errorToValidationResult(
            new Error('Invalid time format'),
            'Invalid shift time',
          ));
          return false;
        }

        const startHHMM = startTimePart.substring(0, 5);
        const endHHMM = endTimePart.substring(0, 5);

        const interval = ShiftInterval.create(date, startHHMM, endHHMM);

        const result = validateShift(
          { employeeId: input.shift.employee_id, interval },
          shifts,
          { excludeShiftId: input.shift.id },
        );

        setValidationResult(result);

        if (!result.valid) return false;

        await updateShift.mutateAsync({
          id: input.shift.id,
          start_time: interval.startAt.toISOString(),
          end_time: interval.endAt.toISOString(),
        });

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Invalid shift time'));
        return false;
      }
    },
    [restaurantId, shifts, updateShift],
  );

  const validateAndReassign = useCallback(
    async (input: {
      shift: Shift;
      newEmployeeId: string;
    }): Promise<boolean> => {
      if (!restaurantId) return false;

      try {
        const interval = ShiftInterval.fromTimestamps(
          input.shift.start_time,
          input.shift.end_time,
          input.shift.start_time.split('T')[0],
        );

        const result = validateShift(
          { employeeId: input.newEmployeeId, interval },
          shifts,
          { excludeShiftId: input.shift.id },
        );

        setValidationResult(result);

        if (!result.valid) return false;

        await updateShift.mutateAsync({
          id: input.shift.id,
          employee_id: input.newEmployeeId,
        });

        setValidationResult(null);
        return true;
      } catch (err) {
        setValidationResult(errorToValidationResult(err, 'Cannot reassign this shift'));
        return false;
      }
    },
    [restaurantId, shifts, updateShift],
  );

  const handleDeleteShift = useCallback(
    (shiftId: string) => {
      if (!restaurantId) return;
      deleteShiftMutation.mutate({ id: shiftId, restaurantId });
    },
    [restaurantId, deleteShiftMutation],
  );

  return {
    weekStart,
    weekEnd,
    weekDays,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    shifts,
    employees,
    isLoading,
    error,
    validateAndCreate,
    validateAndUpdateTime,
    validateAndReassign,
    deleteShift: handleDeleteShift,
    validationResult,
    clearValidation,
    totalHours,
  };
}
