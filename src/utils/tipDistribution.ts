/**
 * Tip Distribution Aggregation
 *
 * Pure, testable aggregation of finalized tip splits + payouts into a
 * per-employee "who got what, and were they paid" breakdown for the
 * Distribution view.
 *
 * @module tipDistribution
 */

import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type { TipPayout } from '@/hooks/useTipPayouts';

/** Splits contribute to the distribution once they're no longer a draft. */
const FINALIZED_STATUSES = new Set<TipSplitWithItems['status']>(['approved', 'archived']);

export interface EmployeeDistribution {
  employeeId: string;
  name: string;
  role: string | null;
  hoursWorked: number; // summed across the period's finalized splits
  earnedCents: number; // summed tip_split_items.amount
  paidCents: number; // summed tip_payouts.amount for this employee/period
  unpaidCents: number; // max(0, earned - paid)
  sharePct: number; // earnedCents / totalEarnedCents * 100
}

export interface TipDistributionResult {
  employees: EmployeeDistribution[]; // sorted earnedCents desc, name asc tie-break
  totalEarnedCents: number;
  totalPaidCents: number;
  totalUnpaidCents: number;
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

interface EmployeeAccumulator {
  employeeId: string;
  name: string;
  role: string | null;
  hoursWorked: number;
  earnedCents: number;
}

/**
 * Aggregate finalized tip splits and payouts into a per-employee
 * distribution for the selected period.
 *
 * Only splits with `status` of `approved` or `archived` contribute —
 * drafts are work-in-progress and would mislead a "distribution" view.
 */
export function aggregateTipDistribution(
  splits: TipSplitWithItems[],
  payouts: TipPayout[],
): TipDistributionResult {
  const accumulators = new Map<string, EmployeeAccumulator>();

  for (const split of splits) {
    if (!FINALIZED_STATUSES.has(split.status)) continue;

    for (const item of split.items) {
      const existing = accumulators.get(item.employee_id) ?? {
        employeeId: item.employee_id,
        name: item.employee?.name ?? 'Unknown',
        role: item.employee?.position ?? null,
        hoursWorked: 0,
        earnedCents: 0,
      };

      existing.hoursWorked += item.hours_worked ?? 0;
      existing.earnedCents += item.amount;
      accumulators.set(item.employee_id, existing);
    }
  }

  const paidByEmployee = new Map<string, number>();
  for (const payout of payouts) {
    paidByEmployee.set(
      payout.employee_id,
      (paidByEmployee.get(payout.employee_id) ?? 0) + payout.amount,
    );
  }

  const totalEarnedCents = Array.from(accumulators.values()).reduce(
    (sum, e) => sum + e.earnedCents,
    0,
  );

  const employees: EmployeeDistribution[] = Array.from(accumulators.values()).map((e) => {
    const paidCents = paidByEmployee.get(e.employeeId) ?? 0;
    const unpaidCents = Math.max(0, e.earnedCents - paidCents);
    const sharePct = totalEarnedCents > 0 ? (e.earnedCents / totalEarnedCents) * 100 : 0;

    return {
      employeeId: e.employeeId,
      name: e.name,
      role: e.role,
      hoursWorked: e.hoursWorked,
      earnedCents: e.earnedCents,
      paidCents,
      unpaidCents,
      sharePct,
    };
  });

  employees.sort((a, b) => {
    if (b.earnedCents !== a.earnedCents) return b.earnedCents - a.earnedCents;
    return a.name.localeCompare(b.name);
  });

  const totalPaidCents = employees.reduce((sum, e) => sum + e.paidCents, 0);
  const totalUnpaidCents = employees.reduce((sum, e) => sum + e.unpaidCents, 0);

  return {
    employees,
    totalEarnedCents,
    totalPaidCents,
    totalUnpaidCents,
  };
}

/**
 * Derive a three-way payment status for an employee's distribution row.
 *
 * - `paid` — fully paid (or nothing was earned, so nothing is owed).
 * - `partial` — some paid, but a balance remains.
 * - `unpaid` — earned something but nothing has been paid yet.
 */
export function paymentStatus(distribution: EmployeeDistribution): PaymentStatus {
  const { earnedCents, paidCents, unpaidCents } = distribution;

  if (unpaidCents === 0) return 'paid';
  if (paidCents > 0 && unpaidCents > 0) return 'partial';
  if (paidCents === 0 && earnedCents > 0) return 'unpaid';
  return 'paid';
}
