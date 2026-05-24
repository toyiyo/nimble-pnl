import { describe, it, expect } from 'vitest';
import {
  buildSchedulePrompt,
  type ScheduleContext,
  type ScheduleEmployee,
  type ScheduleTemplate,
  type LockedShift,
} from '../../supabase/functions/_shared/schedule-prompt-builder';

function makeContext(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  const employees: ScheduleEmployee[] = [
    { id: 'emp-1', name: 'Maria', position: 'server', hourly_rate: 1500,
      is_minor: false, max_weekly_hours: 40 },
    { id: 'emp-2', name: 'Carlos', position: 'cook', hourly_rate: 1800,
      is_minor: false, max_weekly_hours: 40 },
  ];

  const templates: ScheduleTemplate[] = [
    {
      id: 'tpl-1',
      name: 'Lunch Server',
      days: [1, 2, 3, 4, 5],
      start_time: '11:00:00',
      end_time: '16:00:00',
      position: 'server',
    },
    {
      id: 'tpl-2',
      name: 'Dinner Cook',
      days: [3, 4, 5, 6],
      start_time: '16:00:00',
      end_time: '22:00:00',
      position: 'cook',
    },
  ];

  const availability: Record<string, Record<number, { available: boolean; start?: string; end?: string }>> = {
    'emp-1': {
      1: { available: true, start: '10:00', end: '18:00' },
      2: { available: true, start: '10:00', end: '18:00' },
      3: { available: false },
      4: { available: true },
      5: { available: true },
    },
    'emp-2': {
      3: { available: true, start: '15:00', end: '23:00' },
      4: { available: true },
      5: { available: true },
      6: { available: true },
    },
  };

  return {
    weekStart: '2026-04-13',
    employees,
    templates,
    availability,
    staffingSettings: null,
    priorSchedulePatterns: [
      { day_of_week: 5, position: 'server', avg_count: 3 },
      { day_of_week: 6, position: 'cook', avg_count: 2 },
    ],
    hourlySalesPatterns: [
      { day_of_week: 5, hour: 12, avg_sales: 850 },
      { day_of_week: 5, hour: 18, avg_sales: 1200 },
      { day_of_week: 6, hour: 12, avg_sales: 950 },
    ],
    weeklyBudgetTarget: 450000, // $4500 in cents
    lockedShifts: [],
    ...overrides,
  };
}

describe('buildSchedulePrompt', () => {
  it('returns messages array with system and user roles', () => {
    const result = buildSchedulePrompt(makeContext());
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('user');
    expect(typeof result.messages[0].content).toBe('string');
    expect(typeof result.messages[1].content).toBe('string');
  });

  it('includes employee data in user prompt (name, position, id)', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Maria');
    expect(userContent).toContain('Carlos');
    expect(userContent).toContain('server');
    expect(userContent).toContain('cook');
    expect(userContent).toContain('emp-1');
    expect(userContent).toContain('emp-2');
  });

  it('includes template data (name, times)', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Lunch Server');
    expect(userContent).toContain('Dinner Cook');
    expect(userContent).toContain('11:00:00');
    expect(userContent).toContain('16:00:00');
    expect(userContent).toContain('22:00:00');
  });

  it('includes availability data', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    // Should mention employees and their availability
    expect(userContent).toContain('Maria');
    expect(userContent).toContain('Carlos');
    // Availability section should be present
    expect(userContent.toLowerCase()).toContain('availab');
  });

  it('includes hourly sales patterns', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    expect(userContent.toLowerCase()).toContain('sales');
    // Should include the avg_sales values
    expect(userContent).toContain('850');
    expect(userContent).toContain('1200');
    expect(userContent).toContain('950');
  });

  it('includes budget target', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    expect(userContent.toLowerCase()).toContain('budget');
    // $4500 budget (cents / 100)
    expect(userContent).toContain('4500');
  });

  it('includes locked shifts when present', () => {
    const lockedShifts: LockedShift[] = [
      {
        id: 'shift-99',
        employee_name: 'Maria',
        day: '2026-04-14',
        start_time: '11:00:00',
        end_time: '16:00:00',
        position: 'server',
      },
    ];
    const result = buildSchedulePrompt(makeContext({ lockedShifts }));
    const userContent = result.messages[1].content as string;
    expect(userContent.toLowerCase()).toContain('locked');
    expect(userContent).toContain('shift-99');
    expect(userContent).toContain('2026-04-14');
  });

  it('includes response_format with JSON schema (shifts + metadata properties)', () => {
    const result = buildSchedulePrompt(makeContext());
    expect(result.response_format).toBeDefined();
    expect(result.response_format.type).toBe('json_schema');
    expect(result.response_format.json_schema).toBeDefined();
    expect(result.response_format.json_schema.name).toBe('schedule_suggestion');
    expect(result.response_format.json_schema.strict).toBe(true);

    const schema = result.response_format.json_schema.schema;
    expect(schema.properties.shifts).toBeDefined();
    expect(schema.properties.metadata).toBeDefined();

    const shiftItem = schema.properties.shifts.items;
    expect(shiftItem.properties.employee_id).toBeDefined();
    expect(shiftItem.properties.template_id).toBeDefined();
    expect(shiftItem.properties.day).toBeDefined();
    expect(shiftItem.properties.start_time).toBeDefined();
    expect(shiftItem.properties.end_time).toBeDefined();
    expect(shiftItem.properties.position).toBeDefined();

    const metaProps = schema.properties.metadata.properties;
    expect(metaProps.estimated_cost).toBeDefined();
    expect(metaProps.budget_variance_pct).toBeDefined();
    expect(metaProps.notes).toBeDefined();
  });
});

