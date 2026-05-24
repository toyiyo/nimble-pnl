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

export interface RejectedSwap extends SwapRecord {
  rejection_code: string;
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
    working = applied.shifts as IdentifiedShift[];
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

const PREFERENCE_SYSTEM_PROMPT = `You receive a confirmed schedule and a manager preference statement in free text. Propose up to 5 pair-swaps that move toward the preference. Each swap exchanges the employee on shift A with the employee on shift B. Output JSON: {"swaps":[{"shift_a_id":"...","shift_b_id":"...","reason":"..."}]}. Do not invent new shifts. Do not change start/end times. The server re-validates every swap and silently rejects illegal ones. If the preference is satisfied or no safe swap exists, return {"swaps":[]}.`;

async function proposeSwaps(
  schedule: IdentifiedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  models: PreferenceModelConfig[],
): Promise<{ swaps: ProposedSwap[]; model: string | null }> {
  // Dual-runtime env access: Deno (prod) and Node/Vitest (tests). The `typeof
  // process` guard prevents ReferenceError in Deno when the secret is missing.
  const apiKey = (globalThis as Record<string, unknown> & { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('OPENROUTER_API_KEY')
    ?? (typeof process !== 'undefined' ? process.env.OPENROUTER_API_KEY : undefined);
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

export interface ProposedSwap {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

export interface IdentifiedShift extends GeneratedShift {
  id: string;
}

export function applySwapsToSchedule(
  shifts: IdentifiedShift[],
  ctx: ScheduleContext,
  swaps: ProposedSwap[],
): Omit<PreferenceResult, 'modelUsed'> {
  const byId = new Map(shifts.map((s) => [s.id, { ...s }]));
  const applied: SwapRecord[] = [];
  const rejected: RejectedSwap[] = [];

  for (const swap of swaps) {
    const a = byId.get(swap.shift_a_id);
    const b = byId.get(swap.shift_b_id);
    if (!a || !b) {
      rejected.push({ ...swap, rejection_code: 'UNKNOWN_SHIFT' });
      continue;
    }
    const aEmp = a.employee_id;
    const bEmp = b.employee_id;
    a.employee_id = bEmp;
    b.employee_id = aEmp;

    const reason = validateAffectedEmployees(byId, ctx, [aEmp, bEmp]);
    if (reason) {
      a.employee_id = aEmp;
      b.employee_id = bEmp;
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
): string | null {
  for (const empId of empIds) {
    const emp = ctx.employees.find((e) => e.id === empId);
    if (!emp) return 'UNKNOWN_EMPLOYEE';
    const empShifts = Array.from(byId.values()).filter((s) => s.employee_id === empId);

    let totalHours = 0;
    const days = new Set<string>();
    for (let i = 0; i < empShifts.length; i++) {
      const s = empShifts[i];
      if (normalizePosition(s.position) !== normalizePosition(emp.position)) return 'POSITION_MISMATCH';
      const dow = getDayOfWeekUTC(s.day);
      const avail = ctx.availability[empId]?.[dow];
      if (!avail?.isAvailable || !avail.startTime || !avail.endTime) return 'UNAVAILABLE_DAY';
      const shiftStart = timeToMinutes(s.start_time);
      const shiftEnd = timeToMinutes(s.end_time);
      const windowStart = timeToMinutes(avail.startTime);
      const windowEnd = timeToMinutes(avail.endTime);
      if (!withinWindow(shiftStart, shiftEnd, windowStart, windowEnd)) return 'OUTSIDE_WINDOW';
      for (let j = i + 1; j < empShifts.length; j++) {
        if (shiftsConflict(s, empShifts[j])) return 'DOUBLE_BOOKING';
      }
      totalHours += shiftHours(s);
      days.add(s.day);
    }
    if (totalHours > emp.max_weekly_hours) return 'HOURS_EXCEED_WEEKLY_CAP';
    if (longestConsecutiveRun(days) > 5) return 'CONSECUTIVE_DAYS_EXCEEDED';
  }
  return null;
}
