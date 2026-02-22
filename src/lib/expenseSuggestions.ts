/**
 * Pure detection logic for recurring expense suggestions.
 *
 * No React, no Supabase — just data in, suggestions out.
 * This module analyses bank transactions and returns expense suggestions
 * that can be surfaced to the user as potential budget entries.
 */

import type { ExpenseTransaction } from '@/lib/expenseDataFetcher';
import type {
  CostType,
  ExpenseSuggestion,
  OperatingCost,
} from '@/types/operatingCosts';

export interface DismissalRecord {
  suggestion_key: string;
  action: 'dismissed' | 'snoozed' | 'accepted';
  snoozed_until: string | null;
}

const SUBTYPE_COST_MAP: Record<string, CostType> = {
  rent: 'fixed',
  insurance: 'fixed',
  utilities: 'semi_variable',
  subscriptions: 'fixed',
  software: 'fixed',
};

/** Maps an account_subtype to the appropriate CostType for budgeting. */
export function mapSubtypeToCostType(
  subtype: string | null | undefined,
): CostType {
  if (!subtype) return 'custom';
  return SUBTYPE_COST_MAP[subtype] ?? 'custom';
}

const SUBTYPE_NAME_MAP: Record<string, string> = {
  rent: 'Rent / Lease',
  insurance: 'Insurance',
  utilities: 'Utilities',
  subscriptions: 'Subscription',
  software: 'Software / SaaS',
};

function suggestedNameForSubtype(
  subtype: string | null | undefined,
  accountName: string | null | undefined,
): string {
  if (subtype) {
    return SUBTYPE_NAME_MAP[subtype] ?? accountName ?? 'Other Expense';
  }
  return accountName ?? 'Other Expense';
}

/**
 * Detect recurring expenses from bank transactions and return suggestions.
 *
 * Algorithm:
 * 1. Group transactions by payee (normalized_payee, fallback merchant_name).
 * 2. Bucket each payee's transactions by calendar month (YYYY-MM).
 * 3. Sum amounts per month per payee (multiple payments in one month are combined).
 * 4. Flag as recurring if 2+ months AND monthly amounts within 20% variance.
 * 5. Compute average monthly amount (in cents, positive).
 * 6. Map account_subtype to cost block type.
 * 7. Exclude already-tracked operating costs.
 * 8. Filter out dismissed / actively-snoozed suggestions.
 * 9. Compute confidence score.
 * 10. Sort by confidence descending.
 */
export function detectRecurringExpenses(
  transactions: ExpenseTransaction[],
  existingCosts: OperatingCost[],
  dismissals: DismissalRecord[],
): ExpenseSuggestion[] {
  if (transactions.length === 0) return [];

  // Step 1: Group by payee
  const payeeGroups = groupByPayee(transactions);

  // Step 2-4: Identify recurring payees
  const candidates: ExpenseSuggestion[] = [];

  for (const [payeeKey, txns] of payeeGroups.entries()) {
    const monthBuckets = bucketByMonth(txns);
    const monthCount = monthBuckets.size;

    // Must appear in at least 2 months
    if (monthCount < 2) continue;

    // Sum amounts per month (absolute values in dollars)
    const monthlyTotals = Array.from(monthBuckets.values()).map((monthTxns) =>
      monthTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0),
    );

    // Check variance: all monthly totals must be within 20% of the average
    if (!isWithinVariance(monthlyTotals, 0.2)) continue;

    const avgMonthlyDollars =
      monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;

    // Use the most recent transaction's chart info as representative
    const sorted = [...txns].sort(
      (a, b) => b.transaction_date.localeCompare(a.transaction_date),
    );
    const representative = sorted[0];
    const subtype = representative.chart_of_accounts?.account_subtype ?? null;
    const accountName =
      representative.chart_of_accounts?.account_name ?? null;

    // Display name comes from representative (original casing), not the lowercased key
    const displayPayee =
      representative.normalized_payee ?? representative.merchant_name ?? payeeKey;

    const costType = mapSubtypeToCostType(subtype);
    const suggestedName = suggestedNameForSubtype(subtype, accountName);
    const suggestionKey = `${payeeKey}:${subtype ?? 'custom'}`;

    const variance = computeVariance(monthlyTotals);
    const confidence = computeConfidence(monthCount, variance);

    candidates.push({
      id: suggestionKey,
      payeeName: displayPayee,
      suggestedName,
      costType,
      monthlyAmount: Math.round(avgMonthlyDollars * 100), // dollars → cents
      confidence,
      source: 'bank',
      matchedMonths: monthCount,
    });
  }

  // Exclude already-tracked operating costs and dismissed/snoozed suggestions
  const dismissalMap = new Map(
    dismissals.map((d) => [d.suggestion_key, d]),
  );

  const filtered = candidates.filter((s) => {
    if (isAlreadyTracked(s, existingCosts)) return false;
    const dismissal = dismissalMap.get(s.id);
    return !dismissal || !isDismissedOrSnoozed(dismissal);
  });

  filtered.sort((a, b) => b.confidence - a.confidence);
  return filtered;
}

