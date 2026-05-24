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
  area: string | null;
  hourly_rate: number; // cents
  employment_type: 'full_time' | 'part_time';
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
  /** Manager-stated headcount required per (template, day). The DB
   *  enforces `DEFAULT 1 CHECK (capacity >= 1)`. */
  capacity: number;
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
  /** Per-(template, day-of-week) required headcount. Computed by
   *  staffing-requirements.computeRequiredStaff. Optional for backwards
   *  compatibility with any callers that haven't been updated. */
  requiredStaff?: Map<string, Map<number, number>> | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Padded day labels for the Target Week date map. Each label is
// right-padded to 9 chars ("Wednesday" width) so a single space
// separator after the label still produces an aligned date column —
// the LLM reads the block as a table, not prose.
const DATE_MAP_LABELS = [
  'Monday   ',
  'Tuesday  ',
  'Wednesday',
  'Thursday ',
  'Friday   ',
  'Saturday ',
  'Sunday   ',
];

/**
 * Derive the seven calendar dates for the week from `weekStart`.
 *
 * @param weekStart YYYY-MM-DD; must be a Monday in restaurant-local
 *                  terms. Callers (edge function `generate-schedule`) are
 *                  responsible for that invariant.
 *
 * We parse `weekStart` as UTC midnight, add 86_400_000 ms per day, and
 * read back through UTC accessors — so the output is identical in any
 * process timezone (CI UTC, prod UTC, local dev PT). This is critical: a
 * host-TZ-dependent helper would emit different prompt text per
 * environment, masking Bug H–style drift in local testing while still
 * drifting in prod.
 *
 * Do NOT compose this helper with `schedule-validator.ts::getDayOfWeek`.
 * That helper uses the local-time `new Date(y, m-1, d)` constructor for
 * LLM-emitted day strings; the two have different anchor conventions
 * and operate on different inputs.
 *
 * @returns `rows` — the seven Monday-first labelled rows for the Target
 *          Week section, joined by '\n'.
 *          `byDayOfWeek` — array indexed 0=Sun..6=Sat → 'YYYY-MM-DD',
 *          matching the JS `Date.getDay()` convention used elsewhere
 *          (template.days, validator, availability) so callers can look
 *          up "the date for Monday" via `byDayOfWeek[1]`.
 *
 * @throws if `weekStart` does not parse to a valid Date. Without this
 *         guard, an `Invalid Date` would silently emit seven `NaN-NaN-NaN`
 *         rows into the prompt — the LLM would then either hallucinate
 *         dates or fail structured output, with no signal to the caller.
 */
function buildWeekDates(weekStart: string): { rows: string; byDayOfWeek: string[] } {
  const base = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`buildWeekDates: invalid weekStart "${weekStart}" — expected YYYY-MM-DD`);
  }
  const formatted: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    formatted.push(`${y}-${m}-${day}`);
  }
  // formatted[0..6] is Monday..Sunday. byDayOfWeek remaps to the JS
  // Date.getDay() convention (0=Sun..6=Sat) so callers indexing by
  // template.days / availability day_of_week get the right date.
  const byDayOfWeek = [
    formatted[6], // Sun
    formatted[0], // Mon
    formatted[1], // Tue
    formatted[2], // Wed
    formatted[3], // Thu
    formatted[4], // Fri
    formatted[5], // Sat
  ];
  const rows = DATE_MAP_LABELS.map((label, i) => `  ${label} ${formatted[i]}`).join('\n');
  return { rows, byDayOfWeek };
}

