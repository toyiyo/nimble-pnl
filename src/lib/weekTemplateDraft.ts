import type {
  DraftShift,
  DraftShiftInput,
  SchedulePlanTemplate,
  TemplateDraft,
  TemplateShiftSnapshot,
} from '@/types/scheduling';

/**
 * Pure helpers for the Week Templates editor draft.
 * Day offsets are Monday-first: 0 = Monday ... 6 = Sunday.
 */

export const DEFAULT_TEMPLATE_NAME = 'Untitled template';
/** Selection id for a draft that is not saved yet. */
export const NEW_DRAFT_ID = 'new';
/** Mirrors the server validator. */
export const MAX_TEMPLATE_NAME_LENGTH = 100;
export const MAX_BREAK_MINUTES = 480;
export const UNKNOWN_EMPLOYEE_NAME = 'Unknown employee';
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const MINUTES_PER_DAY = 24 * 60;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `ds-${keySeq}`;
}

/** 'HH:MM' -> 'HH:MM:SS'. 'HH:MM:SS' stays as it is. */
export function normalizeTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Absolute minutes from Monday 00:00. An end at or before the start moves to the next day. */
function absoluteSpan(day: number, start: string, end: string): [number, number] {
  const s = day * MINUTES_PER_DAY + toMinutes(start);
  let e = day * MINUTES_PER_DAY + toMinutes(end);
  if (e <= s) e += MINUTES_PER_DAY;
  return [s, e];
}

/** '09:00:00' -> '9a', '13:30:00' -> '1:30p' */
export function formatShortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}

