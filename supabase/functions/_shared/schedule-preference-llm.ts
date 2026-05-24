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
  maxRetries: number;
}

export const PREFERENCE_MODELS: PreferenceModelConfig[] = [
  { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000, maxRetries: 1 },
  { id: 'google/gemini-2.5-flash-lite', perCallTimeoutMs: 25_000, maxRetries: 1 },
];

export async function applyPreferences(
  schedule: GeneratedShift[],
  _ctx: ScheduleContext,
  preferencesText: string,
  _models: PreferenceModelConfig[],
): Promise<PreferenceResult> {
  if (!preferencesText.trim()) {
    return {
      shifts: schedule,
      appliedSwaps: [],
      rejectedSwaps: [],
      modelUsed: null,
    };
  }
  throw new Error(
    'applyPreferences: LLM swap pass not yet wired (Task 13). ' +
      'Pass empty preferencesText to bypass.',
  );
}

export interface ProposedSwap {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

interface IdentifiedShift extends GeneratedShift {
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
