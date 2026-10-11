import { describe, it, expect } from 'vitest';
import {
  buildRoster,
  buildAvailability,
  buildConflictList,
  buildTimeOff,
  buildCoverage,
  buildPending,
  buildPublishState,
  fitToLimit,
  DROPPABLE_SECTIONS,
  type SchedulingContext,
} from '../../supabase/functions/_shared/schedulingContext';

const period = { start: '2026-10-05', end: '2026-10-11' };
const emp = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Emp ${id}`,
  position: 'Server',
  area: 'FOH',
  employment_type: 'part_time',
  status: 'active',
  ...extra,
});
const shift = (id: string, employee_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  employee_id,
  start_time: '2026-10-05T16:00:00Z',
  end_time: '2026-10-06T00:00:00Z',
  break_duration: 30,
  status: 'scheduled',
  ...extra,
});
const rec = (employee_id: string, day_of_week: number, extra: Record<string, unknown> = {}) => ({
  employee_id,
  day_of_week,
  is_available: true,
  start_time: '09:00:00',
  end_time: '17:00:00',
  ...extra,
});

describe('buildRoster', () => {
  it('sums hours, skips cancelled shifts, subtracts breaks', () => {
    const r = buildRoster(
      [emp('a')],
      [shift('s1', 'a'), shift('s2', 'a', { status: 'cancelled' })],
      new Map(),
      period,
    );
    expect(r[0].scheduled_hours).toBe(7.5);
    expect(r[0].shift_count).toBe(1);
  });
  it('flags missing availability only when no recurring row exists', () => {
    const r = buildRoster(
      [emp('a'), emp('b'), emp('c', { status: 'inactive' })],
      [],
      new Map([['b', [1]]]),
      period,
    );
    expect(r.map((x) => [x.id, x.missing_availability])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
  it('gives a minor a stored cap', () => {
    const r = buildRoster([emp('a', { date_of_birth: '2012-01-01' })], [], new Map(), period);
    expect(r[0].is_minor).toBe(true);
    expect(r[0].max_weekly_hours).toBe(18);
    expect(r[0].max_weekly_hours_note).toBe('stored, not enforced');
  });
});

describe('buildAvailability', () => {
  it('lists a recurring row once and keeps period exceptions only', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [rec('a', 1, { notes: 'No Mondays after 5' })],
      [
        { employee_id: 'a', date: '2026-10-07', is_available: false, start_time: null, end_time: null, reason: 'Exam' },
        { employee_id: 'a', date: '2026-11-07', is_available: false, start_time: null, end_time: null },
      ],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({ 1: { start: '09:00', end: '17:00' } });
    expect(out[0].notes).toBe('No Mondays after 5');
    expect(out[0].exceptions).toEqual([{ date: '2026-10-07', available: false, reason: 'Exam' }]);
  });
  it('keeps split availability as separate windows', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 1, { start_time: '17:00:00', end_time: '21:00:00' }),
        rec('a', 1, { start_time: '09:00:00', end_time: '12:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({
      1: [{ start: '09:00', end: '12:00' }, { start: '17:00', end: '21:00' }],
    });
  });
  it('returns not_set for an employee with no rows', () => {
    const out = buildAvailability([{ id: 'a' }], [], [], 'UTC', period);
    expect(out[0].weekly).toBe('not_set');
  });
  it('keeps the local times of an overnight window', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [rec('a', 5, { start_time: '22:00:00', end_time: '02:00:00' })],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({ 5: { start: '22:00', end: '02:00' } });
  });
});

describe('buildTimeOff', () => {
  it('returns approved and pending as blocking, drops denied and cancelled', () => {
    const rows = ['approved', 'pending', 'denied', 'cancelled'].map((status) => ({
      employee_id: 'a',
      start_date: '2026-10-06',
      end_date: '2026-10-07',
      status,
    }));
    const out = buildTimeOff(rows);
    expect(out.map((o) => o.status)).toEqual(['approved', 'pending']);
    expect(out.every((o) => o.blocks_scheduling)).toBe(true);
  });
});

describe('buildCoverage', () => {
  const tpl = [
    { id: 't1', name: 'Lunch', days: [1, 2], start_time: '16:00:00', end_time: '20:00:00', capacity: 3, is_active: true },
  ];
  const shifts = [
    shift('s1', 'a', { shift_template_id: 't1' }),
    shift('s2', 'b', { shift_template_id: 't1' }),
    shift('s3', 'c', { shift_template_id: 't1', status: 'cancelled' }),
  ];
  it('counts open spots per template and date', () => {
    const c = buildCoverage(tpl, shifts, { open_shifts_enabled: true }, { '2026-10-05': true }, period);
    const mon = c.open_spots.find((o) => o.date === '2026-10-05')!;
    expect(mon).toMatchObject({ capacity: 3, assigned: 2, open: 1 });
    expect(c.total_open_spots).toBe(1 + 3);
  });
  it('broadcasts only when published and enabled', () => {
    const f = (enabled: boolean, pub: boolean) =>
      buildCoverage(tpl, [], { open_shifts_enabled: enabled }, { '2026-10-05': pub }, period)
        .can_broadcast_open_shifts;
    expect(f(true, true)).toBe(true);
    expect(f(true, false)).toBe(false);
    expect(f(false, true)).toBe(false);
  });
});

describe('buildPending', () => {
  it('keeps hidden markers and labels the time-off scope', () => {
    const hidden = { hidden: true as const, reason: 'needs edit:scheduling' };
    const p = buildPending(hidden, hidden, [{ id: 1 }]);
    expect(p.trades).toEqual(hidden);
    expect(p.claims).toEqual(hidden);
    expect(p.time_off.scope).toBe('all pending requests, not only this period');
  });
});

describe('buildPublishState', () => {
  it('is published only when both sets hold the week', () => {
    const out = buildPublishState(['w1', 'w2', 'w3'], new Set(['w1', 'w2']), new Set(['w1', 'w3']));
    expect(out.map((o) => o.state)).toEqual(['published', 'draft', 'draft']);
  });
});

describe('buildConflictList', () => {
  it('flattens the index with a local date', () => {
    const idx = new Map([
      ['s1', [{ type: 'time_off' as const, rule: 'grid' as const, source: 'request', status: 'approved', message: 'off' }]],
    ]);
    const out = buildConflictList([shift('s1', 'a')], idx, 'UTC');
    expect(out).toEqual([
      { shift_id: 's1', employee_id: 'a', date: '2026-10-05', type: 'time_off', source: 'request', status: 'approved', message: 'off' },
    ]);
  });
});

describe('fitToLimit', () => {
  const build = (): SchedulingContext => {
    const emps = Array.from({ length: 40 }, (_, i) => emp(`e${i}`));
    const recs = emps.flatMap((e) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) =>
        rec(e.id, d, { start_time: `${String(8 + d).padStart(2, '0')}:00:00`, end_time: `${String(14 + d).padStart(2, '0')}:00:00` }),
      ),
    );
    const excs = emps.flatMap((e) =>
      [0, 7, 14, 21, 28].map((off) => {
        const d = new Date(Date.UTC(2026, 9, 5 + off)).toISOString().slice(0, 10);
        return { employee_id: e.id, date: d, is_available: false, start_time: null, end_time: null, reason: 'Class' };
      }),
    );
    const p = { start: '2026-10-05', end: '2026-11-04' };
    return {
      roster: buildRoster(emps, [], new Map(emps.map((e) => [e.id, 1])), p),
      availability: buildAvailability(emps, recs, excs, 'UTC', p),
      time_off: [],
      conflicts: [],
      coverage: { filler: 'x'.repeat(15000) },
      pending: { filler: 'y'.repeat(15000) },
      publish_state: [],
      labor: { staffing_suggestions: { filler: 'z'.repeat(15000) } },
    };
  };
  it('keeps the core sections and drops droppable ones in order', () => {
    const out = fitToLimit(build(), 40_000);
    const text = JSON.stringify(out);
    expect(text.length).toBeLessThan(40_000);
    expect(() => JSON.parse(text)).not.toThrow();
    for (const k of ['roster', 'availability', 'time_off', 'conflicts']) expect(out).toHaveProperty(k);
    expect(out.truncated).toBe(true);
    const dropped = out.omitted_sections!.filter((s) => s !== 'publish_state');
    const expected = DROPPABLE_SECTIONS.filter((s) => s !== 'publish_state').slice(0, dropped.length);
    expect(dropped).toEqual(expected);
  });
  it('cuts the conflict list when the droppable sections are not enough', () => {
    const conflicts = Array.from({ length: 400 }, (_, i) => ({ shift_id: `s${i}`, message: 'm'.repeat(80) }));
    const out = fitToLimit({ roster: [], availability: [], time_off: [], conflicts }, 5_000);
    const text = JSON.stringify(out);
    expect(text.length).toBeLessThan(5_000);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(out.truncated).toBe(true);
    expect(out.omitted_sections).toContain('conflicts (partial)');
  });
  it('does not set truncated when nothing is deleted', () => {
    const out = fitToLimit({ roster: [], availability: [], time_off: [], conflicts: [] }, 40_000);
    expect(out.truncated).toBeUndefined();
    expect(out.omitted_sections).toBeUndefined();
  });
});
