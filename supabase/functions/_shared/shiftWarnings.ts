// Shared shift warning rules. Used by the editor validator and the connector.
export const MIN_REST_HOURS = 8;

export interface WarnShift {
  id: string;
  employee_id: string | null;
  start_time: string;
  end_time: string;
  status: string;
}

export interface ShiftWarning {
  shift_id: string;
  type: 'overlap' | 'clopen';
  rule: 'editor';
  other_shift_id: string;
  rest_hours?: number;
}

export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export function restHoursBetween(endMs: number, nextStartMs: number): number {
  const gap = nextStartMs - endMs;
  return gap <= 0 ? 0 : gap / 3_600_000;
}

export function findShiftWarnings(shifts: WarnShift[]): ShiftWarning[] {
  const byEmployee = new Map<string, WarnShift[]>();
  for (const s of shifts) {
    if (!s.employee_id || s.status === 'cancelled') continue;
    const list = byEmployee.get(s.employee_id) ?? [];
    list.push(s);
    byEmployee.set(s.employee_id, list);
  }

  const warnings: ShiftWarning[] = [];
  for (const list of byEmployee.values()) {
    list.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const earlier = list[i];
        const later = list[j];
        const eStart = Date.parse(earlier.start_time);
        const eEnd = Date.parse(earlier.end_time);
        const lStart = Date.parse(later.start_time);
        const lEnd = Date.parse(later.end_time);
        // The list is sorted by start. A later shift this far out cannot overlap or clopen.
        if (lStart - eEnd >= MIN_REST_HOURS * 3_600_000 && lStart >= eStart) break;
        if (intervalsOverlap(eStart, eEnd, lStart, lEnd)) {
          warnings.push({ shift_id: earlier.id, type: 'overlap', rule: 'editor', other_shift_id: later.id });
          warnings.push({ shift_id: later.id, type: 'overlap', rule: 'editor', other_shift_id: earlier.id });
          continue;
        }
        const rest = restHoursBetween(eEnd, lStart);
        if (rest > 0 && rest < MIN_REST_HOURS) {
          warnings.push({
            shift_id: later.id,
            type: 'clopen',
            rule: 'editor',
            other_shift_id: earlier.id,
            rest_hours: Math.round(rest * 10) / 10,
          });
        }
      }
    }
  }
  return warnings;
}
