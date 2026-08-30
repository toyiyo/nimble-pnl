import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows, asPagedRows } from '@/utils/fetchAllRows';

export interface TipSplitRow {
  amount: number;
  employee_id: string;
  tip_splits: { restaurant_id: string; split_date: string };
}

export interface TipPayoutRow {
  amount: number;
  employee_id: string;
  payout_date: string;
}

/**
 * A split counts toward tips owed only in these states — the same rule
 * usePayroll applies. A draft or rejected split is not owed yet.
 */
export const OWED_TIP_SPLIT_STATUSES = ['approved', 'archived'];

/**
 * Page through tip_split_items for a restaurant and date window. Shared by
 * useMonthlyMetrics and useLaborCostsFromTimeTracking so both surfaces read
 * tips owed the same way. Only approved/archived parent splits count.
 */
export async function fetchTipSplitRows(
  client: SupabaseClient,
  restaurantId: string,
  fromStr: string,
  toStr: string
): Promise<{ rows: TipSplitRow[]; capped: boolean }> {
  return fetchAllRows<TipSplitRow>((from, to) =>
    asPagedRows<TipSplitRow>(
      client
        .from('tip_split_items')
        .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
        .eq('tip_splits.restaurant_id', restaurantId)
        .in('tip_splits.status', OWED_TIP_SPLIT_STATUSES)
        .gte('tip_splits.split_date', fromStr)
        .lte('tip_splits.split_date', toStr)
        .order('id')
        .range(from, to)
    )
  );
}

/**
 * Page through tip_payouts for a restaurant and date window (integer cents,
 * windowed by payout_date). Payouts reduce tips owed — the same netting
 * usePayroll applies via payrollCalculations.
 */
export async function fetchTipPayoutRows(
  client: SupabaseClient,
  restaurantId: string,
  fromStr: string,
  toStr: string
): Promise<{ rows: TipPayoutRow[]; capped: boolean }> {
  return fetchAllRows<TipPayoutRow>((from, to) =>
    asPagedRows<TipPayoutRow>(
      client
        .from('tip_payouts')
        .select('amount, employee_id, payout_date')
        .eq('restaurant_id', restaurantId)
        .gte('payout_date', fromStr)
        .lte('payout_date', toStr)
        .order('id')
        .range(from, to)
    )
  );
}

/**
 * Sum tip_split_items rows into cents owed per employee_id. amount is
 * already stored as integer cents in the DB — no conversion needed.
 */
export function sumTipsOwedByEmployee(rows: TipSplitRow[]): Map<string, number> {
  const tipsOwedByEmployee = new Map<string, number>();
  for (const row of rows) {
    tipsOwedByEmployee.set(
      row.employee_id,
      (tipsOwedByEmployee.get(row.employee_id) ?? 0) + row.amount
    );
  }
  return tipsOwedByEmployee;
}

/**
 * Net tips owed per employee: split cents minus payout cents, floored at
 * zero per employee. Mirrors payrollCalculations' tipsOwed rule
 * (`Math.max(0, tips - tipsPaidOut)`) so the dashboard matches Payroll.
 */
export function netTipsOwedByEmployee(
  tipRows: TipSplitRow[],
  payoutRows: TipPayoutRow[]
): Map<string, number> {
  const tipsOwedByEmployee = sumTipsOwedByEmployee(tipRows);
  const payoutsByEmployee = new Map<string, number>();
  for (const payout of payoutRows) {
    payoutsByEmployee.set(
      payout.employee_id,
      (payoutsByEmployee.get(payout.employee_id) ?? 0) + payout.amount
    );
  }
  const netted = new Map<string, number>();
  tipsOwedByEmployee.forEach((cents, employeeId) => {
    netted.set(
      employeeId,
      Math.max(0, cents - (payoutsByEmployee.get(employeeId) ?? 0))
    );
  });
  return netted;
}
