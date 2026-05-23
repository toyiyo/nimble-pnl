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
    { id: 'emp-1', name: 'Maria', position: 'server', hourly_rate: 1500 },
    { id: 'emp-2', name: 'Carlos', position: 'cook', hourly_rate: 1800 },
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
    // Monday-first ordering with two-space gutter for visual alignment;
    // exact-string match locks the UTC-midnight + ms-offset arithmetic
    // (a non-UTC dev box that drifts day numbering would fail this).
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
});
