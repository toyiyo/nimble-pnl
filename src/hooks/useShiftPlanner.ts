/**
 * useShiftPlanner — orchestrates week navigation, grid data computation,
 * and validated mutations for the shift planner view.
 *
 * Pure utility functions (getWeekDays, buildGridData) are exported separately
 * for testability without React.
 */
import { useState, useMemo, useCallback } from 'react';

import { useShifts } from '@/hooks/useShifts';
import { useEmployees } from '@/hooks/useEmployees';
import { useValidatedShiftMutations } from '@/hooks/useValidatedShiftMutations';

import { ShiftInterval, formatLocalDate } from '@/lib/shiftInterval';
import { ValidationResult } from '@/lib/shiftValidator';

import { templateAppliesToDay } from '@/hooks/useShiftTemplates';
import { UNASSIGNED } from '@/lib/templateAreaGrouping';
import { findAreaAwareTemplate } from '@/lib/templateAreaMatch';

import type { Shift, ShiftTemplate, ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';

// ---------------------------------------------------------------------------
// Pure utility functions (tested without React)
// ---------------------------------------------------------------------------

/**
 * Returns the subset of weekDays where the template is active.
 */
export function getActiveDaysForWeek(
  template: Pick<ShiftTemplate, 'days'>,
  weekDays: string[],
): string[] {
  return weekDays.filter((day) => templateAppliesToDay(template, day));
}

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
    const dayStr = formatLocalDate(new Date(shift.start_time));
    if (!weekDaySet.has(dayStr)) continue;

    const empId = shift.employee_id || '__open__';
    if (!grid.has(empId)) grid.set(empId, new Map());
    pushToGridBucket(grid.get(empId)!, dayStr, shift);
  }

  return grid;
}

/**
 * Find the template that matches a shift's time, position, and active day, and
 * is area-compatible with the employee. Thin wrapper over the shared
 * `findAreaAwareTemplate` so the grid and the export (plannerExport) select
 * templates identically.
 */
function findMatchingTemplate(
  templates: ShiftTemplate[],
  shiftStart: string,
  shiftEnd: string,
  position: string,
  dayOfWeek: number,
  employeeArea: string | null,
): ShiftTemplate | undefined {
  return findAreaAwareTemplate(templates, { shiftStart, shiftEnd, position, dayOfWeek, employeeArea });
}

/**
 * Groups shifts into a Map<templateId, Map<dayString, Shift[]>>.
 * Matches shifts to templates by comparing start_time (HH:MM:SS),
 * end_time (HH:MM:SS), position, active day, and area compatibility
 * (employee home area vs template area; null on either side is permissive).
 * Unmatched shifts go under '__unmatched__'. Cancelled shifts are excluded.
 */
export function buildTemplateGridData(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): Map<string, Map<string, Shift[]>> {
  const weekDaySet = new Set(weekDays);
  const grid = new Map<string, Map<string, Shift[]>>();
  const templateIds = new Set(templates.map((t) => t.id));

  for (const t of templates) {
    grid.set(t.id, new Map());
  }
  grid.set('__unmatched__', new Map());

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const shiftStartAt = new Date(shift.start_time);
    const dayStr = formatLocalDate(shiftStartAt);
    if (!weekDaySet.has(dayStr)) continue;

    // Prefer explicit template ID (set during planner assignment)
    if (shift.shift_template_id) {
      // If template is active, bucket under it; if archived, mark unmatched
      // (don't fall through to time-based matching which could pick the wrong template)
      const bucketKey = templateIds.has(shift.shift_template_id)
        ? shift.shift_template_id
        : '__unmatched__';
      pushToGridBucket(grid.get(bucketKey)!, dayStr, shift);
      continue;
    }

    // Fallback: match by time/position/day for legacy shifts (no
    // shift_template_id). Still needed for manually-created shifts and any
    // rows inserted by older bundles before AI generation persisted the FK.
    const shiftStart = formatLocalTime(shift.start_time);
    const shiftEnd = formatLocalTime(shift.end_time);
    const dayOfWeek = shiftStartAt.getDay();
    const match = findMatchingTemplate(
      templates,
      shiftStart,
      shiftEnd,
      shift.position,
      dayOfWeek,
      shift.employee?.area ?? null,
    );

    const bucketKey = match ? match.id : '__unmatched__';
    pushToGridBucket(grid.get(bucketKey)!, dayStr, shift);
  }

  return grid;
}

/**
 * Group the '__unmatched__' bucket (Map<day, Shift[]>) by employee work area.
 * Shifts with no employee area fall under UNASSIGNED. Returns
 * Map<area, Map<day, Shift[]>>. Pure; drives the off-template lane rows.
 */
export function groupUnmatchedByArea(
  unmatchedByDay: Map<string, Shift[]>,
): Map<string, Map<string, Shift[]>> {
  const out = new Map<string, Map<string, Shift[]>>();
  for (const [day, shifts] of unmatchedByDay) {
    for (const shift of shifts) {
      const area = shift.employee?.area ?? UNASSIGNED;
      let byDay = out.get(area);
      if (!byDay) { byDay = new Map(); out.set(area, byDay); }
      const list = byDay.get(day);
      if (list) list.push(shift);
      else byDay.set(day, [shift]);
    }
  }
  return out;
}

