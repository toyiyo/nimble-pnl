/**
 * schedule-preference-llm.ts
 *
 * Optional second-pass swap proposer driven by free-text manager prefs.
 * Only invoked when preferencesText is non-empty. Each proposed swap is
 * server-re-validated; illegal swaps are silently dropped.
 */

import type { GeneratedShift } from './schedule-validator.ts';
import {
  getDayOfWeekUTC,
  longestConsecutiveRun,
  normalizePosition,
  shiftHours,
  shiftsConflict,
  timeToMinutes,
  withinWindow,
} from './schedule-validator.ts';
import type { ScheduleContext } from './schedule-solver.ts';

export interface SwapRecord {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

export type SwapRejectionReason =
  | 'UNKNOWN_EMPLOYEE'
  | 'POSITION_MISMATCH'
  | 'AREA_MISMATCH'
  | 'UNAVAILABLE_DAY'
  | 'OUTSIDE_WINDOW'
  | 'DOUBLE_BOOKING'
  | 'HOURS_EXCEED_WEEKLY_CAP'
  | 'CONSECUTIVE_DAYS_EXCEEDED';

export type SwapRejectionCode = 'UNKNOWN_SHIFT' | `WOULD_VIOLATE_${SwapRejectionReason}`;

export interface RejectedSwap extends SwapRecord {
  rejection_code: SwapRejectionCode;
}

export interface ProposedSwap {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

export interface IdentifiedShift extends GeneratedShift {
  id: string;
}

export interface ApplySwapsResult {
  shifts: IdentifiedShift[];
  appliedSwaps: SwapRecord[];
  rejectedSwaps: RejectedSwap[];
}

export interface PreferenceResult {
  shifts: GeneratedShift[];
  appliedSwaps: SwapRecord[];
  rejectedSwaps: RejectedSwap[];
  modelUsed: string | null;
}

export interface PreferenceModelConfig {
  id: string;
  perCallTimeoutMs: number;
}

export const PREFERENCE_MODELS: PreferenceModelConfig[] = [
  { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000 },
  { id: 'google/gemini-2.5-flash-lite', perCallTimeoutMs: 25_000 },
];

export async function applyPreferences(
  schedule: IdentifiedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  models: PreferenceModelConfig[],
): Promise<PreferenceResult> {
  if (!preferencesText.trim()) {
    return { shifts: schedule, appliedSwaps: [], rejectedSwaps: [], modelUsed: null };
  }

  let working = schedule;
  let allApplied: SwapRecord[] = [];
  let allRejected: RejectedSwap[] = [];
  let modelUsed: string | null = null;

  for (let round = 0; round < 2; round++) {
    const { swaps, model } = await proposeSwaps(working, ctx, preferencesText, models);
    if (model && !modelUsed) modelUsed = model;
    if (swaps.length === 0) break;
    const applied = applySwapsToSchedule(working, ctx, swaps);
    working = applied.shifts;
    allApplied = allApplied.concat(applied.appliedSwaps);
    allRejected = allRejected.concat(applied.rejectedSwaps);
    if (applied.appliedSwaps.length === 0) break;
    // If every proposed swap was applied, treat the preference as satisfied.
    // Re-prompting would risk the LLM re-proposing identical swaps that would
    // either undo round 1's work or double-apply.
    if (applied.appliedSwaps.length === swaps.length) break;
  }

  return { shifts: working, appliedSwaps: allApplied, rejectedSwaps: allRejected, modelUsed };
}

// Reads an env var from Deno (prod) or Node/Vitest (tests) without throwing.
function getEnvVar(key: string): string | undefined {
  return (globalThis as Record<string, unknown> & { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key)
    ?? (typeof process !== 'undefined' ? process.env[key] : undefined);
}

const PREFERENCE_SYSTEM_PROMPT = `You receive a confirmed schedule and a manager preference statement in free text. Propose up to 5 pair-swaps that move toward the preference. Each swap exchanges the employee on shift A with the employee on shift B. Output JSON: {"swaps":[{"shift_a_id":"...","shift_b_id":"...","reason":"..."}]}. Do not invent new shifts. Do not change start/end times. The server re-validates every swap and silently rejects illegal ones. If the preference is satisfied or no safe swap exists, return {"swaps":[]}.`;

async function proposeSwaps(
  schedule: IdentifiedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  models: PreferenceModelConfig[],
): Promise<{ swaps: ProposedSwap[]; model: string | null }> {
  const apiKey = getEnvVar('OPENROUTER_API_KEY');
  if (!apiKey) return { swaps: [], model: null };

  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const scheduleTable = schedule.map((s) =>
    `${s.id} | ${s.day} | ${s.start_time}-${s.end_time} | ${s.position} | ${empById.get(s.employee_id)?.name ?? s.employee_id}`,
  ).join('\n');

  const messages = [
    { role: 'system', content: PREFERENCE_SYSTEM_PROMPT },
    { role: 'user', content: `SCHEDULE:\n${scheduleTable}\n\nPREFERENCES:\n${preferencesText}` },
  ];

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), model.perCallTimeoutMs);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') continue;
      try {
        const parsed = JSON.parse(content);
        const swaps = Array.isArray(parsed?.swaps) ? parsed.swaps : [];
        return { swaps, model: model.id };
      } catch {
        continue;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { swaps: [], model: null };
}

export function applySwapsToSchedule(
  shifts: IdentifiedShift[],
  ctx: ScheduleContext,
  swaps: ProposedSwap[],
): ApplySwapsResult {
  const byId = new Map(shifts.map((s) => [s.id, { ...s }]));
  const applied: SwapRecord[] = [];
  const rejected: RejectedSwap[] = [];

  // Indexes for O(1) lookup in the swap re-validation loop. Without these,
  // validateAffectedEmployees scans ctx.employees and Array.from(byId.values())
  // for every affected employee on every swap — quadratic in (swaps × shifts).
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const templatesById = new Map(ctx.templates.map((t) => [t.id, t]));
  const shiftsByEmp = new Map<string, IdentifiedShift[]>();
  for (const s of byId.values()) {
    const list = shiftsByEmp.get(s.employee_id);
    if (list) list.push(s);
    else shiftsByEmp.set(s.employee_id, [s]);
  }
  const reassignShift = (shift: IdentifiedShift, fromEmp: string, toEmp: string) => {
    shift.employee_id = toEmp;
    const fromList = shiftsByEmp.get(fromEmp);
    if (fromList) {
      const idx = fromList.indexOf(shift);
      if (idx >= 0) fromList.splice(idx, 1);
    }
    const toList = shiftsByEmp.get(toEmp);
    if (toList) toList.push(shift);
    else shiftsByEmp.set(toEmp, [shift]);
  };

  for (const swap of swaps) {
    const a = byId.get(swap.shift_a_id);
    const b = byId.get(swap.shift_b_id);
    if (!a || !b) {
      rejected.push({ ...swap, rejection_code: 'UNKNOWN_SHIFT' });
      continue;
    }
    const aEmp = a.employee_id;
    const bEmp = b.employee_id;
    reassignShift(a, aEmp, bEmp);
    reassignShift(b, bEmp, aEmp);

    const reason = validateAffectedEmployees(byId, ctx, [aEmp, bEmp], empById, shiftsByEmp, templatesById);
    if (reason) {
      reassignShift(a, bEmp, aEmp);
      reassignShift(b, aEmp, bEmp);
      rejected.push({ ...swap, rejection_code: `WOULD_VIOLATE_${reason}` });
      continue;
    }
    applied.push(swap);
  }

  return {
    shifts: Array.from(byId.values()),
    appliedSwaps: applied,
    rejectedSwaps: rejected,
  };
}

function validateAffectedEmployees(
  byId: Map<string, IdentifiedShift>,
  ctx: ScheduleContext,
  empIds: string[],
  empById: Map<string, ScheduleContext['employees'][number]>,
  shiftsByEmp: Map<string, IdentifiedShift[]>,
  templatesById: Map<string, ScheduleContext['templates'][number]>,
): SwapRejectionReason | null {
  for (const empId of empIds) {
    const emp = empById.get(empId);
    if (!emp) return 'UNKNOWN_EMPLOYEE';
    const empShifts = shiftsByEmp.get(empId) ?? [];

    let totalHours = 0;
    const days = new Set<string>();
    for (let i = 0; i < empShifts.length; i++) {
      const s = empShifts[i];
      if (normalizePosition(s.position) !== normalizePosition(emp.position)) return 'POSITION_MISMATCH';
      // Mirror solver's null-permissive area rule (schedule-solver.ts:172).
      // Without this gate, the LLM can swap an employee from their assigned
      // area into a template bound to a different area and the swap passes.
      const template = templatesById.get(s.template_id);
      if (template && template.area !== null && emp.area !== null && template.area !== emp.area) {
        return 'AREA_MISMATCH';
      }
      const dow = getDayOfWeekUTC(s.day);
      const avail = ctx.availability[empId]?.[dow];
      if (!avail?.isAvailable || !avail.startTime || !avail.endTime) return 'UNAVAILABLE_DAY';
      const shiftStart = timeToMinutes(s.start_time);
      const shiftEnd = timeToMinutes(s.end_time);
      const windowStart = timeToMinutes(avail.startTime);
      const windowEnd = timeToMinutes(avail.endTime);
      if (!withinWindow(shiftStart, shiftEnd, windowStart, windowEnd)) return 'OUTSIDE_WINDOW';
      if (empShifts.slice(i + 1).some((other) => shiftsConflict(s, other))) return 'DOUBLE_BOOKING';
      totalHours += shiftHours(s);
      days.add(s.day);
    }
    if (totalHours > emp.max_weekly_hours) return 'HOURS_EXCEED_WEEKLY_CAP';
    if (longestConsecutiveRun(days) > 5) return 'CONSECUTIVE_DAYS_EXCEEDED';
  }
  return null;
}
