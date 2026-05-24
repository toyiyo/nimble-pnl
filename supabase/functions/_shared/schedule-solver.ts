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
  days: number[];
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
  capacity: number;
}

export interface SolverAvailabilityDay {
  available: boolean;
  start?: string;
  end?: string;
}

export interface SolverLockedShift {
  id: string;
  employee_name: string;
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
  /** Per-(template_id, day-of-week) required headcount. */
  requiredStaff: Map<string, Map<number, number>>;
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

  const fairness: FairnessSummary[] = ctx.employees.map((emp) => ({
    employee_id: emp.id,
    hours_assigned: 0,
    days_worked: 0,
    hours_budget: emp.max_weekly_hours,
  }));

  return { shifts: [], unfilled: [], fairness };
}
