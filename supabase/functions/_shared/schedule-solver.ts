/**
 * schedule-solver.ts
 *
 * Pure-TS code-first scheduler. Replaces the LLM-only path. Reuses validator
 * primitives so predicate semantics are single-sourced.
 *
 * See docs/superpowers/specs/2026-05-24-scheduler-code-first-solver-design.md
 */

import {
  type GeneratedShift,
  getDayOfWeekUTC,
  longestConsecutiveRun,
  normalizePosition,
  shiftHours,
  shiftsConflict,
  timeToMinutes,
  withinWindow,
} from './schedule-validator.ts';

// ─── Solver-specific Domain Types ────────────────────────────────────────────

export interface SolverEmployee {
  id: string;
  name: string;
  position: string;
  area: string | null;
  max_weekly_hours: number;
  date_of_birth: string;
  is_minor: boolean;
}

export interface SolverTemplate {
  id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
}

export interface SolverAvailabilityDay {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

export interface SolverLockedShift {
  employee_id: string;
  template_id: string;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

export interface SolverPriorPattern {
  day_of_week: number;
  position: string;
  avg_count: number;
}

export interface SolverHourlySales {
  day_of_week: number;
  hour: number;
  avg_sales: number;
}

export interface SolverWeeklySales {
  week_start: string;
  total_sales: number;
}

/** Solver-specific schedule context. Separate from the prompt-builder's
 *  ScheduleContext to avoid coupling the solver's domain model to the LLM
 *  prompt shape. */
export interface ScheduleContext {
  restaurantId: string;
  weekStart: string;
  employees: SolverEmployee[];
  templates: SolverTemplate[];
  /** Keyed by employee_id; inner record keyed by day-of-week (0=Sun..6=Sat). */
  availability: Record<string, Record<number, SolverAvailabilityDay>>;
  /** Keyed by `${templateId}:${day}`. */
  requiredStaff: Map<string, { template_id: string; day: string; count: number }>;
  lockedShifts: SolverLockedShift[];
  excludedEmployeeIds: Set<string>;
  priorPatterns: SolverPriorPattern[];
  weeklySalesHistory: SolverWeeklySales[];
  hourlySalesHistory: SolverHourlySales[];
  /** 0.30 = 30% target labor cost */
  targetLaborPercentage: number;
  minimumWageCents: number;
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface UnfilledSlot {
  template_id: string;
  day: string;
  position: string;
  area: string | null;
  reason:
    | 'NO_ELIGIBLE_EMPLOYEE'
    | 'ALL_AT_HOUR_CAP'
    | 'ALL_AT_CONSEC_DAY_CAP'
    | 'ALL_UNAVAILABLE'
    | 'ALL_CONFLICTING';
}

export interface FairnessSummary {
  employee_id: string;
  hours_assigned: number;
  days_worked: number;
  hours_budget: number;
}

export interface SolverResult {
  shifts: GeneratedShift[];
  unfilled: UnfilledSlot[];
  fairness: FairnessSummary[];
}

// ─── Stage A: Slot Enumeration ────────────────────────────────────────────────

interface Slot {
  template_id: string;
  day: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
}

function enumerateSlots(ctx: ScheduleContext): Slot[] {
  const slots: Slot[] = [];
  const templatesById = new Map(ctx.templates.map((t) => [t.id, t]));
  for (const req of ctx.requiredStaff.values()) {
    const template = templatesById.get(req.template_id);
    if (!template) continue;
    const dayOfWeek = getDayOfWeekUTC(req.day);
    if (!template.days_of_week.includes(dayOfWeek)) continue;
    for (let i = 0; i < req.count; i++) {
      slots.push({
        template_id: template.id,
        day: req.day,
        day_of_week: dayOfWeek,
        start_time: template.start_time,
        end_time: template.end_time,
        position: template.position,
        area: template.area ?? null,
      });
    }
  }
  return slots;
}

// ─── Stage C/D: Eligibility Predicate ────────────────────────────────────────

function eligibleBase(
  slot: Slot,
  ctx: ScheduleContext,
): string[] {
  const out: string[] = [];
  const shiftStart = timeToMinutes(slot.start_time);
  const shiftEnd = timeToMinutes(slot.end_time);
  for (const emp of ctx.employees) {
    if (ctx.excludedEmployeeIds.has(emp.id)) continue;
    if (normalizePosition(emp.position) !== normalizePosition(slot.position)) continue;
    if (slot.area !== null && emp.area !== null && emp.area !== slot.area) continue;
    const avail = ctx.availability[emp.id]?.[slot.day_of_week];
    if (!avail || !avail.isAvailable) continue;
    if (!avail.startTime || !avail.endTime) continue;
    const windowStart = timeToMinutes(avail.startTime);
    const windowEnd = timeToMinutes(avail.endTime);
    if (!withinWindow(shiftStart, shiftEnd, windowStart, windowEnd)) continue;
    out.push(emp.id);
  }
  return out;
}

function toUnfilled(slot: Slot): Omit<UnfilledSlot, 'reason'> {
  return {
    template_id: slot.template_id,
    day: slot.day,
    position: slot.position,
    area: slot.area,
  };
}

// ─── Solver Entry Point ───────────────────────────────────────────────────────

export function solveSchedule(ctx: ScheduleContext): SolverResult {
  const hoursByEmp = new Map<string, number>();
  const daysByEmp = new Map<string, Set<string>>();
  const shiftsByEmp = new Map<string, GeneratedShift[]>();

  for (const emp of ctx.employees) {
    hoursByEmp.set(emp.id, 0);
    daysByEmp.set(emp.id, new Set());
    shiftsByEmp.set(emp.id, []);
  }

  for (const locked of ctx.lockedShifts) {
    if (!hoursByEmp.has(locked.employee_id)) continue;
    const lockedAsShift: GeneratedShift = {
      employee_id: locked.employee_id,
      template_id: locked.template_id,
      day: locked.day,
      start_time: locked.start_time,
      end_time: locked.end_time,
      position: locked.position,
    };
    const hours = shiftHours(lockedAsShift);
    hoursByEmp.set(locked.employee_id, (hoursByEmp.get(locked.employee_id) ?? 0) + hours);
    daysByEmp.get(locked.employee_id)?.add(locked.day);
    shiftsByEmp.get(locked.employee_id)?.push(lockedAsShift);
  }

  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const slots = enumerateSlots(ctx);

  // Stage C: most-constrained-first. Tie-break: weekend before weekday, earlier
  // start_time, stable original order.
  const baseBySlotIdx: string[][] = slots.map((s) => eligibleBase(s, ctx));
  const order = slots.map((_, i) => i);
  order.sort((aIdx, bIdx) => {
    const a = baseBySlotIdx[aIdx].length;
    const b = baseBySlotIdx[bIdx].length;
    if (a !== b) return a - b;
    const aWk = slots[aIdx].day_of_week === 0 || slots[aIdx].day_of_week === 6 ? 0 : 1;
    const bWk = slots[bIdx].day_of_week === 0 || slots[bIdx].day_of_week === 6 ? 0 : 1;
    if (aWk !== bWk) return aWk - bWk;
    const aMin = timeToMinutes(slots[aIdx].start_time);
    const bMin = timeToMinutes(slots[bIdx].start_time);
    if (aMin !== bMin) return aMin - bMin;
    return aIdx - bIdx;
  });

  const assigned: GeneratedShift[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const slotIdx of order) {
    const slot = slots[slotIdx];
    const base = baseBySlotIdx[slotIdx];
    if (base.length === 0) {
      unfilled.push({ ...toUnfilled(slot), reason: 'NO_ELIGIBLE_EMPLOYEE' });
      continue;
    }

    const slotShift: GeneratedShift = {
      employee_id: '__probe__',
      template_id: slot.template_id,
      day: slot.day,
      start_time: slot.start_time,
      end_time: slot.end_time,
      position: slot.position,
    };
    const slotHours = shiftHours(slotShift);

    // Narrow with reason tracking
    let droppedReason: UnfilledSlot['reason'] = 'NO_ELIGIBLE_EMPLOYEE';
    const afterHourCap: string[] = [];
    for (const empId of base) {
      const empMax = empById.get(empId)?.max_weekly_hours ?? 40;
      if ((hoursByEmp.get(empId) ?? 0) + slotHours <= empMax) afterHourCap.push(empId);
    }
    if (afterHourCap.length === 0) { droppedReason = 'ALL_AT_HOUR_CAP'; }

    const afterConsec: string[] = [];
    for (const empId of afterHourCap) {
      const days = new Set(daysByEmp.get(empId) ?? []);
      days.add(slot.day);
      if (longestConsecutiveRun(days) <= 5) afterConsec.push(empId);
    }
    if (afterConsec.length === 0 && afterHourCap.length > 0) droppedReason = 'ALL_AT_CONSEC_DAY_CAP';

    const afterConflict: string[] = [];
    for (const empId of afterConsec) {
      const existing = shiftsByEmp.get(empId) ?? [];
      const probe = { ...slotShift, employee_id: empId };
      if (!existing.some((ex) => shiftsConflict(probe, ex))) afterConflict.push(empId);
    }
    if (afterConflict.length === 0 && afterConsec.length > 0) droppedReason = 'ALL_CONFLICTING';

    if (afterConflict.length === 0) {
      unfilled.push({ ...toUnfilled(slot), reason: droppedReason });
      continue;
    }

    // Fairness pick: lowest hours_assigned, tie by fewest days, tie by stable id
    const picked = afterConflict.reduce((best, cur) => {
      const bestH = hoursByEmp.get(best) ?? 0;
      const curH = hoursByEmp.get(cur) ?? 0;
      if (curH < bestH) return cur;
      if (curH > bestH) return best;
      const bestD = daysByEmp.get(best)?.size ?? 0;
      const curD = daysByEmp.get(cur)?.size ?? 0;
      if (curD < bestD) return cur;
      if (curD > bestD) return best;
      return best < cur ? best : cur;
    });

    const newShift: GeneratedShift = { ...slotShift, employee_id: picked };
    assigned.push(newShift);
    hoursByEmp.set(picked, (hoursByEmp.get(picked) ?? 0) + slotHours);
    daysByEmp.get(picked)?.add(slot.day);
    shiftsByEmp.get(picked)?.push(newShift);
  }

  const fairness: FairnessSummary[] = ctx.employees.map((emp) => ({
    employee_id: emp.id,
    hours_assigned: hoursByEmp.get(emp.id) ?? 0,
    days_worked: daysByEmp.get(emp.id)?.size ?? 0,
    hours_budget: emp.max_weekly_hours,
  }));

  return { shifts: assigned, unfilled, fairness };
}
