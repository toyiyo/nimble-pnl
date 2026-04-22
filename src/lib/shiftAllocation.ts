import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

export type AllocationStatus = 'none' | 'highlight' | 'conflict' | 'available';

/**
 * Returns a `YYYY-MM-DD` string using the **wall-clock** date components of
 * the given ISO timestamp, ignoring any timezone suffix. Stripping the suffix
 * before parsing means the browser treats the digits as local time, so both
 * `'2026-04-20T09:00:00'` and `'2026-04-20T09:00:00Z'` resolve to the same
 * calendar date. This is the single authoritative date-key extractor used in
 * `sameDay` and in the `computeAllocationStatuses` bucketing step.
 */
export function toLocalDateKey(iso: string): string {
  // Strip any timezone designator so the datetime is parsed as local.
  const local = iso.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
  const d = new Date(local);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Returns epoch-millis treating the given ISO timestamp as a **local**
 * wall-clock time, regardless of any timezone suffix (e.g. `Z` or `+HH:MM`).
 * The numeric date and time components in the string are used directly as
 * local-time values so they compare correctly against `toDateTime()` output.
 *
 * Example: `'2026-04-20T09:00:00Z'` → same epoch as `new Date(2026,3,20,9,0,0)`
 * in the local timezone — consistent with a template `start_time` of `'09:00:00'`.
 */
export function toLocalEpoch(iso: string): number {
  // Strip any timezone designator (Z or ±HH:MM / ±HHMM) so that the
  // browser's Date constructor parses the remaining digits as local time.
  const local = iso.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
  return new Date(local).getTime();
}

/**
 * Classifies how an employee's existing shifts relate to a template slot
 * on a given day. Used by the planner allocation overlay.
 *
 * - "none": template is not active on the day (no annotation)
 * - "highlight": employee is already scheduled covering this slot
 * - "conflict": employee has a shift that partially overlaps this slot
 * - "available": template is active, employee has no overlapping shift
 *
 * Known limitation: overnight templates (end_time <= start_time) and shifts
 * that cross midnight are matched only on their start date. Full midnight-
 * crossing support is deferred to a follow-up; the same assumption is baked
 * into `buildTemplateGridData` in useShiftPlanner.ts.
 */
export function computeAllocationStatus(
  employeeShifts: readonly Shift[],
  template: ShiftTemplate,
  day: string,
): AllocationStatus {
  if (!templateAppliesToDay(template, day)) return 'none';

  const templateStart = toDateTime(day, template.start_time);
  const templateEnd = toDateTime(day, template.end_time);

  let hasOverlap = false;
  let isEncompassed = false;

  for (const shift of employeeShifts) {
    if (shift.status === 'cancelled') continue;
    if (!sameDay(shift.start_time, day)) continue;

    const shiftStart = toLocalEpoch(shift.start_time);
    const shiftEnd = toLocalEpoch(shift.end_time);

    if (shiftStart <= templateStart && shiftEnd >= templateEnd) {
      isEncompassed = true;
    } else if (shiftStart < templateEnd && shiftEnd > templateStart) {
      hasOverlap = true;
    }
  }

  if (isEncompassed) return 'highlight';
  if (hasOverlap) return 'conflict';
  return 'available';
}

function sameDay(isoString: string, day: string): boolean {
  return toLocalDateKey(isoString) === day;
}

function toDateTime(day: string, hhmmss: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mm, s] = hhmmss.split(':').map(Number);
  return new Date(y, m - 1, d, h, mm, s || 0).getTime();
}

/**
 * Batch version — for every (template × day) cell, returns the allocation
 * status keyed by `${templateId}:${day}`. O(templates × days × shifts) with
 * a per-day shift bucket for the hot path.
 */
export function computeAllocationStatuses(
  employeeShifts: readonly Shift[],
  templates: readonly ShiftTemplate[],
  weekDays: readonly string[],
): Map<string, AllocationStatus> {
  const shiftsByDay = new Map<string, Shift[]>();
  for (const shift of employeeShifts) {
    const key = toLocalDateKey(shift.start_time);
    let bucket = shiftsByDay.get(key);
    if (!bucket) {
      bucket = [];
      shiftsByDay.set(key, bucket);
    }
    bucket.push(shift);
  }

  const result = new Map<string, AllocationStatus>();
  for (const template of templates) {
    for (const day of weekDays) {
      const bucket = shiftsByDay.get(day) ?? [];
      result.set(`${template.id}:${day}`, computeAllocationStatus(bucket, template, day));
    }
  }
  return result;
}