/**
 * Group transactions by payee. Uses normalized_payee first, falls back to
 * merchant_name. Transactions with neither are skipped.
 */
function groupByPayee(
  transactions: ExpenseTransaction[],
): Map<string, ExpenseTransaction[]> {
  const groups = new Map<string, ExpenseTransaction[]>();

  for (const txn of transactions) {
    const payee = txn.normalized_payee ?? txn.merchant_name;
    if (!payee) continue; // skip transactions with no identifier

    const key = payee.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.push(txn);
    } else {
      groups.set(key, [txn]);
    }
  }

  return groups;
}

/**
 * Bucket a payee's transactions by calendar month (YYYY-MM).
 */
function bucketByMonth(
  txns: ExpenseTransaction[],
): Map<string, ExpenseTransaction[]> {
  const buckets = new Map<string, ExpenseTransaction[]>();

  for (const txn of txns) {
    // transaction_date is "YYYY-MM-DD"
    const monthKey = txn.transaction_date.slice(0, 7); // "YYYY-MM"
    const existing = buckets.get(monthKey);
    if (existing) {
      existing.push(txn);
    } else {
      buckets.set(monthKey, [txn]);
    }
  }

  return buckets;
}

/**
 * Check if all values are within `threshold` (e.g. 0.2 = 20%) of the mean.
 */
function isWithinVariance(values: number[], threshold: number): boolean {
  if (values.length === 0) return false;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return false;

  return values.every(
    (v) => Math.abs(v - mean) / mean <= threshold,
  );
}

/**
 * Compute the coefficient of variation (stddev / mean) for a set of values.
 * Returns 0 if all values are identical.
 */
function computeVariance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;

  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance =
    squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Confidence score:
 * - Base: 0.6 for 2 months
 * - +0.2 for each additional month
 * - Minus variance penalty (CV capped at reducing score by 0.3)
 * - Capped at [0, 1]
 */
function computeConfidence(matchedMonths: number, cv: number): number {
  const base = 0.6;
  const monthBonus = Math.max(0, (matchedMonths - 2) * 0.2);
  const variancePenalty = Math.min(cv, 0.3);
  return Math.max(0, Math.min(1, base + monthBonus - variancePenalty));
}

/**
 * Check if a suggestion is already tracked in operating costs.
 * Matches by category (exact) or name (case-insensitive substring in either direction).
 */
function isAlreadyTracked(
  suggestion: ExpenseSuggestion,
  costs: OperatingCost[],
): boolean {
  const lastColon = suggestion.id.lastIndexOf(':');
  const subtypeFromId = lastColon >= 0 ? suggestion.id.slice(lastColon + 1) : '';
  const payeeLower = suggestion.payeeName.toLowerCase();

  return costs.some((cost) => {
    const categoryMatch =
      subtypeFromId &&
      subtypeFromId !== 'custom' &&
      cost.category.toLowerCase() === subtypeFromId.toLowerCase();

    const costNameLower = cost.name.toLowerCase();
    const nameMatch =
      costNameLower.includes(payeeLower) ||
      (costNameLower.length > 0 && payeeLower.includes(costNameLower));

    return categoryMatch || nameMatch;
  });
}

/**
 * Check if a dismissal record means the suggestion should be hidden.
 * - 'dismissed' / 'accepted' → always hidden
 * - 'snoozed' → hidden unless snoozed_until is in the past
 */
function isDismissedOrSnoozed(dismissal: DismissalRecord): boolean {
  if (dismissal.action === 'dismissed' || dismissal.action === 'accepted') {
    return true;
  }
  if (dismissal.action === 'snoozed') {
    return !dismissal.snoozed_until || new Date(dismissal.snoozed_until) > new Date();
  }
  return false;
}
