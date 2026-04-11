/**
 * schedule-prompt-builder.ts
 *
 * Pure function that builds a structured OpenRouter API request body
 * for AI-powered schedule generation. Takes a ScheduleContext and returns
 * an object with `messages` and `response_format` ready to send to the API.
 */

export interface ScheduleEmployee {
  id: string;
  name: string;
  position: string;
  hourly_rate: number; // cents
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  position: string;
}

export interface AvailabilityDay {
  available: boolean;
  start?: string;
  end?: string;
}

export interface PriorPattern {
  day_of_week: number;
  position: string;
  avg_count: number;
}

export interface HourlySales {
  day_of_week: number;
  hour: number;
  avg_sales: number;
}

export interface LockedShift {
  id: string;
  employee_name: string;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

export interface ScheduleContext {
  weekStart: string;
  employees: ScheduleEmployee[];
  templates: ScheduleTemplate[];
  availability: Record<string, Record<number, AvailabilityDay>>;
  staffingSettings: Record<string, { min: number }> | null;
  priorSchedulePatterns: PriorPattern[];
  hourlySalesPatterns: HourlySales[];
  weeklyBudgetTarget: number | null; // cents
  lockedShifts: LockedShift[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SYSTEM_PROMPT = `You are a restaurant schedule optimizer. Your job is to create an optimal weekly shift schedule.

RULES:
1. ONLY use the provided shift templates as shift blocks — do not invent custom time ranges.
2. ONLY assign employees to templates matching their position.
3. ONLY assign employees on days/times they are available.
4. Do NOT assign any employee more than once in the same time slot (no double-booking).
5. Do NOT modify or reassign any locked shifts — they are fixed.
6. Weight staffing toward peak sales hours — more staff during lunch/dinner rushes.
7. If staffing settings specify minimum crew per position, meet those minimums when possible.
8. If no staffing settings exist, use prior schedule patterns to infer typical staffing levels.
9. Try to stay within the weekly labor budget target. If adequate coverage requires exceeding it, note the variance.

Return valid JSON only, matching the provided schema exactly.`;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'schedule_suggestion',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        shifts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              employee_id: { type: 'string' },
              template_id: { type: 'string' },
              day: { type: 'string', description: 'YYYY-MM-DD' },
              start_time: { type: 'string', description: 'HH:MM:SS' },
              end_time: { type: 'string', description: 'HH:MM:SS' },
              position: { type: 'string' },
            },
            required: ['employee_id', 'template_id', 'day', 'start_time', 'end_time', 'position'],
            additionalProperties: false,
          },
        },
        metadata: {
          type: 'object',
          properties: {
            estimated_cost: { type: 'number' },
            budget_variance_pct: { type: 'number' },
            notes: { type: 'string' },
          },
          required: ['estimated_cost', 'budget_variance_pct', 'notes'],
          additionalProperties: false,
        },
      },
      required: ['shifts', 'metadata'],
      additionalProperties: false,
    },
  },
};

