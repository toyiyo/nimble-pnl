import { isSameDay, parseISO } from 'date-fns';
import type { Shift, Employee } from '@/types/scheduling';
import { type GroupByMode, UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';

/** How a day's shift rows are ordered within each area/position section. */
export type RosterSortBy = 'startTime' | 'name' | 'hours';

/** One printable line in the roster: a single shift + its employee. */
export interface RosterRow {
  shift: Shift;
  employee: Employee;
  hours: number; // net scheduled hours (break excluded)
}

/** A grouped block of rows under one area/position label ('' when ungrouped). */
export interface RosterSection {
  label: string;
  rows: RosterRow[];
}

/** All shifts for a single calendar day, grouped + sorted for printing. */
export interface RosterDay {
  day: Date;
  sections: RosterSection[];
  totalStaff: number; // distinct employees that day
  totalHours: number; // sum of net hours
}

/**
 * Net scheduled hours for a shift (break excluded), clamped to >= 0.
 * Canonical home for this helper; re-exported from utils/scheduleExport for
 * backward compatibility.
 */
export const calculateShiftHours = (shift: Shift): number => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
  return netMinutes / 60;
};

const startMs = (row: RosterRow): number => parseISO(row.shift.start_time).getTime();

/** Comparator for ordering rows within a section, with deterministic tie-breaks. */
function rowComparator(sortBy: RosterSortBy): (a: RosterRow, b: RosterRow) => number {
  if (sortBy === 'name') {
    return (a, b) => a.employee.name.localeCompare(b.employee.name) || startMs(a) - startMs(b);
  }
  if (sortBy === 'hours') {
    return (a, b) => b.hours - a.hours || a.employee.name.localeCompare(b.employee.name);
  }
  // 'startTime' (default): earliest first -> morning before afternoon
  return (a, b) => startMs(a) - startMs(b) || a.employee.name.localeCompare(b.employee.name);
}

/**
 * Builds the roster for a single day: filters shifts to `day`, joins each to its
 * employee, groups by `groupBy` (area/position/none), and sorts each section by
 * `sortBy`. Shifts whose employee is missing are skipped. Split shifts (same
 * employee, two shifts that day) produce two rows but count once in totalStaff.
 *
 * Callers should pre-filter `shifts` by area/position/selected-employees; this
 * function does not re-apply those filters.
 */
export function buildRosterDay(
  shifts: Shift[],
  employees: Employee[],
  day: Date,
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay {
  const empById = new Map(employees.map(e => [e.id, e]));

  const rows: RosterRow[] = [];
  for (const shift of shifts) {
    if (!isSameDay(parseISO(shift.start_time), day)) continue;
    const employee = empById.get(shift.employee_id);
    if (!employee) continue;
    rows.push({ shift, employee, hours: calculateShiftHours(shift) });
  }

  const totalStaff = new Set(rows.map(r => r.employee.id)).size;
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
  const sortRows = (rs: RosterRow[]) => [...rs].sort(rowComparator(sortBy));

  if (groupBy === 'none') {
    return {
      day,
      sections: rows.length ? [{ label: '', rows: sortRows(rows) }] : [],
      totalStaff,
      totalHours,
    };
  }

  const sectionMap = new Map<string, RosterRow[]>();
  for (const row of rows) {
    const raw = (groupBy === 'area' ? row.employee.area : row.employee.position) || '';
    const key = raw.trim(); // '' === unassigned
    const arr = sectionMap.get(key);
    if (arr) arr.push(row);
    else sectionMap.set(key, [row]);
  }

  const sortedKeys = Array.from(sectionMap.keys()).sort((a, b) => {
    if (a === '') return 1; // unassigned last
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  return {
    day,
    sections: sortedKeys.map(key => ({
      label: key || UNASSIGNED_LABEL,
      rows: sortRows(sectionMap.get(key) ?? []),
    })),
    totalStaff,
    totalHours,
  };
}

/** Builds rosters for multiple days (e.g., a full week), preserving day order. */
export function buildRoster(
  shifts: Shift[],
  employees: Employee[],
  days: Date[],
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay[] {
  return days.map(day => buildRosterDay(shifts, employees, day, sortBy, groupBy));
}