describe('buildSchedulePrompt — fill-slot enhancements', () => {
  it('renders 7 days per employee (including missing days as unavailable)', () => {
    const ctx = makeContext({
      // emp-1 has only Mon (1) and Tue (2) in availability
      availability: {
        'emp-1': {
          1: { available: true, start: '10:00', end: '18:00' },
          2: { available: false },
        },
        'emp-2': {
          3: { available: true },
        },
      },
    });
    const result = buildSchedulePrompt(ctx);
    const userContent = result.messages[1].content as string;
    // All 7 day names should appear for emp-1
    expect(userContent).toContain('Sunday');
    expect(userContent).toContain('Monday');
    expect(userContent).toContain('Tuesday');
    expect(userContent).toContain('Wednesday');
    expect(userContent).toContain('Thursday');
    expect(userContent).toContain('Friday');
    expect(userContent).toContain('Saturday');
  });

  it('renders a Required Headcount Per Slot section when requiredStaff provided', () => {
    const requiredStaff = new Map<string, Map<number, number>>([
      ['tpl-1', new Map([[1, 2], [2, 2], [3, 1]])],
      ['tpl-2', new Map([[3, 3]])],
    ]);
    // weekStart 2026-04-13 is a Monday, so Mon = 04-13, Tue = 04-14.
    const result = buildSchedulePrompt(makeContext({ requiredStaff }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Required Headcount Per Slot');
    expect(userContent).toContain('tpl-1');
    // Lines carry the date inline so the LLM never has to map a day name
    // back to a calendar date (Bug H regression — see the dedicated
    // "Target Week date map" describe block below).
    expect(userContent).toContain('Monday 2026-04-13: 2');
    expect(userContent).toContain('Tuesday 2026-04-14: 2');
  });

  it('omits Required Headcount section when requiredStaff is null', () => {
    const result = buildSchedulePrompt(makeContext({ requiredStaff: null }));
    const userContent = result.messages[1].content as string;
    expect(userContent).not.toContain('Required Headcount Per Slot');
  });

  it('includes a hard "fill every required slot" rule in the system prompt', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent).toMatch(/fill .*required/i);
    expect(systemContent.toLowerCase()).toContain('coverage');
  });

  it('includes a note that all times are restaurant local', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent.toLowerCase()).toContain('restaurant local');
  });

  // ── Bug D regression: Rule 1 must constrain template usage to listed
  // active days. Without this, the LLM occasionally placed a weekend-only
  // template on a weekday and the validator (pre-Bug-C fix) accepted it.
  it('Rule 1 constrains template usage to the listed active days', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent).toMatch(/only on the days listed/i);
    expect(systemContent.toLowerCase()).toContain('active days');
  });

  // ── Bug F regression: Rule 5 must explicitly forbid overlapping/back-to-
  // back same-day shifts for the same employee. The old wording ("not in
  // the same time slot") was ambiguous and the LLM read it as exact-time
  // match. In production it stacked Open (10:00-16:30) + Close (16:00-
  // 23:30) on the same employee Fri/Sat/Sun; the validator then dropped
  // the Close shift with DOUBLE_BOOKING, producing 2/4 close-weekend
  // under-fill.
  it('Rule 5 forbids overlapping same-day shifts and names the open+close case', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent.toLowerCase()).toContain('overlap');
    // The rule should call out the open+close pattern by name so the LLM
    // sees a concrete example, not just abstract overlap language.
    expect(systemContent.toLowerCase()).toMatch(/open .*close|close .*open/);
    // The rule should also call out that even a one-minute overlap counts.
    expect(systemContent.toLowerCase()).toMatch(/one[ -]minute|even.*minute/);
  });
});

