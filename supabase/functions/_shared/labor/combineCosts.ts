/**
 * Pure cost-combination helpers shared by the dashboard/report cost model.
 *
 * Labor de-duplication: accrued (time-punch) labor and paid (bank) labor
 * describe largely the SAME labor. Summing them double-counts. A period uses
 * accrued labor when it has any, and falls back to paid only when accrued is
 * zero. The decision is made ONCE per period and applied to every day — a
 * per-day fallback would re-introduce the double-count on low-punch days when a
 * lumpy bank payroll posts.
 */

export type LaborBasis = 'accrued' | 'paid';

export interface DailyCOGSInput {
  date: string;
  amount: number;
}

/** Accrued labor from time punches (`useLaborCostsFromTimeTracking`). */
export interface DailyLaborInput {
  date: string;
  total_labor_cost: number;
}

/** Paid labor from bank transactions (`useLaborCostsFromTransactions`). */
export interface DailyTxnLaborInput {
  date: string;
  labor_cost: number;
}

export interface CombinedDailyCost {
  date: string;
  food_cost: number;
  labor_cost: number;
  pending_labor_cost: number;
  actual_labor_cost: number;
  total_cost: number;
}

/**
 * Per-period labor basis. `pendingTotal` is the period's total accrued labor.
 * `> 0` => accrued; otherwise fall back to paid.
 */
export function resolveLaborBasis(pendingTotal: number): LaborBasis {
  return pendingTotal > 0 ? 'accrued' : 'paid';
}

/**
 * Merge daily COGS + accrued + paid labor by date. `labor_cost` and
 * `total_cost` reflect the chosen basis; `pending_labor_cost` and
 * `actual_labor_cost` always carry both raw sources for breakdown display.
 */
export function combineDailyCosts(
  cogs: DailyCOGSInput[],
  pendingDaily: DailyLaborInput[],
  actualDaily: DailyTxnLaborInput[],
  basis: LaborBasis,
): CombinedDailyCost[] {
  const map = new Map<string, CombinedDailyCost>();

  const ensure = (date: string): CombinedDailyCost => {
    let row = map.get(date);
    if (!row) {
      row = {
        date,
        food_cost: 0,
        labor_cost: 0,
        pending_labor_cost: 0,
        actual_labor_cost: 0,
        total_cost: 0,
      };
      map.set(date, row);
    }
    return row;
  };

  for (const day of cogs) {
    ensure(day.date).food_cost = day.amount;
  }
  for (const day of pendingDaily) {
    ensure(day.date).pending_labor_cost = day.total_labor_cost;
  }
  for (const day of actualDaily) {
    ensure(day.date).actual_labor_cost = day.labor_cost;
  }

  for (const row of map.values()) {
    row.labor_cost =
      basis === 'accrued' ? row.pending_labor_cost : row.actual_labor_cost;
    row.total_cost = row.food_cost + row.labor_cost;
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
