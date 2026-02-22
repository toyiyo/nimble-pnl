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
