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
  start_time_local: '09:00:00',
  end_time_local: '17:00:00',
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

describe('buildRoster weekly_hours', () => {
  const CHI = 'America/Chicago';
  // Tuesday 2026-12-01 to Monday 2026-12-14: weeks of 11-30 (partial), 12-07 (full), 12-14 (partial).
  const p = { start: '2026-12-01', end: '2026-12-14' };
  const s = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
    shift(id, 'a', { start_time: start, end_time: end, break_duration: 0, ...extra });

  it('lists every Monday week that touches the period, with 0 hours too', () => {
    const [r] = buildRoster([emp('a')], [], new Map(), p, CHI);
    expect(r.weekly_hours.map((w) => [w.week_start, w.scheduled_hours, w.partial_week])).toEqual([
      ['2026-11-30', 0, true],
      ['2026-12-07', 0, false],
      ['2026-12-14', 0, true],
    ]);
  });

  it('puts the hours in the week of the local start date', () => {
    // Sunday 2026-12-13 23:00 CST = Monday 05:00Z. It belongs to the week of 12-07.
    const [r] = buildRoster([emp('a')], [s('s1', '2026-12-14T05:00:00Z', '2026-12-14T09:00:00Z')], new Map(), p, CHI);
    expect(r.weekly_hours.find((w) => w.week_start === '2026-12-07')!.scheduled_hours).toBe(4);
    expect(r.weekly_hours.find((w) => w.week_start === '2026-12-14')!.scheduled_hours).toBe(0);
  });

  it('follows the scheduled_hours rule: no cancelled shifts, breaks subtracted', () => {
    const shifts = [
      s('s1', '2026-12-08T15:00:00Z', '2026-12-08T23:00:00Z', { break_duration: 30 }),
      s('s2', '2026-12-09T15:00:00Z', '2026-12-09T23:00:00Z', { status: 'cancelled' }),
    ];
    const [r] = buildRoster([emp('a')], shifts, new Map(), p, CHI);
    expect(r.weekly_hours.find((w) => w.week_start === '2026-12-07')!.scheduled_hours).toBe(7.5);
    expect(r.scheduled_hours).toBe(7.5);
  });

  it('flags a full week over max_weekly_hours', () => {
    const days = ['07', '08', '09', '10', '11', '12'];
    const shifts = days.map((d, i) => s(`s${i}`, `2026-12-${d}T14:00:00Z`, `2026-12-${d}T22:00:00Z`));
    const [r] = buildRoster([emp('a')], shifts, new Map(), p, CHI);
    const full = r.weekly_hours.find((w) => w.week_start === '2026-12-07')!;
    expect(r.max_weekly_hours).toBe(40);
    expect(full).toMatchObject({ scheduled_hours: 48, over_max_weekly_hours: true });
  });

  it('uses the age cap of each week, not the age at the period start', () => {
    // Born 2010-12-09: 15 on 2026-12-07 (cap 18), 16 on 2026-12-14 (cap 40).
    const p2 = { start: '2026-12-07', end: '2026-12-20' };
    const days = ['14', '15', '16', '17', '18'];
    const shifts = days.map((d, i) => s(`s${i}`, `2026-12-${d}T14:00:00Z`, `2026-12-${d}T20:00:00Z`));
    const [r] = buildRoster([emp('a', { date_of_birth: '2010-12-09' })], shifts, new Map(), p2, CHI);
    expect(r.max_weekly_hours).toBe(18);
    const adultWeek = r.weekly_hours.find((w) => w.week_start === '2026-12-14')!;
    expect(adultWeek).toMatchObject({ scheduled_hours: 30, over_max_weekly_hours: false });
  });

  it('gives over_max_weekly_hours null when the shift list is cut', () => {
    const [r] = buildRoster([emp('a')], [], new Map(), p, CHI, { shiftsTruncated: true });
    expect(r.weekly_hours.every((w) => w.over_max_weekly_hours === null)).toBe(true);
  });

  it('keeps over_max_weekly_hours true on a cut list when the known hours are already over', () => {
    const days = ['07', '08', '09', '10', '11', '12'];
    const shifts = days.map((d, i) => s(`s${i}`, `2026-12-${d}T14:00:00Z`, `2026-12-${d}T22:00:00Z`));
    const [r] = buildRoster([emp('a')], shifts, new Map(), p, CHI, { shiftsTruncated: true });
    expect(r.weekly_hours.find((w) => w.week_start === '2026-12-07')!.over_max_weekly_hours).toBe(true);
  });

  it('gives over_max_weekly_hours null on a partial week, and false on a full week under the cap', () => {
    const [r] = buildRoster([emp('a')], [s('s1', '2026-12-08T15:00:00Z', '2026-12-08T23:00:00Z')], new Map(), p, CHI);
    expect(r.weekly_hours.find((w) => w.week_start === '2026-11-30')!.over_max_weekly_hours).toBeNull();
    expect(r.weekly_hours.find((w) => w.week_start === '2026-12-07')!.over_max_weekly_hours).toBe(false);
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
  it('merges a window that ends at midnight with a later window', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 1, { start_time_local: '09:00:00', end_time_local: '00:00:00' }),
        rec('a', 1, { start_time_local: '18:00:00', end_time_local: '23:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({ 1: { start: '09:00', end: '24:00' } });
  });
  it('keeps split availability as separate windows', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 1, { start_time_local: '17:00:00', end_time_local: '21:00:00' }),
        rec('a', 1, { start_time_local: '09:00:00', end_time_local: '12:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({
      1: [{ start: '09:00', end: '12:00' }, { start: '17:00', end: '21:00' }],
    });
  });
  it('keeps the overnight end when a day window overlaps an overnight window', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 1, { start_time_local: '09:00:00', end_time_local: '17:00:00' }),
        rec('a', 1, { start_time_local: '16:00:00', end_time_local: '02:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({
      1: { start: '09:00', end: '24:00' },
      2: { start: '00:00', end: '02:00' },
    });
  });
  it('keeps a day window inside an overnight window as one window per day', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 1, { start_time_local: '08:00:00', end_time_local: '01:00:00' }),
        rec('a', 1, { start_time_local: '10:00:00', end_time_local: '14:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({
      1: { start: '08:00', end: '24:00' },
      2: { start: '00:00', end: '01:00' },
    });
  });
  it('returns not_set for an employee with no rows', () => {
    const out = buildAvailability([{ id: 'a' }], [], [], 'UTC', period);
    expect(out[0].weekly).toBe('not_set');
  });
  it('reads the local columns and does not shift them across a time change', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      // Legacy values that convert to other local times: the output must
      // come from the local columns.
      [rec('a', 1, { start_time: '03:00:00', end_time: '05:00:00' })],
      [],
      'America/Chicago',
      { start: '2026-11-02', end: '2026-11-08' },
    );
    expect(out[0].weekly).toEqual({ 1: { start: '09:00', end: '17:00' } });
  });
  it('splits an overnight window at midnight in a non-UTC zone', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [rec('a', 5, { start_time_local: '22:00:00', end_time_local: '02:00:00' })],
      [],
      'America/Chicago',
      { start: '2026-11-02', end: '2026-11-08' },
    );
    expect(out[0].weekly).toEqual({
      5: { start: '22:00', end: '24:00' },
      6: { start: '00:00', end: '02:00' },
    });
  });
  it('moves the next-day piece of a Saturday overnight window to Sunday', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [
        rec('a', 6, { start_time_local: '20:00:00', end_time_local: '01:00:00' }),
        rec('a', 0, { start_time_local: '10:00:00', end_time_local: '14:00:00' }),
      ],
      [],
      'UTC',
      period,
    );
    expect(out[0].weekly).toEqual({
      6: { start: '20:00', end: '24:00' },
      0: [{ start: '00:00', end: '01:00' }, { start: '10:00', end: '14:00' }],
    });
  });
  it('shows a midnight end as 24:00', () => {
    const out = buildAvailability(
      [{ id: 'a' }],
      [rec('a', 5, { start_time_local: '18:00:00', end_time_local: '00:00:00' })],
      [],
      'America/Chicago',
      period,
    );
    expect(out[0].weekly).toEqual({ 5: { start: '18:00', end: '24:00' } });
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

describe('buildCoverage with shifts that have no template id', () => {
  // A December week in Chicago made by "apply week template": no shift_template_id.
  // 2026-12-07 is a Monday. 17:00-23:00 CST = 23:00Z-05:00Z next day.
  const CHI = 'America/Chicago';
  const week = { start: '2026-12-07', end: '2026-12-13' };
  const dinner = {
    id: 'dinner', name: 'Dinner', days: [1, 2, 3, 4, 5], start_time: '17:00:00', end_time: '23:00:00',
    capacity: 2, position: 'Server', area: null, is_active: true,
  };
  const legacy = (id: string, emp: string, day: string, extra: Record<string, unknown> = {}) => ({
    id,
    employee_id: emp,
    start_time: `${day}T23:00:00Z`,
    end_time: `${addDay(day)}T05:00:00Z`,
    break_duration: 0,
    status: 'scheduled',
    position: 'Server',
    shift_template_id: null,
    ...extra,
  });
  function addDay(d: string): string {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  }
  const days = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'];
  const full = days.flatMap((d, i) => [legacy(`a${i}`, 'a', d), legacy(`b${i}`, 'b', d)]);

  it('counts legacy shifts that match on local time, position and day', () => {
    const c = buildCoverage([dinner], full, null, {}, week, CHI);
    expect(c.open_spots).toHaveLength(5);
    for (const o of c.open_spots) expect(o).toMatchObject({ capacity: 2, assigned: 2, open: 0 });
    expect(c.total_open_spots).toBe(0);
  });

  it('counts one employee once in a slot', () => {
    const twice = [legacy('x1', 'a', '2026-12-07'), legacy('x2', 'a', '2026-12-07')];
    const c = buildCoverage([dinner], twice, null, {}, week, CHI);
    expect(c.open_spots.find((o) => o.date === '2026-12-07')).toMatchObject({ assigned: 1, open: 1 });
  });

  it('uses the area from the employee join, also for an employee not in the roster', () => {
    const bar = { ...dinner, id: 'bar', area: 'Bar' };
    const patio = { ...dinner, id: 'patio', area: 'Patio' };
    const s = [legacy('p1', 'gone', '2026-12-07', { employee: { area: 'Patio', position: 'Server' } })];
    const c = buildCoverage([bar, patio], s, null, {}, week, CHI);
    const mon = (id: string) => c.open_spots.find((o) => o.template_id === id && o.date === '2026-12-07')!;
    expect(mon('patio').assigned).toBe(1);
    expect(mon('bar').assigned).toBe(0);
  });

  it('fills one slot at most with each shift, and open is capacity minus assigned', () => {
    const twin = { ...dinner, id: 'twin' };
    const c = buildCoverage([dinner, twin], full, null, {}, week, CHI);
    const assignedSum = c.open_spots.reduce((n, o) => n + o.assigned, 0);
    expect(assignedSum).toBeLessThanOrEqual(full.length);
    expect(assignedSum).toBe(full.length);
    for (const o of c.open_spots) expect(o.open).toBe(Math.max(0, o.capacity - o.assigned));
    expect(c.open_spots.filter((o) => o.template_id === 'twin').every((o) => o.assigned === 0)).toBe(true);
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
      {
        shift_id: 's1', employee_id: 'a', date: '2026-10-05',
        start_time_local: '2026-10-05T16:00:00+00:00', end_time_local: '2026-10-06T00:00:00+00:00', tz: 'UTC',
        type: 'time_off', rule: 'grid', source: 'request', status: 'approved', message: 'off',
        position_mismatch: false,
      },
    ]);
  });

  // QA on the preview branch: the list put the rule into source when the flag
  // had no source, so one key held two meanings. Keep the overview shape.
  it('keeps rule and source apart', () => {
    const idx = new Map([
      ['s1', [{ type: 'clopen' as const, rule: 'editor' as const, message: 'rest' }]],
    ]);
    const [e] = buildConflictList([shift('s1', 'a')], idx, 'UTC');
    expect(e.rule).toBe('editor');
    expect(e).not.toHaveProperty('source');
  });
});

