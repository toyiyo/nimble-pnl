// Merge the grid conflicts (SQL RPC) and the editor warnings into one
// conflict list for each shift. Pure, so Vitest can import this file.
import { MIN_REST_HOURS } from './shiftWarnings.ts';
import type { ShiftWarning, WarnShift } from './shiftWarnings.ts';

export interface ConflictRow {
  shift_id: string;
  conflict_type: 'time_off' | 'availability';
  source: string | null;
  status: string | null;
  message: string;
}

export interface ShiftConflict {
  type: 'time_off' | 'availability' | 'overlap' | 'clopen';
  rule: 'grid' | 'editor';
  source?: string;
  status?: string;
  message: string;
}

function warningMessage(w: ShiftWarning): string {
  if (w.type === 'overlap') return 'Overlaps another shift for the same employee';
  return `Only ${w.rest_hours ?? 0} h of rest after the previous shift`;
}

export function buildConflictIndex(
  rows: ConflictRow[],
  warnings: ShiftWarning[],
): Map<string, ShiftConflict[]> {
  const index = new Map<string, ShiftConflict[]>();
  const push = (id: string, c: ShiftConflict) => {
    const list = index.get(id);
    if (list) list.push(c);
    else index.set(id, [c]);
  };
  for (const r of rows) {
    const c: ShiftConflict = { type: r.conflict_type, rule: 'grid', message: r.message };
    if (r.source) c.source = r.source;
    if (r.status) c.status = r.status;
    push(r.shift_id, c);
  }
  for (const w of warnings) {
    push(w.shift_id, { type: w.type, rule: 'editor', message: warningMessage(w) });
  }
  return index;
}

export function attachConflicts<T extends { id: string }>(
  shifts: T[],
  index: Map<string, ShiftConflict[]>,
): { shifts: (T & { conflicts?: ShiftConflict[] })[]; conflictedShiftCount: number } {
  let conflictedShiftCount = 0;
  const out = shifts.map((s) => {
    const conflicts = index.get(s.id);
    if (!conflicts || conflicts.length === 0) return s as T & { conflicts?: ShiftConflict[] };
    conflictedShiftCount++;
    return { ...s, conflicts };
  });
  return { shifts: out, conflictedShiftCount };
}

export async function loadShiftConflicts(
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  restaurantId: string,
  startIso: string,
  endIso: string,
): Promise<ConflictRow[]> {
  const { data, error } = await supabase.rpc('get_shift_conflicts', {
    p_restaurant_id: restaurantId,
    p_start: startIso,
    p_end: endIso,
  });
  if (error) throw new Error(`Failed to fetch shift conflicts: ${error.message}`);
  return (data ?? []) as ConflictRow[];
}

const MS_PER_HOUR = 3_600_000;
const NEIGHBOR_LIMIT = 1000;

/**
 * Shifts just outside the period that can flag a shift inside it. A shift that ends
 * less than MIN_REST_HOURS before the start can cause a clopen or an overlap. A shift
 * that starts in the 24 h after the end can overlap an overnight shift. Give these to
 * findShiftWarnings with the period shifts, and attach conflicts to the period shifts only.
 */
export async function loadNeighborShifts(
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  restaurantId: string,
  startIso: string,
  endIso: string,
): Promise<WarnShift[]> {
  const columns = 'id, employee_id, start_time, end_time, status';
  const base = () =>
    supabase.from('shifts').select(columns).eq('restaurant_id', restaurantId).neq('status', 'cancelled');
  const restStart = new Date(Date.parse(startIso) - MIN_REST_HOURS * MS_PER_HOUR).toISOString();
  const dayAfterEnd = new Date(Date.parse(endIso) + 24 * MS_PER_HOUR).toISOString();
  const [before, after] = await Promise.all([
    base().lt('start_time', startIso).gt('end_time', restStart).limit(NEIGHBOR_LIMIT),
    base().gt('start_time', endIso).lte('start_time', dayAfterEnd).limit(NEIGHBOR_LIMIT),
  ]);
  if (before.error) throw new Error(`Failed to fetch neighbor shifts: ${before.error.message}`);
  if (after.error) throw new Error(`Failed to fetch neighbor shifts: ${after.error.message}`);
  return [...(before.data ?? []), ...(after.data ?? [])] as WarnShift[];
}

/** The period shifts plus the neighbors that are not already in the period. */
export function withNeighbors<T extends WarnShift>(shifts: T[], neighbors: WarnShift[]): WarnShift[] {
  const ids = new Set(shifts.map((s) => s.id));
  return [...shifts, ...neighbors.filter((n) => !ids.has(n.id))];
}

/**
 * Keep an overview below the text limit after the conflicts are attached. The
 * messages are the long part, so delete them first. The type, rule, source and
 * status of each conflict stay.
 */
export function compactConflictsToFit<T extends { shifts_by_date: Record<string, unknown[]> }>(
  data: T,
  limit: number,
): T & { conflict_messages_omitted?: true } {
  if (JSON.stringify(data).length < limit) return data;
  const shiftsByDate: Record<string, unknown[]> = {};
  for (const [day, list] of Object.entries(data.shifts_by_date)) {
    shiftsByDate[day] = list.map((s) => {
      const shift = s as { conflicts?: ShiftConflict[] };
      if (!shift.conflicts) return s;
      return { ...shift, conflicts: shift.conflicts.map(({ message: _message, ...rest }) => rest) };
    });
  }
  return { ...data, shifts_by_date: shiftsByDate, conflict_messages_omitted: true };
}
