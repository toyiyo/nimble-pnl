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
    const result = buildSchedulePrompt(makeContext({ requiredStaff }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Required Headcount Per Slot');
    expect(userContent).toContain('tpl-1');
    expect(userContent).toContain('Monday: 2');
    expect(userContent).toContain('Tuesday: 2');
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
});
