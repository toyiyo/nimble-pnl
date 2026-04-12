import type { ShiftTemplate, EmployeeAvailability } from '@/types/scheduling';

export interface Employee {
  id: string;
  name: string;
  position: string;
}

export interface ScheduleWarning {
  type: 'no_availability' | 'limited_availability' | 'position_mismatch' | 'no_time_overlap';
  employeeId: string;
  employeeName: string;
  detail: string;
}

const MINUTES_PER_DAY = 24 * 60;
const MIN_DAYS_THRESHOLD = 3;

/** Convert "HH:MM:SS" to total minutes from midnight. */
function toMinutes(time: string): number {
  const parts = time.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * Check if two time ranges overlap, handling overnight shifts
 * (where end <= start means the range crosses midnight).
 */
function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const aS = toMinutes(aStart);
  let aE = toMinutes(aEnd);
  const bS = toMinutes(bStart);
  let bE = toMinutes(bEnd);

  // Handle overnight: if end <= start, add 24h to end
  if (aE <= aS) aE += MINUTES_PER_DAY;
  if (bE <= bS) bE += MINUTES_PER_DAY;

  return aS < bE && bS < aE;
}

export function computeScheduleWarnings(
  employees: Employee[],
  templates: ShiftTemplate[],
  availability: EmployeeAvailability[],
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const activeTemplates = templates.filter((t) => t.is_active);

  for (const emp of employees) {
    const empAvail = availability.filter(
      (a) => a.employee_id === emp.id && a.is_available,
    );

    // 1. no_availability — skip all other checks if triggered
    if (empAvail.length === 0) {
      warnings.push({
        type: 'no_availability',
        employeeId: emp.id,
        employeeName: emp.name,
        detail: 'No availability set \u2014 AI will assume available all week',
      });
      continue;
    }

    // 2. limited_availability
    const availableDays = new Set(empAvail.map((a) => a.day_of_week));
    if (availableDays.size < MIN_DAYS_THRESHOLD) {
      warnings.push({
        type: 'limited_availability',
        employeeId: emp.id,
        employeeName: emp.name,
        detail: `Only available ${availableDays.size} day(s) this week`,
      });
    }

    // 3. position_mismatch — skip time overlap if triggered
    const matchingTemplates = activeTemplates.filter(
      (t) => t.position === emp.position,
    );
    if (matchingTemplates.length === 0) {
      warnings.push({
        type: 'position_mismatch',
        employeeId: emp.id,
        employeeName: emp.name,
        detail: `No ${emp.position} shift templates exist`,
      });
      continue;
    }

    // 4. no_time_overlap — check if any availability slot overlaps any matching template on a shared day
    let hasOverlap = false;
    for (const avail of empAvail) {
      if (hasOverlap) break;
      for (const tmpl of matchingTemplates) {
        if (!tmpl.days.includes(avail.day_of_week)) continue;
        if (timeRangesOverlap(avail.start_time, avail.end_time, tmpl.start_time, tmpl.end_time)) {
          hasOverlap = true;
          break;
        }
      }
    }

    if (!hasOverlap) {
      warnings.push({
        type: 'no_time_overlap',
        employeeId: emp.id,
        employeeName: emp.name,
        detail: "Available times don't overlap with any shift templates",
      });
    }
  }

  return warnings;
}
