// Merge the grid conflicts (SQL RPC) and the editor warnings into one
// conflict list for each shift. Pure, so Vitest can import this file.
import type { ShiftWarning } from './shiftWarnings.ts';

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
