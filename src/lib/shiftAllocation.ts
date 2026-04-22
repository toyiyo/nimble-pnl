import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

export type AllocationStatus = 'none' | 'highlight' | 'conflict' | 'available';

/**
 * Classifies how an employee's existing shifts relate to a template slot
 * on a given day. Used by the planner allocation overlay.
 *
 * - "none": template is not active on the day (no annotation)
 * - "highlight": employee is already scheduled covering this slot
 * - "conflict": employee has a shift that partially overlaps this slot
 * - "available": template is active, employee has no overlapping shift
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

    const shiftStart = new Date(shift.start_time).getTime();
    const shiftEnd = new Date(shift.end_time).getTime();

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
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}` === day;
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
    const iso = shift.start_time.slice(0, 10);
    let bucket = shiftsByDay.get(iso);
    if (!bucket) {
      bucket = [];
      shiftsByDay.set(iso, bucket);
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
