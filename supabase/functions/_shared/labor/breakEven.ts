// Pure break-even rules. Shared by the app and the edge functions.
// Keep this file free of React and browser code.
import { startOfMonth, format, getDaysInMonth } from 'date-fns';

export type CostType = 'fixed' | 'semi_variable' | 'variable' | 'custom';
export type EntryType = 'value' | 'percentage';

export interface OperatingCost {
  id: string;
  restaurantId: string;
  costType: CostType;
  category: string;
  name: string;
  entryType: EntryType;
  monthlyValue: number; // in cents
  percentageValue: number; // decimal (0.05 = 5%)
  isAutoCalculated: boolean;
  manualOverride: boolean;
  averagingMonths: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostBreakdownItem {
  id: string;
  name: string;
  category: string;
  daily: number;
  monthly: number;
  percentage?: number;
  isPercentage: boolean;
  source: 'manual' | 'calculated';
}

export interface BreakEvenData {
  // Break-even by period
  dailyBreakEven: number;
  monthlyBreakEven: number;
  yearlyBreakEven: number;

  // Contribution margin
  totalVariablePercent: number;  // sum of all percentage-based costs (0.61 = 61%)
  contributionMargin: number;    // 1 - totalVariablePercent (0.39 = 39%)

  // Today's comparison
  todaySales: number;
  todayStatus: 'above' | 'at' | 'below';
  todayDelta: number;

  // Cost breakdown — 2 groups only
  fixedCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
    totalMonthly: number;
    totalYearly: number;
  };
  variableCosts: {
    items: CostBreakdownItem[];
    totalDaily: number;
    avgDailySales: number;
  };

  // Historical comparison (configurable days)
  history: {
    date: string;
    sales: number;
    breakEven: number;
    delta: number;
    status: 'above' | 'at' | 'below';
    // True for today's row when today is still in progress — the day's
    // sales are a running partial total, not a final figure. Consumers
    // must branch on `isPartial` before `status` when rendering.
    isPartial: boolean;
  }[];

  // Summary stats
  daysAbove: number;
  daysBelow: number;
  avgSurplus: number;
  avgShortfall: number;

  // Sum of `delta` over complete (non-partial) days only.
  netDelta: number;
  // Count of complete (non-partial) days in `history`.
  completeDays: number;

  // Month-to-date progress against the monthly break-even target. Always
  // present once `BreakEvenData` is materialised; `status === 'no_target'`
  // when `monthlyBreakEven` is 0 or non-finite.
  monthlyProgress: MonthlyProgress;
}

// Parse a `yyyy-MM-dd` string as local-zone midnight. Native `new
// Date('yyyy-MM-dd')` reads bare date strings as UTC, which shifts
// `.getDate()`/`.getDay()` back a day for restaurants in negative UTC
// offsets — we want the calendar day (and weekday) the date string
// represents. (date-fns' `parseISO` doesn't have this problem — it already
// reads date-only strings at local midnight — but this module avoids the
// dependency for a one-line parse.)
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}


const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMonthlyCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return USD_FORMATTER.format(amount);
}

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

type BreakEvenStatus = 'above' | 'at' | 'below';

const BREAK_EVEN_TOLERANCE = 0.05;

function classifyDelta(delta: number, breakEven: number): BreakEvenStatus {
  if (!isFinite(breakEven)) return 'below';
  if (breakEven === 0) return delta > 0 ? 'above' : delta < 0 ? 'below' : 'at';
  const threshold = breakEven * BREAK_EVEN_TOLERANCE;
  if (delta > threshold) return 'above';
  if (delta < -threshold) return 'below';
  return 'at';
}

interface DailySalesEntry {
  date: string;
  netRevenue: number;
  transactionCount: number;
}

/**
 * Pure function that computes break-even data from costs and sales.
 *
 * Grouping logic:
 * - entry_type='value' -> fixedCosts (regardless of cost_type)
 * - entry_type='percentage' -> variableCosts (regardless of cost_type)
 *
 * BEP formula:
 * - Total Variable % = sum of all percentage-based costs
 * - Contribution Margin = 1 - Total Variable %
 * - BEP = Total Fixed Costs / Contribution Margin
 */
