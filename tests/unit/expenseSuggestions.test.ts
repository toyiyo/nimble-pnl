import { describe, it, expect } from 'vitest';
import {
  detectRecurringExpenses,
  mapSubtypeToCostType,
} from '@/lib/expenseSuggestions';
import type { ExpenseTransaction } from '@/lib/expenseDataFetcher';
import type { OperatingCost, CostType } from '@/types/operatingCosts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ExpenseTransaction. Amounts are negative for outflows. */
function tx(
  overrides: Partial<ExpenseTransaction> & { transaction_date: string; amount: number }
): ExpenseTransaction {
  return {
    id: crypto.randomUUID(),
    status: 'posted',
    description: 'Test transaction',
    merchant_name: null,
    normalized_payee: null,
    category_id: null,
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: null,
    ...overrides,
  };
}

/** Build a minimal OperatingCost */
function opCost(overrides: Partial<OperatingCost>): OperatingCost {
  return {
    id: crypto.randomUUID(),
    restaurantId: 'r1',
    costType: 'fixed',
    category: '',
    name: '',
    entryType: 'value',
    monthlyValue: 0,
    percentageValue: 0,
    isAutoCalculated: false,
    manualOverride: false,
    averagingMonths: 3,
    displayOrder: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Dismissal {
  suggestion_key: string;
  action: 'dismissed' | 'snoozed' | 'accepted';
  snoozed_until: string | null;
}

// ---------------------------------------------------------------------------
// 1. mapSubtypeToCostType
// ---------------------------------------------------------------------------

describe('mapSubtypeToCostType', () => {
  const cases: [string | null | undefined, CostType][] = [
    ['rent', 'fixed'],
    ['insurance', 'fixed'],
    ['utilities', 'semi_variable'],
    ['subscriptions', 'fixed'],
    ['software', 'fixed'],
    ['unknown_category', 'custom'],
    [null, 'custom'],
    [undefined, 'custom'],
  ];

  it.each(cases)('maps %s → %s', (subtype, expected) => {
    expect(mapSubtypeToCostType(subtype as string | null | undefined)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 2–13. detectRecurringExpenses
// ---------------------------------------------------------------------------

describe('detectRecurringExpenses', () => {
  // ------- 2. Detects recurring payee in 2+ months ------- //
  it('detects a recurring payee appearing in 2+ months', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(1);
    expect(result[0].payeeName).toBe('landlord llc');
    expect(result[0].matchedMonths).toBe(2);
    // $3500 → 350000 cents
    expect(result[0].monthlyAmount).toBe(350000);
    expect(result[0].costType).toBe('fixed');
    expect(result[0].source).toBe('bank');
    expect(result[0].id).toBe('landlord llc:rent');
  });

  // ------- 3. Does NOT flag one-time transactions ------- //
  it('does NOT flag a one-time transaction', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'one-time vendor',
        amount: -500,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'Misc', account_subtype: 'other' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toEqual([]);
  });

  // ------- 4. Allows up to 20% variance ------- //
  it('allows up to 20% variance in amounts', () => {
    // Base is $1000, $1200 is exactly 20% higher → should still be accepted
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'utility co',
        amount: -1000,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'Electric', account_subtype: 'utilities' },
      }),
      tx({
        normalized_payee: 'utility co',
        amount: -1200,
        transaction_date: '2025-12-10',
        chart_of_accounts: { account_name: 'Electric', account_subtype: 'utilities' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(1);
    expect(result[0].costType).toBe('semi_variable');
  });

  // ------- 5. Rejects >20% variance ------- //
  it('rejects transactions with >20% variance', () => {
    // $1000 vs $2000 → mean $1500, max deviation 33% → should be rejected
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'wild vendor',
        amount: -1000,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'Stuff', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'wild vendor',
        amount: -2000,
        transaction_date: '2025-12-10',
        chart_of_accounts: { account_name: 'Stuff', account_subtype: 'other' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toEqual([]);
  });

  // ------- 6. Excludes already-tracked expenses ------- //
  it('excludes expenses already tracked in operating costs', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const existingCosts: OperatingCost[] = [
      opCost({ category: 'rent', name: 'Rent / Lease' }),
    ];

    const result = detectRecurringExpenses(transactions, existingCosts, []);
    expect(result).toEqual([]);
  });

  // ------- 7. Excludes dismissed suggestions ------- //
  it('excludes dismissed suggestions', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const dismissals: Dismissal[] = [
      { suggestion_key: 'landlord llc:rent', action: 'dismissed', snoozed_until: null },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result).toEqual([]);
  });

  // ------- 8. Shows snoozed suggestions after expiry ------- //
  it('shows snoozed suggestions after snooze expiry', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    // Snoozed until a past date
    const dismissals: Dismissal[] = [
      {
        suggestion_key: 'landlord llc:rent',
        action: 'snoozed',
        snoozed_until: '2025-06-01T00:00:00Z',
      },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result.length).toBe(1);
    expect(result[0].payeeName).toBe('landlord llc');
  });

  // ------- 9. Hides snoozed during active snooze period ------- //
  it('hides snoozed suggestions during active snooze period', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    // Snoozed until a far-future date
    const dismissals: Dismissal[] = [
      {
        suggestion_key: 'landlord llc:rent',
        action: 'snoozed',
        snoozed_until: '2099-12-31T00:00:00Z',
      },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result).toEqual([]);
  });

  // ------- 10. Returns empty for empty transactions ------- //
  it('returns empty array when given empty transactions', () => {
    const result = detectRecurringExpenses([], [], []);
    expect(result).toEqual([]);
  });

  // ------- 11. Falls back to merchant_name ------- //
  it('falls back to merchant_name when normalized_payee is null', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: null,
        merchant_name: 'Acme Insurance Co',
        amount: -800,
        transaction_date: '2026-01-05',
        chart_of_accounts: { account_name: 'Insurance', account_subtype: 'insurance' },
      }),
      tx({
        normalized_payee: null,
        merchant_name: 'Acme Insurance Co',
        amount: -800,
        transaction_date: '2025-12-05',
        chart_of_accounts: { account_name: 'Insurance', account_subtype: 'insurance' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(1);
    expect(result[0].payeeName).toBe('Acme Insurance Co');
    expect(result[0].costType).toBe('fixed');
  });

  // ------- 12. Computes confidence based on matched months ------- //
  it('computes confidence: 0.6 for 2 months, higher for more months', () => {
    const twoMonthTxns: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2025-12-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
    ];

    const threeMonthTxns: ExpenseTransaction[] = [
      ...twoMonthTxns,
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2025-11-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
    ];

    const twoResult = detectRecurringExpenses(twoMonthTxns, [], []);
    const threeResult = detectRecurringExpenses(threeMonthTxns, [], []);

    expect(twoResult.length).toBe(1);
    expect(threeResult.length).toBe(1);

    // Base confidence for 2 months = 0.6; for 3 months = 0.8
    // With zero variance there should be no penalty
    expect(twoResult[0].confidence).toBeCloseTo(0.6, 2);
    expect(threeResult[0].confidence).toBeCloseTo(0.8, 2);
    expect(threeResult[0].confidence).toBeGreaterThan(twoResult[0].confidence);
  });

  // ------- 13. Skips transactions with no payee identifier ------- //
  it('skips transactions with no payee identifier (both null)', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: null,
        merchant_name: null,
        amount: -500,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'Misc', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: null,
        merchant_name: null,
        amount: -500,
        transaction_date: '2025-12-10',
        chart_of_accounts: { account_name: 'Misc', account_subtype: 'other' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toEqual([]);
  });

  // ------- Additional: sorts by confidence descending ------- //
  it('sorts suggestions by confidence descending', () => {
    const transactions: ExpenseTransaction[] = [
      // Vendor A: 3 months → higher confidence
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2026-01-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2025-12-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'vendor a',
        amount: -1000,
        transaction_date: '2025-11-10',
        chart_of_accounts: { account_name: 'X', account_subtype: 'other' },
      }),
      // Vendor B: 2 months → lower confidence
      tx({
        normalized_payee: 'vendor b',
        amount: -500,
        transaction_date: '2026-01-05',
        chart_of_accounts: { account_name: 'Y', account_subtype: 'subscriptions' },
      }),
      tx({
        normalized_payee: 'vendor b',
        amount: -500,
        transaction_date: '2025-12-05',
        chart_of_accounts: { account_name: 'Y', account_subtype: 'subscriptions' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(2);
    expect(result[0].payeeName).toBe('vendor a');
    expect(result[1].payeeName).toBe('vendor b');
    expect(result[0].confidence).toBeGreaterThanOrEqual(result[1].confidence);
  });

  // ------- Additional: suggestedName mapping ------- //
  it('maps known subtypes to human-readable suggested names', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result[0].suggestedName).toBe('Rent / Lease');
  });

  // ------- Additional: monthlyAmount is in cents (absolute) ------- //
  it('outputs monthlyAmount in cents as a positive number', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'saas co',
        amount: -99.99,
        transaction_date: '2026-01-01',
        chart_of_accounts: { account_name: 'Software', account_subtype: 'software' },
      }),
      tx({
        normalized_payee: 'saas co',
        amount: -99.99,
        transaction_date: '2025-12-01',
        chart_of_accounts: { account_name: 'Software', account_subtype: 'software' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(1);
    expect(result[0].monthlyAmount).toBe(9999);
    expect(result[0].monthlyAmount).toBeGreaterThan(0);
  });

  // ------- Additional: multiple transactions in the same month are summed ------- //
  it('sums multiple transactions per payee in the same month', () => {
    // Two payments to same vendor in Jan, one in Dec
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'supplier co',
        amount: -250,
        transaction_date: '2026-01-05',
        chart_of_accounts: { account_name: 'Supplies', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'supplier co',
        amount: -250,
        transaction_date: '2026-01-20',
        chart_of_accounts: { account_name: 'Supplies', account_subtype: 'other' },
      }),
      tx({
        normalized_payee: 'supplier co',
        amount: -500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Supplies', account_subtype: 'other' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result.length).toBe(1);
    // Jan: -250 + -250 = -500 (abs $500), Dec: $500 → average $500 → 50000 cents
    expect(result[0].monthlyAmount).toBe(50000);
  });

  // ------- Additional: excludes by name match (case-insensitive) ------- //
  it('excludes expenses matched by name (case-insensitive)', () => {
    const transactions: ExpenseTransaction[] = [
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2026-01-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      tx({
        normalized_payee: 'landlord llc',
        amount: -3500,
        transaction_date: '2025-12-15',
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const existingCosts: OperatingCost[] = [
      opCost({ category: 'office_rent', name: 'Landlord LLC' }),
    ];

    const result = detectRecurringExpenses(transactions, existingCosts, []);
    expect(result).toEqual([]);
  });
});
