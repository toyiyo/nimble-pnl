// Labor section of the get_scheduling_context connector tool.
// Each item loads only when its gate passes. A failed load becomes
// { unavailable: true, reason } and the other items still load.
import { differenceInDays, format, subMonths } from "date-fns";
import { loadScheduledLaborCost } from "./labor/scheduledLaborCost.ts";
import { fetchLaborEmployees } from "./labor/loaderQuery.ts";
import {
  calculateBreakEven,
  parseLocalDate,
  type BreakEvenData,
  type OperatingCost,
} from "./labor/breakEven.ts";
import { calculateLaborBudget } from "./labor/laborBudget.ts";
import {
  computeDailyLaborPercent,
  MAX_SHOWN_LABOR_PERCENT,
  projectDailySales,
} from "./labor/dailyLaborPercent.ts";
import {
  checkLaborGuardrail,
  computeAvgHourlyRateCents,
  DEFAULT_HOURLY_RATE_CENTS,
  hasHourlyWageData,
} from "./labor/staffingGuardrail.ts";
import { addDaysToDateStr } from "./labor/restaurantClock.ts";
import { recommendForSlots } from "./hourlyStaffing.ts";
import type { Hidden } from "./schedulingContext.ts";

export interface LaborGates {
  payRates: boolean;
  posSales: boolean;
}

export interface StaffingSettings {
  target_splh: number;
  min_staff: number;
  min_crew: Record<string, number> | null;
  lookback_weeks: number;
  target_labor_pct: number;
}

export interface LaborPeriod {
  start: string;
  end: string;
  today: string;
  tz: string;
}

export interface Unavailable {
  unavailable: true;
  reason: string;
}

type Item<T> = T | Hidden | Unavailable;

export interface LaborSection {
  scheduled_labor: Item<{
    total: number;
    hidden_cost_count: number;
    is_average_high: boolean;
    capped: boolean;
  }>;
  daily_labor_percent: Item<{
    target_labor_pct: number;
    days: {
      date: string;
      labor_cost: number;
      projected_sales: number;
      percent: number | null;
      over_target: boolean;
    }[];
  }>;
  labor_budget: Item<{
    has_budget: boolean;
    weekly_target: number;
    percentage: number;
    variance: number;
    tier: "ok" | "warning" | "over";
    source: string | null;
    cost_basis: string;
  }>;
  staffing_suggestions: Item<{
    hours: { date: string; hour: number; recommended_staff: number }[];
    labor: Item<{
      avg_hourly_rate: number;
      has_wage_data: boolean;
      rate_note?: string;
      days: {
        date: string;
        estimated_cost: number;
        labor_pct: number | null;
        over_target: boolean;
      }[];
    }>;
  }>;
}

const hidden = (reason: string): Hidden => ({ hidden: true, reason });
const NEEDS_PAY: Hidden = hidden("needs view:pay_rates");
const NEEDS_SALES: Hidden = hidden("needs view:pos_sales");
const NO_SETTINGS: Unavailable = { unavailable: true, reason: "no staffing settings" };

function unavailable(err: unknown): Unavailable {
  const reason = err instanceof Error ? err.message : (err as { message?: string })?.message;
  return { unavailable: true, reason: reason ?? "load failed" };
}

/** Run a load. A thrown error becomes an unavailable item. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await fn();
  } catch (err) {
    return unavailable(err);
  }
}

const isUnavailable = (v: unknown): v is Unavailable =>
  typeof v === "object" && v !== null && (v as Unavailable).unavailable === true;

function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDaysToDateStr(d, 1)) days.push(d);
  return days;
}

function dowOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

async function rpcData(supabase: RpcClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapCost(row: any): OperatingCost {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    costType: row.cost_type,
    category: row.category,
    name: row.name,
    entryType: row.entry_type,
    monthlyValue: row.monthly_value || 0,
    percentageValue: Number(row.percentage_value) || 0,
    isAutoCalculated: row.is_auto_calculated || false,
    manualOverride: row.manual_override || false,
    averagingMonths: row.averaging_months || 3,
    displayOrder: row.display_order || 0,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COST_COLUMNS =
  "id, restaurant_id, cost_type, category, name, entry_type, monthly_value, percentage_value, is_auto_calculated, manual_override, averaging_months, display_order, is_active, created_at, updated_at";

async function loadOperatingCosts(supabase: any, restaurantId: string): Promise<OperatingCost[]> {
  const { data, error } = await supabase
    .from("restaurant_operating_costs")
    .select(COST_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .order("cost_type")
    .order("display_order");
  if (error) throw error;
  return ((data ?? []) as unknown[]).map(mapCost);
}

/** Same query as `calculateUtilityCostsFromHistory` in useBreakEvenAnalysis. Result in cents. */
async function loadAutoUtilityCosts(supabase: any, restaurantId: string, today: string): Promise<number> {
  const endDate = parseLocalDate(today);
  const startDate = subMonths(endDate, 3);
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("amount, transaction_date, category_id, chart_of_accounts!category_id(account_subtype)")
    .eq("restaurant_id", restaurantId)
    .gte("transaction_date", format(startDate, "yyyy-MM-dd"))
    .lt("amount", 0);
  if (error) throw error;
  const total = ((data ?? []) as any[])
    .filter((t) => t.chart_of_accounts?.account_subtype === "utilities")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const days = differenceInDays(endDate, startDate) || 1;
  return Math.round((total / days) * 30 * 100);
}