describe('buildConflictList local time and position flags', () => {
  const idx = new Map([['s1', [{ type: 'overlap' as const, rule: 'editor' as const, message: 'overlap' }]]]);
  const s = shift('s1', 'a', {
    start_time: '2026-12-05T23:00:00Z',
    end_time: '2026-12-06T05:00:00Z',
    position: 'Bartender',
    employee: { area: null, position: 'Server' },
  });

  it('adds the local times and the tz', () => {
    const [e] = buildConflictList([s], idx, 'America/Chicago');
    expect(e).toMatchObject({
      date: '2026-12-05',
      start_time_local: '2026-12-05T17:00:00-06:00',
      end_time_local: '2026-12-05T23:00:00-06:00',
      tz: 'America/Chicago',
    });
  });

  it('flags a position mismatch with both values', () => {
    const [e] = buildConflictList([s], idx, 'America/Chicago');
    expect(e).toMatchObject({ position_mismatch: true, shift_position: 'Bartender', employee_position: 'Server' });
  });

  it('gives position_mismatch false and no values when the positions agree', () => {
    const same = { ...s, position: 'server' };
    const [e] = buildConflictList([same], idx, 'America/Chicago');
    expect(e.position_mismatch).toBe(false);
    expect(e).not.toHaveProperty('employee_position');
  });
});