export function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}h`;
}

export function emptyDraft(name: string = DEFAULT_TEMPLATE_NAME): TemplateDraft {
  return { id: null, name, updatedAt: null, rowEmployeeIds: [], shifts: [] };
}

/**
 * True for a day offset the editor can show (0-6). Templates saved before the
 * server validator existed can hold -1 or 7 for an edge-of-week shift.
 */
export function isValidDayOffset(day: number): boolean {
  return Number.isInteger(day) && day >= 0 && day <= 6;
}

function normalizeEmployeeName(name: unknown): string {
  return typeof name === 'string' && name.trim() !== '' ? name : UNKNOWN_EMPLOYEE_NAME;
}

export function draftFromTemplate(template: SchedulePlanTemplate): TemplateDraft {
  // Rows saved before the server validator can hold a null, non-string or blank
  // name. The validator rejects those names, so replace them here, or Save fails.
  const shifts = template.shifts
    .filter((s) => isValidDayOffset(s.day_offset))
    .map((s) => ({ ...s, employee_name: normalizeEmployeeName(s.employee_name) }));
  const names = new Map<string, string>();
  for (const s of shifts) {
    if (!names.has(s.employee_id)) names.set(s.employee_id, s.employee_name);
  }
  const rowEmployeeIds = [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id);

  return {
    id: template.id,
    name: template.name,
    updatedAt: template.updated_at,
    rowEmployeeIds,
    shifts: shifts.map((s) => ({
      ...s,
      start_time: normalizeTime(s.start_time),
      end_time: normalizeTime(s.end_time),
      notes: s.notes ?? null,
      key: nextKey(),
    })),
  };
}

export function addEmployeeRow(draft: TemplateDraft, employeeId: string): TemplateDraft {
  if (draft.rowEmployeeIds.includes(employeeId)) return draft;
  return { ...draft, rowEmployeeIds: [...draft.rowEmployeeIds, employeeId] };
}

export function removeEmployeeRow(draft: TemplateDraft, employeeId: string): TemplateDraft {
  return {
    ...draft,
    rowEmployeeIds: draft.rowEmployeeIds.filter((id) => id !== employeeId),
    shifts: draft.shifts.filter((s) => s.employee_id !== employeeId),
  };
}

function normalizeInput(input: DraftShiftInput): DraftShiftInput {
  return {
    start_time: normalizeTime(input.start_time),
    end_time: normalizeTime(input.end_time),
    break_duration: input.break_duration,
    position: input.position.trim(),
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
}

export function addShifts(
  draft: TemplateDraft,
  employeeId: string,
  employeeName: string,
  input: DraftShiftInput,
  days: number[],
): TemplateDraft {
  const fields = normalizeInput(input);
  const added: DraftShift[] = [...days]
    .sort((a, b) => a - b)
    .map((day) => ({
      ...fields,
      day_offset: day,
      employee_id: employeeId,
      employee_name: employeeName,
      key: nextKey(),
    }));
  const withRow = addEmployeeRow(draft, employeeId);
  return { ...withRow, shifts: [...withRow.shifts, ...added] };
}

export function updateShift(draft: TemplateDraft, key: string, input: DraftShiftInput): TemplateDraft {
  const fields = normalizeInput(input);
  return {
    ...draft,
    shifts: draft.shifts.map((s) => (s.key === key ? { ...s, ...fields } : s)),
  };
}

export function removeShift(draft: TemplateDraft, key: string): TemplateDraft {
  return { ...draft, shifts: draft.shifts.filter((s) => s.key !== key) };
}

/**
 * The first shift of the same employee that overlaps the given span, or null.
 * Uses absolute minutes from Monday 00:00, so an overnight shift overlaps the
 * next morning. A Sunday overnight shift does not wrap to Monday.
 */
export function findOverlap(
  draft: TemplateDraft,
  employeeId: string,
  day: number,
  start: string,
  end: string,
  ignoreKey?: string,
): DraftShift | null {
  const [s, e] = absoluteSpan(day, start, end);
  return (
    draft.shifts.find((x) => {
      if (x.employee_id !== employeeId || x.key === ignoreKey) return false;
      const [xs, xe] = absoluteSpan(x.day_offset, x.start_time, x.end_time);
      return s < xe && xs < e;
    }) ?? null
  );
}

export function shiftHours(
  shift: Pick<TemplateShiftSnapshot, 'start_time' | 'end_time' | 'break_duration'>,
): number {
  const [s, e] = absoluteSpan(0, shift.start_time, shift.end_time);
  return Math.max(0, e - s - shift.break_duration) / 60;
}

export interface DayTotal {
  count: number;
  hours: number;
}

export function dayTotals(draft: Pick<TemplateDraft, 'shifts'>): DayTotal[] {
  const totals: DayTotal[] = Array.from({ length: 7 }, () => ({ count: 0, hours: 0 }));
  for (const s of draft.shifts) {
    totals[s.day_offset].count += 1;
    totals[s.day_offset].hours += shiftHours(s);
  }
  return totals;
}

export function totalShiftHours(shifts: Pick<TemplateShiftSnapshot, 'start_time' | 'end_time' | 'break_duration'>[]): number {
  return shifts.reduce((sum, s) => sum + shiftHours(s), 0);
}

export function employeeHours(draft: Pick<TemplateDraft, 'shifts'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of draft.shifts) {
    out.set(s.employee_id, (out.get(s.employee_id) ?? 0) + shiftHours(s));
  }
  return out;
}

function emptyWeekCells(): DraftShift[][] {
  return Array.from({ length: 7 }, () => []);
}

/** Map<employeeId, 7 cells>. Each cell holds that day's shifts sorted by start. */
export function buildGrid(draft: Pick<TemplateDraft, 'shifts' | 'rowEmployeeIds'>): Map<string, DraftShift[][]> {
  const grid = new Map<string, DraftShift[][]>();
  for (const id of draft.rowEmployeeIds) {
    grid.set(id, emptyWeekCells());
  }
  for (const s of draft.shifts) {
    let cells = grid.get(s.employee_id);
    if (!cells) {
      cells = emptyWeekCells();
      grid.set(s.employee_id, cells);
    }
    cells[s.day_offset].push(s);
  }
  for (const cells of grid.values()) {
    for (const cell of cells) cell.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  }
  return grid;
}

function compareSnapshots(a: TemplateShiftSnapshot, b: TemplateShiftSnapshot): number {
  return (
    a.day_offset - b.day_offset ||
    a.start_time.localeCompare(b.start_time) ||
    a.employee_id.localeCompare(b.employee_id)
  );
}

/** The RPC payload. Uses the current employee name when the employee is known. */
export function toSnapshot(draft: TemplateDraft, nameById: Map<string, string>): TemplateShiftSnapshot[] {
  return draft.shifts
    .map(({ key: _key, ...s }) => ({ ...s, employee_name: nameById.get(s.employee_id) ?? s.employee_name }))
    .sort(compareSnapshots);
}

function canonical(shifts: TemplateShiftSnapshot[]): string {
  return JSON.stringify(
    shifts
      .filter((s) => isValidDayOffset(s.day_offset))
      .map((s) => ({
        d: s.day_offset,
        s: normalizeTime(s.start_time),
        e: normalizeTime(s.end_time),
        b: s.break_duration,
        p: s.position,
        id: s.employee_id,
        n: s.notes ?? null,
      }))
      .sort((a, b) => a.d - b.d || a.s.localeCompare(b.s) || a.id.localeCompare(b.id) || a.e.localeCompare(b.e)),
  );
}

/**
 * True when the draft differs from the saved template. Empty rows and the
 * time format do not count. A new draft (no saved template) counts as dirty
 * only when it has shifts.
 */
export function isDraftDirty(draft: TemplateDraft, saved: SchedulePlanTemplate | null): boolean {
  if (!saved) return draft.shifts.length > 0;
  if (draft.name.trim() !== saved.name.trim()) return true;
  return canonical(draft.shifts) !== canonical(saved.shifts);
}