async function loadBreakEven(
  supabase: any,
  restaurantId: string,
  costs: OperatingCost[],
  today: string,
): Promise<BreakEvenData | null> {
  const historyDays = 14;
  const monthStart = `${today.slice(0, 8)}01`;
  const rollingStart = addDaysToDateStr(today, -(historyDays - 1));
  const from = rollingStart < monthStart ? rollingStart : monthStart;
  const [rows, utility] = await Promise.all([
    rpcData(supabase, "get_daily_sales_totals", {
      p_restaurant_id: restaurantId,
      p_date_from: from,
      p_date_to: today,
    }),
    loadAutoUtilityCosts(supabase, restaurantId, today),
  ]);
  const sales = ((rows ?? []) as any[]).map((r) => ({
    date: r.sale_date as string,
    netRevenue: Number(r.total_revenue) || 0,
    transactionCount: Number(r.transaction_count) || 0,
  }));
  if (sales.length === 0) return null;
  return calculateBreakEven(costs, sales, utility, today, historyDays);
}

const TIER_NAME = { success: "ok", warning: "warning", danger: "over" } as const;

export async function loadLaborSection(
  supabase: any,
  restaurantId: string,
  period: LaborPeriod,
  gates: LaborGates,
  settings: StaffingSettings | null,
): Promise<LaborSection> {
  const { payRates, posSales } = gates;
  const weekDays = daysBetween(period.start, period.end);

  // One scheduled-cost load, shared by three items. Only the pay gate starts it.
  const costP = payRates
    ? guarded(() =>
        loadScheduledLaborCost(supabase, {
          restaurantId,
          startDay: period.start,
          endDay: period.end,
          timeZone: period.tz,
        }),
      )
    : null;

  const scheduledLabor = async (): Promise<LaborSection["scheduled_labor"]> => {
    if (!costP) return NEEDS_PAY;
    const cost = await costP;
    if (isUnavailable(cost)) return cost;
    const { hourly } = cost.breakdown;
    const averageRate = hourly.hours > 0 ? hourly.cost / hourly.hours : 0;
    return {
      total: cost.totalCost,
      // A viewer that passes the pay gate sees no masked rows.
      hidden_cost_count: 0,
      is_average_high: averageRate > 35,
      capped: cost.capped,
    };
  };

  const dailyPercent = async (): Promise<LaborSection["daily_labor_percent"]> => {
    if (!costP) return NEEDS_PAY;
    if (!posSales) return NEEDS_SALES;
    if (!settings) return NO_SETTINGS;
    return guarded(async () => {
      const [cost, data] = await Promise.all([
        costP,
        rpcData(supabase, "get_hourly_sales_pattern", {
          p_restaurant_id: restaurantId,
          p_start_date: addDaysToDateStr(period.today, -settings.lookback_weeks * 7),
          p_end_date: period.today,
          p_interval_minutes: 60,
          p_view: "by_date",
        }),
      ]);
      if (isUnavailable(cost)) throw new Error(cost.reason);
      const rows = (((data as any)?.days ?? []) as any[]).map((d) => ({
        sale_date: d.date as string,
        total_price: Number(d.day_total) || 0,
      }));
      const projected = projectDailySales(rows, weekDays, { excludeDate: period.today });
      const byDay = computeDailyLaborPercent({
        weekDays,
        dailyCosts: cost.dailyCosts,
        projectedSalesByDay: projected,
        targetLaborPct: settings.target_labor_pct,
      });
      return {
        target_labor_pct: settings.target_labor_pct,
        days: weekDays.map((date) => {
          const v = byDay.get(date)!;
          return {
            date,
            labor_cost: v.laborCost,
            projected_sales: v.projectedSales,
            percent: v.percent === null ? null : Math.min(Math.round(v.percent * 10) / 10, MAX_SHOWN_LABOR_PERCENT),
            over_target: v.overTarget,
          };
        }),
      };
    });
  };

  const laborBudget = async (): Promise<LaborSection["labor_budget"]> => {
    if (!costP) return NEEDS_PAY;
    return guarded(async () => {
      const [cost, costs] = await Promise.all([costP, loadOperatingCosts(supabase, restaurantId)]);
      if (isUnavailable(cost)) throw new Error(cost.reason);
      const entry = costs.find((c) => c.category === "labor");
      let breakEven: BreakEvenData | null = null;
      if (entry?.entryType === "percentage") {
        if (!posSales) return NEEDS_SALES;
        breakEven = await loadBreakEven(supabase, restaurantId, costs, period.today);
      }
      // The target is weekly. Scale the period cost to a 7-day week so the variance is valid.
      const weeklyCost = weekDays.length === 7 ? cost.totalCost : (cost.totalCost / weekDays.length) * 7;
      const b = calculateLaborBudget(weeklyCost, costs, breakEven);
      return {
        has_budget: b.hasBudget,
        weekly_target: b.weeklyTarget,
        percentage: b.percentage,
        variance: b.variance,
        tier: TIER_NAME[b.tier],
        source: b.source,
        cost_basis:
          weekDays.length === 7
            ? "scheduled cost for the 7-day period"
            : `scheduled cost for ${weekDays.length} days, scaled to a 7-day week`,
      };
    });
  };

  const staffing = async (): Promise<LaborSection["staffing_suggestions"]> => {
    if (!posSales) return NEEDS_SALES;
    if (!settings) return NO_SETTINGS;
    return guarded(async () => {
      const [data, employees] = await Promise.all([
        rpcData(supabase, "get_hourly_sales_pattern", {
          p_restaurant_id: restaurantId,
          p_start_date: addDaysToDateStr(period.today, -settings.lookback_weeks * 7),
          p_end_date: period.today,
          p_interval_minutes: 60,
          p_view: "weekday",
        }),
        payRates ? fetchLaborEmployees(supabase, restaurantId) : Promise.resolve(null),
      ]);
      const slotsByDow = new Map<number, { hour: number; avgSales: number }[]>();
      for (const day of ((data as any)?.days ?? []) as any[]) {
        slotsByDow.set(
          day.day_of_week,
          ((day.slots ?? []) as any[]).map((s) => ({ hour: s.start_minute / 60, avgSales: Number(s.sales) || 0 })),
        );
      }
      const input = { targetSplh: settings.target_splh, minStaff: settings.min_staff, minCrew: settings.min_crew };
      const hours: { date: string; hour: number; recommended_staff: number }[] = [];
      const daySales = new Map<string, number>();
      for (const date of weekDays) {
        const slots = (slotsByDow.get(dowOf(date)) ?? []).filter((s) => s.avgSales > 0);
        const recs = recommendForSlots(
          slots.map((s) => ({ startMinute: s.hour * 60 })),
          slots,
          input,
        );
        for (const r of recs) hours.push({ date, hour: r.hour, recommended_staff: r.recommendedStaff });
        daySales.set(date, slots.reduce((sum, s) => sum + s.avgSales, 0));
      }

      let labor: Item<any> = NEEDS_PAY;
      if (employees) {
        const roster = employees.rows as any[];
        const rateCents = computeAvgHourlyRateCents(roster);
        const hasWage = hasHourlyWageData(roster);
        labor = {
          avg_hourly_rate: rateCents / 100,
          has_wage_data: hasWage,
          ...(hasWage
            ? {}
            : { rate_note: `No hourly wage data. The rate is the ${DEFAULT_HOURLY_RATE_CENTS}-cent default.` }),
          days: weekDays.map((date) => {
            const staffHours = hours.filter((h) => h.date === date).reduce((s, h) => s + h.recommended_staff, 0);
            const sales = daySales.get(date) ?? 0;
            const cost = staffHours * (rateCents / 100);
            return {
              date,
              estimated_cost: cost,
              labor_pct: sales > 0 ? (cost / sales) * 100 : null,
              over_target: checkLaborGuardrail(staffHours, rateCents, sales, settings.target_labor_pct),
            };
          }),
        };
      }
      return { hours, labor };
    });
  };

  const [scheduled_labor, daily_labor_percent, labor_budget, staffing_suggestions] = await Promise.all([
    scheduledLabor(),
    dailyPercent(),
    laborBudget(),
    staffing(),
  ]);
  return { scheduled_labor, daily_labor_percent, labor_budget, staffing_suggestions };
}
