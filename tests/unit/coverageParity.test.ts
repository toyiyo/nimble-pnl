// The MCP coverage (buildCoverage) must count the same staff per slot as the
// planner grid (buildTemplateGridData + distinctAssignedCount). If the two
// matching rules drift apart, this test fails.
import { describe, it, expect } from 'vitest';
import { buildTemplateGridData } from '@/hooks/useShiftPlanner';
import { distinctAssignedCount } from '@/lib/shiftFill';
import type { Shift, ShiftTemplate } from '@/types/scheduling';
import { buildCoverage, type ShiftRow, type TemplateRow } from '../../supabase/functions/_shared/schedulingContext';

const CHI = 'America/Chicago';
// Monday 2026-12-07 to Sunday 2026-12-13.
const weekDays = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];

const templates = [
  { id: 'lunch', name: 'Lunch', days: [1, 2, 3, 4, 5], start_time: '11:00:00', end_time: '15:00:00', capacity: 2, position: 'Server', area: null, is_active: true },
  { id: 'dinner-bar', name: 'Dinner bar', days: [1, 2, 3, 4, 5, 6], start_time: '17:00:00', end_time: '23:00:00', capacity: 2, position: 'Server', area: 'Bar', is_active: true },
  { id: 'dinner-any', name: 'Dinner', days: [1, 2, 3, 4, 5, 6], start_time: '17:00:00', end_time: '23:00:00', capacity: 3, position: 'Server', area: null, is_active: true },
  { id: 'cook', name: 'Cook', days: [0, 6], start_time: '09:00:00', end_time: '17:00:00', capacity: 1, position: 'Cook', area: 'Kitchen', is_active: true },
];

type Emp = { id: string; area: string | null; position: string };
const emps: Emp[] = [
  { id: 'a', area: 'Bar', position: 'Server' },
  { id: 'b', area: 'Patio', position: 'Server' },
  { id: 'c', area: null, position: 'Server' },
  { id: 'd', area: 'Kitchen', position: 'Cook' },
];

// Chicago is UTC-6 in December.
const at = (day: string, hh: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(hh + 6);
  return d.toISOString();
};

let n = 0;
function mk(e: Emp, day: string, startH: number, endH: number, extra: Partial<ShiftRow> = {}): ShiftRow {
  n += 1;
  return {
    id: `s${n}`,
    employee_id: e.id,
    start_time: at(day, startH),
    end_time: at(day, endH),
    break_duration: 0,
    status: 'scheduled',
    position: e.position,
    shift_template_id: null,
    employee: { area: e.area, position: e.position },
    ...extra,
  };
}

const [a, b, c, d] = emps;
const rows: ShiftRow[] = [
  // Legacy shifts that match on time.
  mk(a, '2026-12-07', 11, 15), mk(b, '2026-12-07', 11, 15), mk(c, '2026-12-07', 11, 15),
  mk(a, '2026-12-07', 17, 23), mk(b, '2026-12-07', 17, 23), mk(c, '2026-12-07', 17, 23),
  mk(a, '2026-12-12', 17, 23), mk(d, '2026-12-12', 9, 17), mk(d, '2026-12-13', 9, 17),
  // Linked shifts, one with times that do not fit its template.
  mk(b, '2026-12-08', 11, 15, { shift_template_id: 'lunch' }),
  mk(c, '2026-12-08', 12, 16, { shift_template_id: 'lunch' }),
  // A link to a template that is not in the list: no fallback.
  mk(a, '2026-12-09', 11, 15, { shift_template_id: 'deleted' }),
  // Wrong day: lunch does not run on Saturday.
  mk(b, '2026-12-12', 11, 15),
  // Cancelled.
  mk(c, '2026-12-10', 11, 15, { status: 'cancelled' }),
  // The same employee twice in one slot.
  mk(b, '2026-12-10', 17, 23), mk(b, '2026-12-10', 17, 23),
  // A shift position that differs from the employee position.
  mk(a, '2026-12-11', 9, 17, { position: 'Cook' }),
];

function uiCounts(): Map<string, number> {
  const uiShifts = rows.map((r) => ({ ...r, position: r.position ?? '' })) as unknown as Shift[];
  const grid = buildTemplateGridData(uiShifts, templates as unknown as ShiftTemplate[], weekDays, CHI);
  const out = new Map<string, number>();
  for (const t of templates) {
    for (const day of weekDays) {
      const bucket = grid.get(t.id)?.get(day) ?? [];
      out.set(`${t.id}|${day}`, distinctAssignedCount(bucket as never));
    }
  }
  return out;
}

describe('coverage parity: MCP and planner UI', () => {
  it('counts the same staff for every slot', () => {
    const ui = uiCounts();
    const mcp = buildCoverage(templates as TemplateRow[], rows, null, {}, { start: weekDays[0], end: weekDays[6] }, CHI);
    expect(mcp.open_spots.length).toBeGreaterThan(0);
    for (const o of mcp.open_spots) {
      expect({ slot: `${o.template_id}|${o.date}`, assigned: o.assigned })
        .toEqual({ slot: `${o.template_id}|${o.date}`, assigned: ui.get(`${o.template_id}|${o.date}`) });
    }
    // The data is not trivial: some slots are full.
    expect(mcp.open_spots.some((o) => o.assigned > 0)).toBe(true);
  });
});