export interface PartitionedTemplatesForDisplay {
  activeTemplates: ShiftTemplate[];
  hiddenTemplates: ShiftTemplate[];
  displayTemplates: ShiftTemplate[];
}

/**
 * Partitions templates into active/hidden buckets for the planner grid.
 *
 * `displayTemplates` is a stable active-first ordering (relative order within
 * each partition is preserved — no re-sorting beyond the active/hidden split)
 * so ghost (hidden) rows sink to the bottom of each area group. When
 * `showHidden` is false, `displayTemplates` is exactly `activeTemplates` (no
 * hidden rows rendered at all).
 */
export function partitionTemplatesForDisplay(
  templates: ShiftTemplate[],
  showHidden: boolean,
): PartitionedTemplatesForDisplay {
  const activeTemplates: ShiftTemplate[] = [];
  const hiddenTemplates: ShiftTemplate[] = [];

  for (const t of templates) {
    if (t.is_active) {
      activeTemplates.push(t);
    } else {
      hiddenTemplates.push(t);
    }
  }

  const displayTemplates = showHidden
    ? [...activeTemplates, ...hiddenTemplates]
    : activeTemplates;

  return { activeTemplates, hiddenTemplates, displayTemplates };
}

/**
 * Merges the per-template grid buckets (from buildTemplateGridData) of the
 * given hidden templates into a single Map<day, Shift[]> for the "From
 * hidden templates" lane. Honors areaFilter using the same `t.area ||
 * UNASSIGNED` nullish convention as groupTemplatesByArea. Day arrays are
 * merged in template order. Returns an empty Map when nothing matches.
 */
