import { describe, it, expect } from 'vitest';
import { buildSchedulePrompt, ScheduleContext } from '../../supabase/functions/_shared/schedule-prompt-builder';

describe('buildSchedulePrompt with employment_type', () => {
  const baseContext: ScheduleContext = {
    weekStart: '2026-04-13',
    employees: [
      { id: '1', name: 'Alice', position: 'Server', area: null, hourly_rate: 1500, employment_type: 'full_time' },
      { id: '2', name: 'Bob', position: 'Cook', area: null, hourly_rate: 1800, employment_type: 'part_time' },
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

  it('includes FT/PT scheduling rule in system prompt', () => {
    const result = buildSchedulePrompt(baseContext);
    const systemMessage = result.messages[0].content;
    expect(systemMessage).toContain('Full-time');
    expect(systemMessage).toContain('Part-time');
    expect(systemMessage).toContain('35-40 hours');
    expect(systemMessage).toContain('15-25 hours');
  });
});