export function calculateBreakEven(
  costs: OperatingCost[],
  salesData: DailySalesEntry[],
  autoUtilityCosts: number,
  todayStr: string,
  historyDays: number = 14,
): BreakEvenData {
  // `salesData` covers the wider RPC window (rolling history ∪ MTD). For all
  // legacy fields we restrict to the rolling-N-day slice so the chart, COGS%,
  // daysAbove/Below counters stay anchored to the historyDays window.
  const today = parseLocalDate(todayStr);
  const rollingStart = format(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (historyDays - 1)),
    'yyyy-MM-dd',
  );
  const rollingSales = salesData.filter((d) => d.date >= rollingStart && d.date <= todayStr);

  // A date with no sales row counts as 0. The divisor is the window length.
  const avgDailySales =
    rollingSales.length > 0 && historyDays > 0
      ? rollingSales.reduce((sum, d) => sum + d.netRevenue, 0) / historyDays
      : 0;

  const todaySalesEntry = rollingSales.find((d) => d.date === todayStr);
  const todaySales = todaySalesEntry?.netRevenue ?? 0;

  const fixedItems: CostBreakdownItem[] = [];
  const variableItems: CostBreakdownItem[] = [];

  const autoUtilityItems = costs.filter(
    (c) => c.costType === 'semi_variable' && c.isAutoCalculated && !c.manualOverride,
  );
  const autoUtilityCount = autoUtilityItems.length;

  for (const cost of costs) {
    const isPercentage = cost.entryType === 'percentage';

    if (isPercentage) {
      const daily = avgDailySales * cost.percentageValue;
      variableItems.push({
        id: cost.id,
        name: cost.name,
        category: cost.category,
        daily,
        monthly: daily * 30,
        percentage: cost.percentageValue * 100,
        isPercentage: true,
        source: cost.manualOverride || !cost.isAutoCalculated ? 'manual' : 'calculated',
      });
    } else {
      let monthly: number;

      if (
        cost.costType === 'semi_variable' &&
        cost.isAutoCalculated &&
        !cost.manualOverride &&
        autoUtilityCosts > 0 &&
        autoUtilityCount > 0
      ) {
        monthly = autoUtilityCosts / 100 / autoUtilityCount;
      } else {
        monthly = cost.monthlyValue / 100;
      }

      const daily = monthly / 30;

      fixedItems.push({
        id: cost.id,
        name: cost.name,
        category: cost.category,
        daily,
        monthly,
        isPercentage: false,
        source: cost.manualOverride || !cost.isAutoCalculated ? 'manual' : 'calculated',
      });
    }
  }

  const fixedDaily = fixedItems.reduce((sum, i) => sum + i.daily, 0);
  const fixedMonthly = fixedItems.reduce((sum, i) => sum + i.monthly, 0);
  const fixedYearly = fixedMonthly * 12;

  const totalVariablePercent = variableItems.reduce(
    (sum, i) => sum + (i.percentage ?? 0) / 100,
    0,
  );
  const contributionMargin = 1 - totalVariablePercent;

  const monthlyBreakEven =
    contributionMargin > 0 ? fixedMonthly / contributionMargin : Infinity;
  const dailyBreakEven = monthlyBreakEven / 30;
  const yearlyBreakEven = monthlyBreakEven * 12;

  const variableDaily = variableItems.reduce((sum, i) => sum + i.daily, 0);

  const todayDelta = todaySales - dailyBreakEven;
  const todayStatus = classifyDelta(todayDelta, dailyBreakEven);

  const history = rollingSales.map((d) => {
    const delta = d.netRevenue - dailyBreakEven;
    return {
      date: d.date,
      sales: d.netRevenue,
      breakEven: dailyBreakEven,
      delta,
      status: classifyDelta(delta, dailyBreakEven),
      isPartial: d.date === todayStr,
    };
  });

  // Aggregates (daysAbove/daysBelow/avgSurplus/avgShortfall/netDelta) are
  // derived from complete days only — today's row is still in progress and
  // would otherwise be graded against a full day's break-even target.
  const completeHistory = history.filter((h) => !h.isPartial);

  const aboveDays = completeHistory.filter((h) => h.status === 'above');
  const belowDays = completeHistory.filter((h) => h.status === 'below');

  // Month-to-date sales: slice of the (wider) salesData where the date falls
  // within the current calendar month (relative to `todayStr`). We use a
  // string-prefix comparison rather than full Date parsing so a row dated
  // "2026-05-01" is included whether or not its local-TZ midnight rounds back
  // a day.
  const mtdPrefix = format(startOfMonth(today), 'yyyy-MM');
  const mtdSales = salesData
    .filter((d) => d.date.startsWith(mtdPrefix))
    .reduce((sum, d) => sum + d.netRevenue, 0);

  const monthlyProgress = calculateMonthlyProgress({
    monthlyBreakEven,
    mtdSales,
    today,
  });

  return {
    dailyBreakEven,
    monthlyBreakEven,
    yearlyBreakEven,
    totalVariablePercent,
    contributionMargin,
    todaySales,
    todayStatus,
    todayDelta,
    fixedCosts: {
      items: fixedItems,
      totalDaily: fixedDaily,
      totalMonthly: fixedMonthly,
      totalYearly: fixedYearly,
    },
    variableCosts: {
      items: variableItems,
      totalDaily: variableDaily,
      avgDailySales: avgDailySales,
    },
    history,
    daysAbove: aboveDays.length,
    daysBelow: belowDays.length,
    avgSurplus:
      aboveDays.length > 0
        ? aboveDays.reduce((sum, h) => sum + h.delta, 0) / aboveDays.length
        : 0,
    avgShortfall:
      belowDays.length > 0
        ? belowDays.reduce((sum, h) => sum + h.delta, 0) / belowDays.length
        : 0,
    netDelta: completeHistory.reduce((sum, h) => sum + h.delta, 0),
    completeDays: completeHistory.length,
    monthlyProgress,
  };
}