const SYSTEM_PROMPT = `You are a restaurant schedule optimizer. Your job is to create an optimal weekly shift schedule.

All times in this context are in the restaurant local clock (no timezone conversion needed). Position strings are matched case-insensitively and ignore trailing whitespace or trailing -s plurals — so "Line Cook" matches "line cook" and "Servers" matches "Server".

RULES:
1. ONLY use the provided shift templates as shift blocks — do not invent custom time ranges, AND only on the days listed in that template's "active days" field (see the Shift Templates section). A template with active days [Friday, Saturday, Sunday] must not be assigned on a Monday.
2. ONLY assign employees to templates matching their position (per the normalization rule above).
3. When a template has an area set, PREFER assigning employees from the same area. Only assign employees from a different area to that template if no same-area employees are available for that time slot. This is a soft preference — cross-area assignments are allowed as a fallback.
4. ONLY assign employees on days/times they are available. The "Employee Availability" section lists all 7 days for every employee.
5. Do NOT assign the same employee to multiple shifts whose time windows overlap on the same day. This includes back-to-back Open and Close shifts: if an Open shift ends at 16:30 and a Close shift starts at 16:00, the same employee CANNOT work both. Treat overlap as "any minute of one shift falls inside another," even a one-minute overlap.
6. Do NOT modify or reassign any locked shifts — they are fixed.
7. Weight staffing toward peak sales hours — more staff during lunch/dinner rushes.
8. If staffing settings specify minimum crew per position, meet those minimums when possible.
9. If no staffing settings exist, use prior schedule patterns to infer typical staffing levels.
10. Among schedules that meet required headcount (see Rule 12), prefer ones that stay within the weekly labor budget target.
11. Full-time employees should be scheduled for more shifts, targeting 35-40 hours per week. Part-time employees should be scheduled for fewer shifts, targeting 15-25 hours per week. When both full-time and part-time employees are available for a slot, prefer the full-time employee unless they are already near 40 hours for the week.
12. (HARD) Fill every required slot: for every (template, day) listed in "Required Headcount Per Slot", you MUST assign the required number of eligible-and-available employees. A slot may only be left below required headcount if there is NO eligible-and-available employee for it. Coverage is more important than budget — never under-fill to save cost.

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

  // Compute the seven calendar dates once and reuse for the Target Week
  // map and the per-day inline dates in Required Headcount Per Slot —
  // single arithmetic path eliminates drift between the two surfaces.
  const weekDates = buildWeekDates(ctx.weekStart);

  // Target week
  sections.push(
    `## Target Week\nEach day of the week maps to this exact date. Use these dates verbatim in every shift you emit — do not compute dates yourself.\n${weekDates.rows}`,
  );

  // Available employees
  const employeesForPrompt = ctx.employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    area: e.area ?? 'unassigned',
    hourly_rate_dollars: (e.hourly_rate / 100).toFixed(2),
    employment_type: e.employment_type,
  }));
  sections.push(`## Available Employees\n${JSON.stringify(employeesForPrompt, null, 2)}`);

  // Shift templates
  const templatesSection = ctx.templates.map((t) => {
    const dayNames = t.days.map((d) => DAY_NAMES[d]).join(', ');
    const areaStr = t.area ? ` | area: ${t.area}` : '';
    return `- [${t.id}] "${t.name}" | position: ${t.position}${areaStr} | ${t.start_time}–${t.end_time} | active days: ${dayNames}`;
  });
  sections.push(`## Shift Templates\n${templatesSection.join('\n')}`);

  // Employee availability — always render 7 days per employee so the AI has
  // an unambiguous picture. Missing days default to unavailable.
  const availLines: string[] = [];
  for (const employee of ctx.employees) {
    const empId = employee.id;
    const days = ctx.availability[empId] ?? {};
    const dayLines: string[] = [];
    for (let dayNum = 0; dayNum < 7; dayNum++) {
      const dayName = DAY_NAMES[dayNum];
      const avail = days[dayNum];
      if (!avail || !avail.available) {
        dayLines.push(`  ${dayName}: unavailable`);
      } else if (avail.start && avail.end) {
        dayLines.push(`  ${dayName}: available ${avail.start}–${avail.end}`);
      } else {
        dayLines.push(`  ${dayName}: available (all day)`);
      }
    }
    availLines.push(`${employee.name} (${empId}):\n${dayLines.join("\n")}`);
  }
  sections.push(`## Employee Availability\n${availLines.join("\n\n")}`);

  // Minimum staffing requirements
  if (ctx.staffingSettings && Object.keys(ctx.staffingSettings).length > 0) {
    const minLines = Object.entries(ctx.staffingSettings).map(
      ([position, setting]) => `- ${position}: minimum ${setting.min} staff`
    );
    sections.push(`## Minimum Staffing Requirements\n${minLines.join('\n')}`);
  } else {
    sections.push(`## Minimum Staffing Requirements\nNo explicit minimums set — use prior schedule patterns below to infer typical staffing levels.`);
  }

  // Required headcount per (template, day) — drives Rule 12.
  if (ctx.requiredStaff && ctx.requiredStaff.size > 0) {
    const templateById = new Map(ctx.templates.map((t) => [t.id, t]));
    const headcountLines: string[] = [];
    for (const [tplId, perDay] of ctx.requiredStaff) {
      const tpl = templateById.get(tplId);
      if (!tpl) continue;
      const dayParts: string[] = [];
      for (const [day, count] of [...perDay.entries()].sort((a, b) => a[0] - b[0])) {
        const dayName = DAY_NAMES[day];
        const date = weekDates.byDayOfWeek[day];
        // template.days is validated 0..6 upstream. A stray out-of-range
        // entry would otherwise emit "Day 7 undefined: 3" into the prompt
        // — skip rather than poison the LLM context with a literal
        // "undefined".
        if (!dayName || !date) continue;
        dayParts.push(`${dayName} ${date}: ${count}`);
      }
      headcountLines.push(
        `- [${tplId}] "${tpl.name}" | ${tpl.position} | ${dayParts.join(" | ")}`,
      );
    }
    if (headcountLines.length > 0) {
      sections.push(
        `## Required Headcount Per Slot\nEach line lists the minimum staff to assign for that template on each active day.\n${headcountLines.join("\n")}`,
      );
    }
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
