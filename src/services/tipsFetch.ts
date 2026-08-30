import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows, asPagedRows } from '@/utils/fetchAllRows';

export interface TipSplitRow {
  amount: number;
  employee_id: string;
  tip_splits: { restaurant_id: string; split_date: string };
}

/**
 * Page through tip_split_items for a restaurant and date window. Shared by
 * useMonthlyMetrics and useLaborCostsFromTimeTracking so both surfaces read
 * tips owed the same way.
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
        .gte('tip_splits.split_date', fromStr)
        .lte('tip_splits.split_date', toStr)
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