function buildUserPrompt(ctx: ScheduleContext): string {
  const sections: string[] = [];

  // Target week
  sections.push(`## Target Week\nWeek starting: ${ctx.weekStart}`);

  // Available employees
  const employeesForPrompt = ctx.employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    hourly_rate_dollars: (e.hourly_rate / 100).toFixed(2),
  }));
  sections.push(`## Available Employees\n${JSON.stringify(employeesForPrompt, null, 2)}`);

  // Shift templates
  const templatesSection = ctx.templates.map((t) => {
    const dayNames = t.days.map((d) => DAY_NAMES[d]).join(', ');
    return `- [${t.id}] "${t.name}" | position: ${t.position} | ${t.start_time}–${t.end_time} | active days: ${dayNames}`;
  });
  sections.push(`## Shift Templates\n${templatesSection.join('\n')}`);

  // Employee availability
  const availLines: string[] = [];
  for (const [empId, days] of Object.entries(ctx.availability)) {
    const employee = ctx.employees.find((e) => e.id === empId);
    const empName = employee ? employee.name : empId;
    const dayLines: string[] = [];
    for (const [dayStr, avail] of Object.entries(days)) {
      const dayNum = parseInt(dayStr, 10);
      const dayName = DAY_NAMES[dayNum] ?? `Day ${dayNum}`;
      if (!avail.available) {
        dayLines.push(`  ${dayName}: unavailable`);
      } else if (avail.start && avail.end) {
        dayLines.push(`  ${dayName}: available ${avail.start}–${avail.end}`);
      } else {
        dayLines.push(`  ${dayName}: available (all day)`);
      }
    }
    availLines.push(`${empName} (${empId}):\n${dayLines.join('\n')}`);
  }
  sections.push(`## Employee Availability\n${availLines.join('\n\n')}`);

  // Minimum staffing requirements
  if (ctx.staffingSettings && Object.keys(ctx.staffingSettings).length > 0) {
    const minLines = Object.entries(ctx.staffingSettings).map(
      ([position, setting]) => `- ${position}: minimum ${setting.min} staff`
    );
    sections.push(`## Minimum Staffing Requirements\n${minLines.join('\n')}`);
  } else {
    sections.push(`## Minimum Staffing Requirements\nNo explicit minimums set — use prior schedule patterns below to infer typical staffing levels.`);
  }

  // Prior schedule patterns (4-week average)
  if (ctx.priorSchedulePatterns.length > 0) {
    const patternLines = ctx.priorSchedulePatterns.map((p) => {
      const dayName = DAY_NAMES[p.day_of_week] ?? `Day ${p.day_of_week}`;
      return `- ${dayName} | ${p.position}: avg ${p.avg_count.toFixed(1)} staff (4-week average)`;
    });
    sections.push(`## Prior Schedule Patterns (4-Week Average)\n${patternLines.join('\n')}`);
  } else {
    sections.push(`## Prior Schedule Patterns\nNo prior schedule data available.`);
  }

  // Hourly sales averages (grouped by day)
  if (ctx.hourlySalesPatterns.length > 0) {
    const byDay: Record<number, HourlySales[]> = {};
    for (const entry of ctx.hourlySalesPatterns) {
      if (!byDay[entry.day_of_week]) byDay[entry.day_of_week] = [];
      byDay[entry.day_of_week].push(entry);
    }
    const salesLines: string[] = [];
    for (const [dayStr, entries] of Object.entries(byDay)) {
      const dayNum = parseInt(dayStr, 10);
      const dayName = DAY_NAMES[dayNum] ?? `Day ${dayNum}`;
      const hourLines = entries
        .sort((a, b) => a.hour - b.hour)
        .map((e) => `    Hour ${String(e.hour).padStart(2, '0')}:00 — avg sales: $${e.avg_sales.toFixed(2)}`);
      salesLines.push(`${dayName}:\n${hourLines.join('\n')}`);
    }
    sections.push(`## Hourly Sales Averages\n${salesLines.join('\n\n')}`);
  } else {
    sections.push(`## Hourly Sales Averages\nNo hourly sales data available.`);
  }

  // Weekly labor budget target
  if (ctx.weeklyBudgetTarget !== null) {
    const budgetDollars = (ctx.weeklyBudgetTarget / 100).toFixed(2);
    sections.push(`## Weekly Labor Budget Target\n$${budgetDollars}`);
  } else {
    sections.push(`## Weekly Labor Budget Target\nNo budget target set.`);
  }

  // Locked shifts
  if (ctx.lockedShifts.length > 0) {
    const lockedLines = ctx.lockedShifts.map(
      (s) =>
        `- [${s.id}] ${s.employee_name} | ${s.day} | ${s.start_time}–${s.end_time} | ${s.position} (LOCKED — do not modify)`
    );
    sections.push(`## Locked Shifts\nThese shifts are fixed and must not be changed:\n${lockedLines.join('\n')}`);
  } else {
    sections.push(`## Locked Shifts\nNone.`);
  }

  sections.push(`## Instructions\nUsing all of the above context, generate an optimal weekly schedule. Return valid JSON matching the provided schema exactly.`);

  return sections.join('\n\n');
}

export interface SchedulePromptResult {
  messages: Array<{ role: string; content: string }>;
  response_format: typeof RESPONSE_FORMAT;
}

export function buildSchedulePrompt(ctx: ScheduleContext): SchedulePromptResult {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(ctx) },
    ],
    response_format: RESPONSE_FORMAT,
  };
}