// ── Bug H regression: the LLM was treating "Week starting: 2026-06-08" as
// Sunday-first and shifting day-name → date by +1 day. Weekend-only
// templates (days = [0,5,6]) landed on Monday and the validator dropped
// them as DAY_NOT_IN_TEMPLATE, leaving Mon = 0/X and Fri = 0/X in the
// planner. Fix: emit an explicit day-name → date map at the top of the
// user prompt AND inline the matching date next to every Required
// Headcount Per Slot entry, so the LLM never has to do calendar math.
describe('buildSchedulePrompt — Target Week date map (Bug H)', () => {
  it('renders all seven day-name → date pairs for a Monday week start', () => {
    const result = buildSchedulePrompt(makeContext({ weekStart: '2026-06-08' }));
    const userContent = result.messages[1].content as string;
    // Monday-first ordering, labels right-padded to 9 chars so the date
    // column lines up after a single separator. Exact-string match locks
    // the UTC-midnight + ms-offset arithmetic (a non-UTC dev box that
    // drifts day numbering would fail this).
    expect(userContent).toContain('Monday    2026-06-08');
    expect(userContent).toContain('Tuesday   2026-06-09');
    expect(userContent).toContain('Wednesday 2026-06-10');
    expect(userContent).toContain('Thursday  2026-06-11');
    expect(userContent).toContain('Friday    2026-06-12');
    expect(userContent).toContain('Saturday  2026-06-13');
    expect(userContent).toContain('Sunday    2026-06-14');
  });

  it('renders the dates for a different Monday (no hard-coded week)', () => {
    // April 13 2026 is a Monday; verifies the helper, not a test fixture.
    const result = buildSchedulePrompt(makeContext({ weekStart: '2026-04-13' }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Monday    2026-04-13');
    expect(userContent).toContain('Tuesday   2026-04-14');
    expect(userContent).toContain('Sunday    2026-04-19');
  });

  it('rolls month boundaries cleanly', () => {
    // Monday 2026-06-29 → Sunday 2026-07-05 spans the month boundary.
    const result = buildSchedulePrompt(makeContext({ weekStart: '2026-06-29' }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Monday    2026-06-29');
    expect(userContent).toContain('Tuesday   2026-06-30');
    expect(userContent).toContain('Wednesday 2026-07-01');
    expect(userContent).toContain('Sunday    2026-07-05');
  });

  it('rolls year boundaries cleanly', () => {
    // Monday 2026-12-28 → Sunday 2027-01-03 spans the year boundary.
    const result = buildSchedulePrompt(makeContext({ weekStart: '2026-12-28' }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Monday    2026-12-28');
    expect(userContent).toContain('Wednesday 2026-12-30');
    expect(userContent).toContain('Thursday  2026-12-31');
    expect(userContent).toContain('Friday    2027-01-01');
    expect(userContent).toContain('Sunday    2027-01-03');
  });

  it('does NOT emit the bare "Week starting: …" failure-mode anchor', () => {
    const result = buildSchedulePrompt(makeContext({ weekStart: '2026-06-08' }));
    const userContent = result.messages[1].content as string;
    // Adding "Week starting: <date>" back without the day-name map would
    // be a Bug H regression — the LLM would have to compute days again.
    expect(userContent).not.toMatch(/^Week starting: \d{4}-\d{2}-\d{2}$/m);
  });

  it('includes an explicit instruction not to compute dates', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    // Surface the prompt's intent so a future refactor cannot silently
    // drop the "use these dates verbatim" guidance.
    expect(userContent.toLowerCase()).toContain('do not compute dates');
  });

  it('inlines the matching YYYY-MM-DD on Required Headcount Per Slot lines', () => {
    const requiredStaff = new Map<string, Map<number, number>>([
      // tpl-1 = Lunch Server, Mon (1) + Tue (2) under the makeContext default.
      ['tpl-1', new Map([[1, 2], [2, 2]])],
    ]);
    const result = buildSchedulePrompt(
      makeContext({ weekStart: '2026-06-08', requiredStaff }),
    );
    const userContent = result.messages[1].content as string;
    // Format: "<DayName> <YYYY-MM-DD>: <count>". The LLM sees the same
    // date here as in the Target Week map — no two-section lookup needed.
    expect(userContent).toContain('Monday 2026-06-08: 2');
    expect(userContent).toContain('Tuesday 2026-06-09: 2');
    // Negative: the old "Monday: 2" form (day name + colon, no date)
    // must not appear, because it would let the LLM go back to computing
    // dates from the bare anchor.
    expect(userContent).not.toMatch(/\| Monday: 2\b/);
    expect(userContent).not.toMatch(/\| Tuesday: 2\b/);
  });

  it('skips out-of-range day indexes in Required Headcount instead of emitting "undefined"', () => {
    // template.days is validated 0..6 upstream, but if a stray entry
    // ever reached this builder the old form would emit "Day 7
    // undefined: 3" into the prompt. We skip the entry instead — the
    // line stays well-formed and the LLM never sees a literal
    // "undefined" token.
    const requiredStaff = new Map([['tpl-bad', new Map([[1, 2], [7, 9]])]]);
    const ctx = makeContext({
      weekStart: '2026-06-08',
      templates: [
        { id: 'tpl-bad', name: 'Bad', days: [1], start_time: '10:00:00', end_time: '16:30:00', position: 'Server', area: null, capacity: 2 },
      ],
      requiredStaff,
    });
    const userContent = buildSchedulePrompt(ctx).messages[1].content as string;
    expect(userContent).toContain('Monday 2026-06-08: 2');
    expect(userContent).not.toContain('undefined');
    expect(userContent).not.toContain('Day 7');
  });

  it('throws on an invalid weekStart instead of silently emitting NaN rows', () => {
    // Without this guard, new Date('garbageT00:00:00Z') is Invalid Date,
    // the UTC accessors return NaN, and the prompt would carry seven
    // `NaN-NaN-NaN` rows — the LLM would either hallucinate dates or
    // fail structured output with no signal to the caller. Test locks
    // in a fail-fast error at the helper boundary.
    expect(() => buildSchedulePrompt(makeContext({ weekStart: 'garbage' }))).toThrow(/invalid weekStart/);
  });
});

// ── Bug I regression: AI generator was scheduling fulltimers over 40h
// while leaving other employees with zero hours, and minors were getting
// the same 40h cap as adults. Three new HARD rules in the system prompt
// and a new "Employee Hour Budgets" table in the user prompt give the
// LLM the per-employee max it must respect, plus the validator backstop
// that drops over-cap shifts. These tests lock the prompt copy.
describe('buildSchedulePrompt — hour caps and consecutive days (Bug I)', () => {
  it('includes HARD Rule 11 capping weekly hours at the employee budget', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    // Rule 11 is the hard cap. Phrasing should call out the per-employee
    // budget and explicitly forbid overtime so the LLM cannot interpret
    // "soft preference" the way prior wording allowed.
    expect(systemContent).toMatch(/HARD Rule 11/i);
    expect(systemContent.toLowerCase()).toMatch(/max_weekly_hours|weekly hour cap|hour budget/);
    expect(systemContent.toLowerCase()).toMatch(/never .*overtime|no overtime/);
  });

  it('includes HARD Rule 12 limiting consecutive scheduled days to 5', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent).toMatch(/HARD Rule 12/i);
    expect(systemContent.toLowerCase()).toMatch(/5 (consecutive|days? straight|days? in a row)/);
  });

  it('includes HARD Rule 14 for the under-16 minor cap (about 18h)', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent).toMatch(/HARD Rule 14/i);
    // Cap value (18) and the under-16 qualifier should both be present so
    // the LLM does not infer a different threshold from "minor".
    expect(systemContent).toMatch(/18\s*h/i);
    expect(systemContent.toLowerCase()).toMatch(/under.?16|under 16/);
  });

  it('renders an Employee Hour Budgets section listing each employee max', () => {
    const result = buildSchedulePrompt(makeContext());
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Employee Hour Budgets');
    // Each employee id followed by their cap. Exact string match locks
    // the renderer format so a refactor can't silently drop the cap.
    expect(userContent).toMatch(/emp-1[^\n]*40h/);
    expect(userContent).toMatch(/emp-2[^\n]*40h/);
  });

  it('marks an under-16 minor with both the 18h cap AND a minor label', () => {
    const ctx = makeContext({
      employees: [
        { id: 'emp-1', name: 'Maria', position: 'server', hourly_rate: 1500,
          is_minor: false, max_weekly_hours: 40 },
        { id: 'emp-3', name: 'Ana', position: 'server', hourly_rate: 1200,
          is_minor: true, max_weekly_hours: 18 },
      ],
    });
    const userContent = buildSchedulePrompt(ctx).messages[1].content as string;
    // The minor row should pair the id with the 18h cap and tag it as
    // "minor" so the LLM doesn't lump them with the adult 40h pool.
    expect(userContent).toMatch(/emp-3[^\n]*18h/);
    expect(userContent).toMatch(/emp-3[^\n]*minor/i);
  });

  it('marks a 16-17yo minor (40h cap) as minor without the under-16 tag', () => {
    // Dispatch parity with the validator: is_minor=true + cap=40 means
    // a 16-17yo. The prompt should flag them as a minor for awareness
    // (managers may want to be conservative) but the cap stays 40h.
    const ctx = makeContext({
      employees: [
        { id: 'emp-4', name: 'Sam', position: 'server', hourly_rate: 1400,
          is_minor: true, max_weekly_hours: 40 },
      ],
    });
    const userContent = buildSchedulePrompt(ctx).messages[1].content as string;
    expect(userContent).toMatch(/emp-4[^\n]*40h/);
    expect(userContent).toMatch(/emp-4[^\n]*minor/i);
    // Should NOT carry the "under 16" qualifier — that's only for the 18h cap.
    expect(userContent).not.toMatch(/emp-4[^\n]*under.?16/i);
  });

  it('renders the budget section in deterministic order (by employee id)', () => {
    const ctx = makeContext({
      employees: [
        { id: 'emp-z', name: 'Zoe', position: 'server', hourly_rate: 1500,
          is_minor: false, max_weekly_hours: 40 },
        { id: 'emp-a', name: 'Aaron', position: 'server', hourly_rate: 1500,
          is_minor: false, max_weekly_hours: 40 },
        { id: 'emp-m', name: 'Maya', position: 'server', hourly_rate: 1500,
          is_minor: true, max_weekly_hours: 18 },
      ],
    });
    const userContent = buildSchedulePrompt(ctx).messages[1].content as string;
    // Extract budget section by anchoring on the header and the first
    // double newline that follows. Sort key is employee id so re-runs of
    // the prompt with the same context produce identical text — needed
    // for prompt-cache hits.
    const sectionStart = userContent.indexOf('Employee Hour Budgets');
    expect(sectionStart).toBeGreaterThan(-1);
    const section = userContent.slice(sectionStart, sectionStart + 600);
    const idxA = section.indexOf('emp-a');
    const idxM = section.indexOf('emp-m');
    const idxZ = section.indexOf('emp-z');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxM).toBeGreaterThan(idxA);
    expect(idxZ).toBeGreaterThan(idxM);
  });
});
