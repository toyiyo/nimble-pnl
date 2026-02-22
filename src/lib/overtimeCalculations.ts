/**
 * Overtime calculation engine.
 *
 * Pure functions -- no database or Supabase dependencies.
 * The payroll hook fetches OvertimeRules from the DB and passes them here.
 */

export interface OvertimeRules {
  weeklyThresholdHours: number;
  weeklyOtMultiplier: number;
  dailyThresholdHours: number | null;
  dailyOtMultiplier: number;
  dailyDoubleThresholdHours: number | null;
  dailyDoubleMultiplier: number;
  excludeTipsFromOtRate: boolean;
}

export interface OvertimeAdjustment {
  employeeId: string;
  punchDate: string; // YYYY-MM-DD
  adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
  hours: number;
  reason: string;
}

export interface OvertimeResult {
  regularHours: number;
  weeklyOvertimeHours: number;
  dailyOvertimeHours: number;
  doubleTimeHours: number;
}

export const DEFAULT_OVERTIME_RULES: OvertimeRules = {
  weeklyThresholdHours: 40,
  weeklyOtMultiplier: 1.5,
  dailyThresholdHours: null,
  dailyOtMultiplier: 1.5,
  dailyDoubleThresholdHours: null,
  dailyDoubleMultiplier: 2.0,
  excludeTipsFromOtRate: true,
};

export function calculateDailyOvertime(
  hoursWorked: number,
  dailyThreshold: number | null,
  doubleTimeThreshold: number | null
): { regularHours: number; dailyOvertimeHours: number; doubleTimeHours: number } {
  if (dailyThreshold === null || hoursWorked <= dailyThreshold) {
    return { regularHours: hoursWorked, dailyOvertimeHours: 0, doubleTimeHours: 0 };
  }

  const regularHours = dailyThreshold;
  const overtimeTotal = hoursWorked - dailyThreshold;

  if (doubleTimeThreshold === null || hoursWorked <= doubleTimeThreshold) {
    return { regularHours, dailyOvertimeHours: overtimeTotal, doubleTimeHours: 0 };
  }

  const dailyOvertimeHours = doubleTimeThreshold - dailyThreshold;
  const doubleTimeHours = hoursWorked - doubleTimeThreshold;

  return { regularHours, dailyOvertimeHours, doubleTimeHours };
}

export function calculateWeeklyOvertime(
  dailyHours: Record<string, number>,
  rules: OvertimeRules
): OvertimeResult {
  let totalRegular = 0;
  let totalDailyOt = 0;
  let totalDoubleTime = 0;

  for (const hours of Object.values(dailyHours)) {
    const daily = calculateDailyOvertime(hours, rules.dailyThresholdHours, rules.dailyDoubleThresholdHours);
    totalRegular += daily.regularHours;
    totalDailyOt += daily.dailyOvertimeHours;
    totalDoubleTime += daily.doubleTimeHours;
  }

  let weeklyOt = 0;
  if (totalRegular > rules.weeklyThresholdHours) {
    weeklyOt = totalRegular - rules.weeklyThresholdHours;
    totalRegular = rules.weeklyThresholdHours;
  }

  return {
    regularHours: Math.round(totalRegular * 100) / 100,
    weeklyOvertimeHours: Math.round(weeklyOt * 100) / 100,
    dailyOvertimeHours: Math.round(totalDailyOt * 100) / 100,
    doubleTimeHours: Math.round(totalDoubleTime * 100) / 100,
  };
}

export function applyOvertimeAdjustments(
  base: OvertimeResult,
  adjustments: OvertimeAdjustment[]
): OvertimeResult {
  if (adjustments.length === 0) return base;

  let { regularHours, weeklyOvertimeHours } = base;

  for (const adj of adjustments) {
    if (adj.adjustmentType === 'regular_to_overtime') {
      const moved = Math.min(adj.hours, regularHours);
      regularHours -= moved;
      weeklyOvertimeHours += moved;
    } else {
      const moved = Math.min(adj.hours, weeklyOvertimeHours);
      weeklyOvertimeHours -= moved;
      regularHours += moved;
    }
  }

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    weeklyOvertimeHours: Math.round(weeklyOvertimeHours * 100) / 100,
    dailyOvertimeHours: base.dailyOvertimeHours,
    doubleTimeHours: base.doubleTimeHours,
  };
}