export function collectHiddenLane(
  grid: Map<string, Map<string, Shift[]>>,
  hiddenTemplates: ShiftTemplate[],
  areaFilter: string | null | undefined,
): Map<string, Shift[]> {
  const lane = new Map<string, Shift[]>();

  for (const t of hiddenTemplates) {
    if (areaFilter) {
      const area = t.area || UNASSIGNED;
      if (area !== areaFilter) continue;
    }

    const byDay = grid.get(t.id);
    if (!byDay) continue;

    for (const [day, shifts] of byDay) {
      if (shifts.length === 0) continue;
      const existing = lane.get(day);
      if (existing) {
        existing.push(...shifts);
      } else {
        lane.set(day, [...shifts]);
      }
    }
  }

  return lane;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Metadata subset shared by every shift-insert payload builder — the fields that
 * don't come from the time interval. Lets the host-local (`buildShiftPayload`) and
 * ISO-instant (timeline) create paths share one payload shape without duplication.
 */
export interface ShiftInsertMeta {
  employeeId: string;
  position: string;
  breakDuration?: number;
  notes?: string;
  shiftTemplateId?: string | null;
}

/** Build the shift-insert payload from an interval + non-time metadata. */
export function buildShiftInsert(
  restaurantId: string,
  meta: ShiftInsertMeta,
  interval: ShiftInterval,
) {
  return {
    restaurant_id: restaurantId,
    employee_id: meta.employeeId,
    start_time: interval.startAt.toISOString(),
    end_time: interval.endAt.toISOString(),
    position: meta.position,
    break_duration: meta.breakDuration ?? 0,
    notes: meta.notes,
    status: 'scheduled' as const,
    is_published: false,
    locked: false,
    source: (meta.shiftTemplateId ? 'template' : 'manual') as 'template' | 'manual',
    shift_template_id: meta.shiftTemplateId ?? null,
  };
}

/** Build the mutation payload for creating a shift from validated inputs. */
export function buildShiftPayload(
  restaurantId: string,
  input: ShiftCreateInput,
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

/**
 * Compute scheduled hours per employee (excluding cancelled shifts and breaks).
 * Returns a Map<employeeId, roundedHours>.
 */
export function computeHoursPerEmployee(shifts: Shift[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const shift of shifts) {
    if (shift.status === 'cancelled' || !shift.employee_id) continue;
    const startMs = new Date(shift.start_time).getTime();
    const endMs = new Date(shift.end_time).getTime();
    const durationMinutes = (endMs - startMs) / 60_000;
    const netMinutes = durationMinutes - (shift.break_duration || 0);
    if (netMinutes > 0) {
      map.set(shift.employee_id, (map.get(shift.employee_id) ?? 0) + netMinutes / 60);
    }
  }
  // Round all values
  for (const [id, hours] of map) {
    map.set(id, Math.round(hours));
  }
  return map;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface ShiftCreateInput {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  position: string;
  breakDuration?: number;
  notes?: string;
  shiftTemplateId?: string;
}

export interface UseShiftPlannerReturn {
  // Week navigation
  weekStart: Date;
  weekEnd: Date;
  weekDays: string[];
  goToNextWeek: () => void;
  goToPrevWeek: () => void;
  goToToday: () => void;
  goToWeek: (monday: Date) => void;

  // Data
  shifts: Shift[];
  employees: ReturnType<typeof useEmployees>['employees'];
  isLoading: boolean;
  error: Error | null;

  // Mutations
  validateAndCreate: (input: ShiftCreateInput) => Promise<{
    created: boolean;
    pendingConflicts?: ConflictCheck[];
    pendingWarnings?: ValidationIssue[];
    pendingInput?: ShiftCreateInput;
  }>;
  forceCreate: (input: ShiftCreateInput) => Promise<boolean>;
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

export interface UseShiftPlannerOptions {
  /**
   * When provided, the hook defers all week state to this external source
   * (e.g. useSharedWeek) instead of owning it internally. When omitted,
   * the hook manages its own weekStart via useState.
   */
  externalWeekStart?: Date;
  onExternalWeekStartChange?: (next: Date) => void;
}

export function useShiftPlanner(
  restaurantId: string | null,
  options: UseShiftPlannerOptions = {},
): UseShiftPlannerReturn {
  const { externalWeekStart, onExternalWeekStartChange } = options;

  if (
    process.env.NODE_ENV !== 'production' &&
    externalWeekStart !== undefined &&
    !onExternalWeekStartChange
  ) {
    console.warn(
      'useShiftPlanner: externalWeekStart was provided without onExternalWeekStartChange. Navigation will be silently ignored — pass both or neither.',
    );
  }

  const [internalWeekStart, setInternalWeekStart] = useState<Date>(() =>
    getMondayOfWeek(new Date()),
  );

  const weekStart = externalWeekStart ?? internalWeekStart;
  const setWeekStart = useCallback(
    (updater: Date | ((prev: Date) => Date)) => {
      if (externalWeekStart !== undefined && onExternalWeekStartChange) {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: Date) => Date)(externalWeekStart)
            : updater;
        onExternalWeekStartChange(getMondayOfWeek(next));
      } else {
        setInternalWeekStart((prev) =>
          typeof updater === 'function'
            ? (updater as (prev: Date) => Date)(prev)
            : updater,
        );
      }
    },
    [externalWeekStart, onExternalWeekStartChange],
  );

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Data hooks
  const { shifts, loading: shiftsLoading, error: shiftsError } = useShifts(
    restaurantId,
    weekStart,
    weekEnd,
  );
  const { employees, loading: employeesLoading, error: employeesError } = useEmployees(restaurantId, {
    status: 'active',
  });

  // Validated mutation pipeline (shared with the Timeline edit/create surface).
  const pipeline = useValidatedShiftMutations(restaurantId, shifts);

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
  }, [setWeekStart]);

  const goToPrevWeek = useCallback(() => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  }, [setWeekStart]);

  const goToToday = useCallback(() => {
    setWeekStart(getMondayOfWeek(new Date()));
  }, [setWeekStart]);

  const goToWeek = useCallback((monday: Date) => {
    setWeekStart(getMondayOfWeek(monday));
  }, [setWeekStart]);

  // Validation helper — delegates to the pipeline hook's own state.
  const clearValidation = pipeline.clearValidation;

  // Validated mutations — delegate to the shared pipeline (byte-compatible
  // public API; see useValidatedShiftMutations for the actual logic).
  const validateAndCreate = pipeline.validateAndCreate;
  const forceCreate = pipeline.forceCreate;

  const validateAndUpdateTime = useCallback(
    async (input: {
      shift: Shift;
      newStartTime: string;
      newEndTime: string;
    }): Promise<boolean> => {
      const [date, startTimePart] = input.newStartTime.split('T');
      const [, endTimePart] = input.newEndTime.split('T');

      if (!startTimePart || !endTimePart) {
        return false;
      }

      const startHHMM = startTimePart.substring(0, 5);
      const endHHMM = endTimePart.substring(0, 5);

      try {
        // Reconstruct the host-local interval the same way the planner always
        // has, then hand its ISO instants to the pipeline (fromTimestamps),
        // preserving this hook's existing host-local create semantics.
        const interval = ShiftInterval.create(date, startHHMM, endHHMM);

        const { updated } = await pipeline.validateAndUpdateTime({
          shift: input.shift,
          startIso: interval.startAt.toISOString(),
          endIso: interval.endAt.toISOString(),
          businessDate: date,
        });

        return updated;
      } catch {
        // ShiftInterval.create validation failure (e.g. invalid/zero duration).
        // Matches this hook's pre-refactor contract: never throws, returns false.
        return false;
      }
    },
    [pipeline],
  );

  const validateAndReassign = useCallback(
    async (input: {
      shift: Shift;
      newEmployeeId: string;
    }): Promise<boolean> => {
      const { reassigned } = await pipeline.validateAndReassign(input);
      return reassigned;
    },
    [pipeline],
  );

  const handleDeleteShift = pipeline.deleteShift;

  return {
    weekStart,
    weekEnd,
    weekDays,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    goToWeek,
    shifts,
    employees,
    isLoading,
    error,
    validateAndCreate,
    forceCreate,
    validateAndUpdateTime,
    validateAndReassign,
    deleteShift: handleDeleteShift,
    validationResult: pipeline.validationResult,
    clearValidation,
    totalHours,
  };
}
