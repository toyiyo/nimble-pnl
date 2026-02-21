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

// ---------------------------------------------------------------------------
// Dismissal record shape (mirrors the DB table)
// ---------------------------------------------------------------------------

export interface DismissalRecord {
  suggestion_key: string;
  action: 'dismissed' | 'snoozed' | 'accepted';
  snoozed_until: string | null;
}

// ---------------------------------------------------------------------------
// Subtype → CostType mapping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suggested-name mapping (human-readable labels for known subtypes)
// ---------------------------------------------------------------------------

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
  if (subtype && SUBTYPE_NAME_MAP[subtype]) {
    return SUBTYPE_NAME_MAP[subtype];
  }
  // Fallback to the chart-of-accounts name, or a generic label
  return accountName ?? 'Other Expense';
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

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

  for (const [payee, txns] of payeeGroups.entries()) {
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

    // Use the first transaction's chart info as representative
    const representative = txns[0];
    const subtype = representative.chart_of_accounts?.account_subtype ?? null;
    const accountName =
      representative.chart_of_accounts?.account_name ?? null;

    const costType = mapSubtypeToCostType(subtype);
    const suggestedName = suggestedNameForSubtype(subtype, accountName);
    const suggestionKey = `${payee.toLowerCase()}:${subtype ?? 'custom'}`;

    const variance = computeVariance(monthlyTotals);
    const confidence = computeConfidence(monthCount, variance);

    candidates.push({
      id: suggestionKey,
      payeeName: payee,
      suggestedName,
      costType,
      monthlyAmount: Math.round(avgMonthlyDollars * 100), // dollars → cents
      confidence,
      source: 'bank',
      matchedMonths: monthCount,
    });
  }

  // Step 7: Exclude already-tracked operating costs
  const afterExclusion = candidates.filter(
    (s) => !isAlreadyTracked(s, existingCosts),
  );

  // Step 8: Filter out dismissed / actively-snoozed
  const dismissalMap = new Map(
    dismissals.map((d) => [d.suggestion_key, d]),
  );

  const afterDismissals = afterExclusion.filter((s) => {
    const dismissal = dismissalMap.get(s.id);
    if (!dismissal) return true;
    return !isDismissedOrSnoozed(dismissal);
  });

  // Step 10: Sort by confidence descending
  afterDismissals.sort((a, b) => b.confidence - a.confidence);

  return afterDismissals;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

    const existing = groups.get(payee);
    if (existing) {
      existing.push(txn);
    } else {
      groups.set(payee, [txn]);
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
 * Matches by category (exact) or name (case-insensitive contains payee).
 */
function isAlreadyTracked(
  suggestion: ExpenseSuggestion,
  costs: OperatingCost[],
): boolean {
  const lastColon = suggestion.id.lastIndexOf(':');
  const subtypeFromId = lastColon >= 0 ? suggestion.id.slice(lastColon + 1) : ''; // e.g. "rent" from "landlord llc:rent"
  const payeeLower = suggestion.payeeName.toLowerCase();

  return costs.some((cost) => {
    // Match by category (the account_subtype matches the operating cost category)
    if (
      subtypeFromId &&
      subtypeFromId !== 'custom' &&
      cost.category.toLowerCase() === subtypeFromId.toLowerCase()
    ) {
      return true;
    }
    // Match by name (operating cost name contains the payee, case-insensitive)
    if (cost.name.toLowerCase().includes(payeeLower)) {
      return true;
    }
    // Match by payee containing the cost name
    if (payeeLower.includes(cost.name.toLowerCase()) && cost.name.length > 0) {
      return true;
    }
    return false;
  });
}

/**
 * Check if a dismissal record means the suggestion should be hidden.
 * - 'dismissed' → always hidden
 * - 'accepted' → always hidden
 * - 'snoozed'  → hidden only if snoozed_until is in the future
 */
function isDismissedOrSnoozed(dismissal: DismissalRecord): boolean {
  if (dismissal.action === 'dismissed' || dismissal.action === 'accepted') {
    return true;
  }
  if (dismissal.action === 'snoozed' && dismissal.snoozed_until) {
    return new Date(dismissal.snoozed_until) > new Date();
  }
  // Snoozed with no expiry → treat as dismissed
  if (dismissal.action === 'snoozed' && !dismissal.snoozed_until) {
    return true;
  }
  return false;
}
