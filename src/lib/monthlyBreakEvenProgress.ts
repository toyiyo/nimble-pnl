import { format, getDaysInMonth } from 'date-fns';

export type MonthlyProgressStatus = 'ahead' | 'on_pace' | 'behind' | 'no_target';

export interface MonthlyProgress {
  monthLabel: string;
  daysInMonth: number;
  dayOfMonth: number;
  mtdSales: number;
  monthlyBreakEven: number;
  progressPercent: number;
  expectedPercent: number;
  paceDelta: number;
  status: MonthlyProgressStatus;
  amountRemaining: number;
  daysRemaining: number;
  dailyNeeded: number;
  dailyActual: number;
  projectedMonthly: number;
  projectedDelta: number;
}

export interface MonthlyProgressInputs {
  monthlyBreakEven: number;
  mtdSales: number;
  today: Date;
}

const PACE_TOLERANCE_PERCENT_POINTS = 5;

function hasTarget(monthlyBreakEven: number): boolean {
  return Number.isFinite(monthlyBreakEven) && monthlyBreakEven > 0;
}

export function calculateMonthlyProgress({
  monthlyBreakEven,
  mtdSales,
  today,
}: MonthlyProgressInputs): MonthlyProgress {
  const daysInMonth = getDaysInMonth(today);
  const dayOfMonth = today.getDate();
  const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);
  const monthLabel = format(today, 'MMMM yyyy');

  const dailyActual = dayOfMonth > 0 ? mtdSales / dayOfMonth : 0;
  const projectedMonthly = dailyActual * daysInMonth;

  if (!hasTarget(monthlyBreakEven)) {
    return {
      monthLabel,
      daysInMonth,
      dayOfMonth,
      mtdSales,
      monthlyBreakEven: Number.isFinite(monthlyBreakEven) ? monthlyBreakEven : 0,
      progressPercent: 0,
      expectedPercent: 0,
      paceDelta: 0,
      status: 'no_target',
      amountRemaining: 0,
      daysRemaining,
      dailyNeeded: 0,
      dailyActual,
      projectedMonthly,
      projectedDelta: 0,
    };
  }

  const progressPercent = (mtdSales / monthlyBreakEven) * 100;
  const expectedPercent = (dayOfMonth / daysInMonth) * 100;
  const paceDelta = progressPercent - expectedPercent;

  const amountRemaining = Math.max(0, monthlyBreakEven - mtdSales);
  const dailyNeeded = amountRemaining > 0 ? amountRemaining / daysRemaining : 0;
  const projectedDelta = projectedMonthly - monthlyBreakEven;

  let status: MonthlyProgressStatus;
  if (paceDelta > PACE_TOLERANCE_PERCENT_POINTS) {
    status = 'ahead';
  } else if (paceDelta < -PACE_TOLERANCE_PERCENT_POINTS) {
    status = 'behind';
  } else {
    status = 'on_pace';
  }

  return {
    monthLabel,
    daysInMonth,
    dayOfMonth,
    mtdSales,
    monthlyBreakEven,
    progressPercent,
    expectedPercent,
    paceDelta,
    status,
    amountRemaining,
    daysRemaining,
    dailyNeeded,
    dailyActual,
    projectedMonthly,
    projectedDelta,
  };
}
