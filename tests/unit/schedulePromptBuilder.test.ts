import { describe, it, expect } from 'vitest';
import { buildSchedulePrompt, ScheduleContext } from '../../supabase/functions/_shared/schedule-prompt-builder';

describe('buildSchedulePrompt with employment_type', () => {
  const baseContext: ScheduleContext = {
    weekStart: '2026-04-13',
    employees: [
      { id: '1', name: 'Alice', position: 'Server', area: null, hourly_rate: 1500, employment_type: 'full_time', is_minor: false, max_weekly_hours: 40 },
      { id: '2', name: 'Bob', position: 'Cook', area: null, hourly_rate: 1800, employment_type: 'part_time', is_minor: false, max_weekly_hours: 40 },
    ],
    templates: [],
    availability: {},
    staffingSettings: null,
    priorSchedulePatterns: [],
    hourlySalesPatterns: [],
    weeklyBudgetTarget: null,
    lockedShifts: [],
  };

  it('includes employment_type in employee data', () => {
    const result = buildSchedulePrompt(baseContext);
    const userMessage = result.messages[1].content;
    expect(userMessage).toContain('"employment_type": "full_time"');
    expect(userMessage).toContain('"employment_type": "part_time"');
  });

  // Bug I removed the soft 35-40h FT / 15-25h PT preference rule —
  // it was the root cause of fulltimers getting scheduled over 40h while
  // others got zero. Replaced by HARD Rule 11 (per-employee weekly cap)
  // + Employee Hour Budgets section. Regression coverage for the new
  // behavior lives in schedule-prompt-builder.test.ts under the
  // "hour caps and consecutive days (Bug I)" describe block.
});