describe('fitToLimit', () => {
  const build = (): SchedulingContext => {
    const emps = Array.from({ length: 40 }, (_, i) => emp(`e${i}`));
    const recs = emps.flatMap((e) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) =>
        rec(e.id, d, { start_time_local: `${String(8 + d).padStart(2, '0')}:00:00`, end_time_local: `${String(14 + d).padStart(2, '0')}:00:00` }),
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
  // Review on PR 846: CAPS.employees is 500, so the roster alone can pass the limit.
  it('cuts the roster when the roster alone is over the limit', () => {
    const roster = buildRoster(Array.from({ length: 300 }, (_, i) => emp(`e${i}`)), [], new Map(), period);
    const out = fitToLimit({ roster, availability: [], time_off: [], conflicts: [] }, 20_000);
    const text = JSON.stringify(out);
    expect(text.length).toBeLessThan(20_000);
    expect(out.omitted_sections).toContain('roster (partial)');
    expect((out.roster as unknown[]).length).toBeGreaterThan(0);
  });
  it('deletes the weekly hours before it deletes coverage', () => {
    const p = { start: '2026-10-05', end: '2026-11-04' };
    const roster = buildRoster(Array.from({ length: 40 }, (_, i) => emp(`e${i}`)), [], new Map(), p);
    const coverage = { open_spots: [{ template_id: 't1', date: '2026-10-05', capacity: 2, assigned: 2, open: 0 }] };
    const base = { roster, availability: [], time_off: [], conflicts: [], coverage, publish_state: [] };
    const withoutWeeks = JSON.stringify({ ...base, roster: roster.map(({ weekly_hours: _w, ...r }) => r) }).length;
    const out = fitToLimit(base, withoutWeeks + 200);
    expect(out).toHaveProperty('coverage');
    expect(out.omitted_sections).toContain('roster.weekly_hours');
    expect((out.roster as Record<string, unknown>[])[0]).not.toHaveProperty('weekly_hours');
    expect((out.roster as unknown[]).length).toBe(40);
  });
  it('does not set truncated when nothing is deleted', () => {
    const out = fitToLimit({ roster: [], availability: [], time_off: [], conflicts: [] }, 40_000);
    expect(out.truncated).toBeUndefined();
    expect(out.omitted_sections).toBeUndefined();
  });
});
