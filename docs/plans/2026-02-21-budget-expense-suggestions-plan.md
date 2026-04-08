# Budget Expense Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect recurring expenses from bank transactions and payroll, surface inline suggestion banners in Budget cost blocks so managers can accept, snooze, or dismiss.

**Architecture:** Client-side `useExpenseSuggestions` hook analyzes bank transaction outflows (90 days) and payroll data to find recurring patterns. A new `expense_suggestion_dismissals` table tracks manager actions. `ExpenseSuggestionBanner` components render inside existing `CostBlock` components.

**Tech Stack:** React, TypeScript, Vitest, Supabase (PostgreSQL + RLS), React Query, TailwindCSS

**Design doc:** `docs/plans/2026-02-21-budget-expense-suggestions-design.md`

---

### Task 1: Database Migration — `expense_suggestion_dismissals` Table

**Files:**
- Create: `supabase/migrations/<timestamp>_expense_suggestion_dismissals.sql`

**Step 1: Write the migration**

Apply this migration via Supabase MCP `apply_migration`:

```sql
-- Table to track dismissed/snoozed/accepted expense suggestions
CREATE TABLE public.expense_suggestion_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  suggestion_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismissed', 'snoozed', 'accepted')),
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, suggestion_key)
);

CREATE INDEX idx_expense_suggestion_dismissals_restaurant
  ON public.expense_suggestion_dismissals(restaurant_id);

ALTER TABLE public.expense_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can insert expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can update expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can delete expense suggestion dismissals"
ON public.expense_suggestion_dismissals
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_restaurants.restaurant_id = expense_suggestion_dismissals.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

CREATE TRIGGER update_expense_suggestion_dismissals_updated_at
  BEFORE UPDATE ON public.expense_suggestion_dismissals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

**Step 2: Regenerate TypeScript types**

Run: `mcp__supabase__generate_typescript_types` to get the new table in `src/integrations/supabase/types.ts`.

**Step 3: Commit**

```bash
git add supabase/migrations/*expense_suggestion_dismissals* src/integrations/supabase/types.ts
git commit -m "feat: add expense_suggestion_dismissals table with RLS"
```

---

### Task 2: Types — `ExpenseSuggestion` Interface

**Files:**
- Modify: `src/types/operatingCosts.ts`

**Step 1: Add the ExpenseSuggestion type**

Add at the end of `src/types/operatingCosts.ts` (after the `DEFAULT_OPERATING_COSTS` array, line 110):

```typescript
// Expense suggestion from bank transaction / payroll analysis
export interface ExpenseSuggestion {
  id: string;              // deterministic key: "{normalized_payee}:{account_subtype}"
  payeeName: string;       // "ABC Landlord LLC"
  suggestedName: string;   // "Rent / Lease" (mapped from category)
  costType: CostType;      // which cost block it belongs in
  monthlyAmount: number;   // average monthly amount in cents
  confidence: number;      // 0-1 based on months matched + variance
  source: 'bank' | 'payroll';
  matchedMonths: number;   // how many months the pattern was detected
}

export type SuggestionAction = 'dismissed' | 'snoozed' | 'accepted';
```

**Step 2: Commit**

```bash
git add src/types/operatingCosts.ts
git commit -m "feat: add ExpenseSuggestion type"
```

---

### Task 3: Pure Detection Logic — `detectRecurringExpenses`

This is a pure function (no hooks, no Supabase) that takes transaction data and returns suggestions. Testable in isolation.

**Files:**
- Create: `src/lib/expenseSuggestions.ts`
- Create: `tests/unit/expenseSuggestions.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/expenseSuggestions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectRecurringExpenses, mapSubtypeToCostType } from '../../src/lib/expenseSuggestions';
import type { ExpenseTransaction } from '../../src/lib/expenseDataFetcher';
import type { OperatingCost } from '../../src/types/operatingCosts';

// Helper to create a mock transaction
function mockTransaction(overrides: Partial<ExpenseTransaction> & {
  normalized_payee: string;
  transaction_date: string;
  amount: number;
}): ExpenseTransaction {
  return {
    id: crypto.randomUUID(),
    status: 'posted',
    description: '',
    merchant_name: null,
    category_id: null,
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: null,
    ...overrides,
  };
}

describe('mapSubtypeToCostType', () => {
  it('maps rent to fixed', () => {
    expect(mapSubtypeToCostType('rent')).toBe('fixed');
  });

  it('maps insurance to fixed', () => {
    expect(mapSubtypeToCostType('insurance')).toBe('fixed');
  });

  it('maps utilities to semi_variable', () => {
    expect(mapSubtypeToCostType('utilities')).toBe('semi_variable');
  });

  it('maps subscriptions to fixed', () => {
    expect(mapSubtypeToCostType('subscriptions')).toBe('fixed');
  });

  it('maps software to fixed', () => {
    expect(mapSubtypeToCostType('software')).toBe('fixed');
  });

  it('maps unknown subtypes to custom', () => {
    expect(mapSubtypeToCostType('other_expenses')).toBe('custom');
    expect(mapSubtypeToCostType(null)).toBe('custom');
  });
});

describe('detectRecurringExpenses', () => {
  it('detects a payee appearing in 2+ of last 3 months', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2026-01-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2025-12-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].payeeName).toBe('ABC Landlord');
    expect(result[0].monthlyAmount).toBe(350000); // cents
    expect(result[0].costType).toBe('fixed');
    expect(result[0].matchedMonths).toBe(2);
    expect(result[0].suggestedName).toBe('Rent / Lease');
  });

  it('does NOT flag one-time transactions', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'One Time Vendor',
        transaction_date: '2026-01-10',
        amount: -500,
        chart_of_accounts: { account_name: 'Repairs', account_subtype: 'repairs_maintenance' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(0);
  });

  it('allows up to 20% amount variance', () => {
    // $3000 and $3600 = 20% variance from mean — should pass
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'Utility Co',
        transaction_date: '2026-01-10',
        amount: -3000,
        chart_of_accounts: { account_name: 'Utilities', account_subtype: 'utilities' },
      }),
      mockTransaction({
        normalized_payee: 'Utility Co',
        transaction_date: '2025-12-10',
        amount: -3600,
        chart_of_accounts: { account_name: 'Utilities', account_subtype: 'utilities' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].costType).toBe('semi_variable');
  });

  it('rejects amounts with >20% variance', () => {
    // $1000 and $2000 = 66% variance — should fail
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'Wild Vendor',
        transaction_date: '2026-01-10',
        amount: -1000,
        chart_of_accounts: null,
      }),
      mockTransaction({
        normalized_payee: 'Wild Vendor',
        transaction_date: '2025-12-10',
        amount: -2000,
        chart_of_accounts: null,
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(0);
  });

  it('excludes expenses already in operating costs by category', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2026-01-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2025-12-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const existingCosts: OperatingCost[] = [
      { category: 'rent', name: 'Rent / Lease', monthlyValue: 350000 },
    ];

    const result = detectRecurringExpenses(transactions, existingCosts, []);
    expect(result).toHaveLength(0);
  });

  it('excludes dismissed suggestions', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2026-01-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2025-12-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const dismissals = [
      { suggestion_key: 'abc landlord:rent', action: 'dismissed' as const, snoozed_until: null },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result).toHaveLength(0);
  });

  it('shows snoozed suggestions after snooze period expires', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2026-01-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2025-12-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const dismissals = [
      { suggestion_key: 'abc landlord:rent', action: 'snoozed' as const, snoozed_until: pastDate },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result).toHaveLength(1);
  });

  it('hides snoozed suggestions during active snooze period', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2026-01-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'ABC Landlord',
        transaction_date: '2025-12-15',
        amount: -3500,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days from now
    const dismissals = [
      { suggestion_key: 'abc landlord:rent', action: 'snoozed' as const, snoozed_until: futureDate },
    ];

    const result = detectRecurringExpenses(transactions, [], dismissals);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty transactions', () => {
    const result = detectRecurringExpenses([], [], []);
    expect(result).toHaveLength(0);
  });

  it('falls back to merchant_name when normalized_payee is null', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: null,
        merchant_name: 'State Farm Insurance',
        transaction_date: '2026-01-10',
        amount: -450,
        chart_of_accounts: { account_name: 'Insurance', account_subtype: 'insurance' },
      }),
      mockTransaction({
        normalized_payee: null,
        merchant_name: 'State Farm Insurance',
        transaction_date: '2025-12-10',
        amount: -450,
        chart_of_accounts: { account_name: 'Insurance', account_subtype: 'insurance' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].payeeName).toBe('State Farm Insurance');
    expect(result[0].costType).toBe('fixed');
  });

  it('computes confidence based on matched months', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: 'Rent Inc',
        transaction_date: '2026-01-15',
        amount: -2000,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'Rent Inc',
        transaction_date: '2025-12-15',
        amount: -2000,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
      mockTransaction({
        normalized_payee: 'Rent Inc',
        transaction_date: '2025-11-15',
        amount: -2000,
        chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].matchedMonths).toBe(3);
    // 3 months with 0% variance = high confidence
    expect(result[0].confidence).toBeGreaterThan(0.8);
  });

  it('skips transactions with no payee identifier', () => {
    const transactions: ExpenseTransaction[] = [
      mockTransaction({
        normalized_payee: null,
        merchant_name: null,
        transaction_date: '2026-01-10',
        amount: -500,
        chart_of_accounts: null,
      }),
      mockTransaction({
        normalized_payee: null,
        merchant_name: null,
        transaction_date: '2025-12-10',
        amount: -500,
        chart_of_accounts: null,
      }),
    ];

    const result = detectRecurringExpenses(transactions, [], []);
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/expenseSuggestions.test.ts`
Expected: FAIL — module `src/lib/expenseSuggestions` does not exist

**Step 3: Write the implementation**

Create `src/lib/expenseSuggestions.ts`:

```typescript
import type { ExpenseTransaction } from '@/lib/expenseDataFetcher';
import type { CostType, ExpenseSuggestion, OperatingCost } from '@/types/operatingCosts';

// Maps account_subtype from chart_of_accounts to the budget cost block type
const SUBTYPE_TO_COST_TYPE: Record<string, CostType> = {
  rent: 'fixed',
  insurance: 'fixed',
  utilities: 'semi_variable',
  subscriptions: 'fixed',
  software: 'fixed',
};

// Maps account_subtype to a user-friendly suggested name for the budget entry
const SUBTYPE_TO_SUGGESTED_NAME: Record<string, string> = {
  rent: 'Rent / Lease',
  insurance: 'Property Insurance',
  utilities: 'Utilities',
  subscriptions: 'Subscriptions',
  software: 'POS / Software',
};

export function mapSubtypeToCostType(subtype: string | null): CostType {
  if (!subtype) return 'custom';
  return SUBTYPE_TO_COST_TYPE[subtype] ?? 'custom';
}

interface Dismissal {
  suggestion_key: string;
  action: 'dismissed' | 'snoozed' | 'accepted';
  snoozed_until: string | null;
}

/**
 * Pure function: analyzes bank transactions to detect recurring expenses
 * that aren't already tracked in operating costs.
 */
export function detectRecurringExpenses(
  transactions: ExpenseTransaction[],
  existingCosts: OperatingCost[],
  dismissals: Dismissal[],
): ExpenseSuggestion[] {
  // 1. Group transactions by payee
  const byPayee = new Map<string, ExpenseTransaction[]>();
  for (const tx of transactions) {
    const payee = tx.normalized_payee || tx.merchant_name;
    if (!payee) continue;
    const key = payee.toLowerCase();
    if (!byPayee.has(key)) byPayee.set(key, []);
    byPayee.get(key)!.push(tx);
  }

  const suggestions: ExpenseSuggestion[] = [];

  for (const [payeeKey, txns] of byPayee) {
    // 2. Bucket by calendar month (YYYY-MM)
    const byMonth = new Map<string, number[]>();
    for (const tx of txns) {
      const month = tx.transaction_date.slice(0, 7); // "2026-01"
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(Math.abs(tx.amount));
    }

    // 3. Need 2+ months
    if (byMonth.size < 2) continue;

    // 4. Compute monthly totals and check variance
    const monthlyTotals = Array.from(byMonth.values()).map(
      (amounts) => amounts.reduce((sum, a) => sum + a, 0)
    );
    const mean = monthlyTotals.reduce((s, v) => s + v, 0) / monthlyTotals.length;
    if (mean === 0) continue;

    const maxDeviation = Math.max(
      ...monthlyTotals.map((v) => Math.abs(v - mean) / mean)
    );
    if (maxDeviation > 0.2) continue;

    // 5. Determine account_subtype from the most recent transaction
    const sorted = [...txns].sort(
      (a, b) => b.transaction_date.localeCompare(a.transaction_date)
    );
    const subtype = sorted[0].chart_of_accounts?.account_subtype ?? null;
    const costType = mapSubtypeToCostType(subtype);
    const payeeName = sorted[0].normalized_payee || sorted[0].merchant_name!;
    const suggestionKey = `${payeeKey}:${subtype ?? 'unknown'}`;

    // 6. Exclude if already tracked
    const subtypeLower = subtype?.toLowerCase();
    const isTracked = existingCosts.some(
      (c) =>
        c.category === subtypeLower ||
        c.name.toLowerCase() === payeeName.toLowerCase()
    );
    if (isTracked) continue;

    // 7. Exclude if dismissed or actively snoozed
    const dismissal = dismissals.find((d) => d.suggestion_key === suggestionKey);
    if (dismissal) {
      if (dismissal.action === 'dismissed' || dismissal.action === 'accepted') continue;
      if (
        dismissal.action === 'snoozed' &&
        dismissal.snoozed_until &&
        new Date(dismissal.snoozed_until) > new Date()
      ) {
        continue;
      }
    }

    // 8. Compute confidence: base 0.6 for 2 months, +0.2 per extra month, minus variance penalty
    const monthCount = byMonth.size;
    const baseConfidence = Math.min(0.6 + (monthCount - 2) * 0.2, 1.0);
    const variancePenalty = maxDeviation * 0.5; // up to 0.1 penalty at 20% variance
    const confidence = Math.max(0, Math.min(1, baseConfidence - variancePenalty));

    const monthlyAmountCents = Math.round(mean * 100);

    suggestions.push({
      id: suggestionKey,
      payeeName,
      suggestedName:
        SUBTYPE_TO_SUGGESTED_NAME[subtype ?? ''] ?? payeeName,
      costType,
      monthlyAmount: monthlyAmountCents,
      confidence,
      source: 'bank',
      matchedMonths: monthCount,
    });
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/expenseSuggestions.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/expenseSuggestions.ts tests/unit/expenseSuggestions.test.ts
git commit -m "feat: add recurring expense detection logic with tests"
```

---

### Task 4: `useExpenseSuggestions` Hook

Orchestrates data fetching (bank transactions, operating costs, dismissals) and calls `detectRecurringExpenses`. Also provides mutation functions for dismiss/snooze/accept.

**Files:**
- Create: `src/hooks/useExpenseSuggestions.ts`
- Create: `tests/unit/useExpenseSuggestions.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/useExpenseSuggestions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useExpenseSuggestions } from '../../src/hooks/useExpenseSuggestions';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockFetchExpenseData = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expenseDataFetcher', () => ({
  fetchExpenseData: mockFetchExpenseData,
}));

const mockUseOperatingCosts = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useOperatingCosts', () => ({
  useOperatingCosts: mockUseOperatingCosts,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const RESTAURANT_ID = 'rest-123';

describe('useExpenseSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no existing costs
    mockUseOperatingCosts.mockReturnValue({
      costs: [],
      isLoading: false,
      error: null,
    });

    // Default: no dismissals
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
  });

  it('returns empty suggestions when no transactions exist', async () => {
    mockFetchExpenseData.mockResolvedValue({
      transactions: [],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useExpenseSuggestions(RESTAURANT_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions).toEqual([]);
  });

  it('returns suggestions for recurring bank transactions', async () => {
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: '1',
          normalized_payee: 'ABC Landlord',
          merchant_name: null,
          transaction_date: '2026-01-15',
          amount: -3500,
          status: 'posted',
          description: '',
          category_id: null,
          is_split: false,
          ai_confidence: null,
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
        {
          id: '2',
          normalized_payee: 'ABC Landlord',
          merchant_name: null,
          transaction_date: '2025-12-15',
          amount: -3500,
          status: 'posted',
          description: '',
          category_id: null,
          is_split: false,
          ai_confidence: null,
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
      ],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useExpenseSuggestions(RESTAURANT_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].payeeName).toBe('ABC Landlord');
    expect(result.current.suggestions[0].costType).toBe('fixed');
  });

  it('returns null when restaurantId is null', async () => {
    const { result } = renderHook(
      () => useExpenseSuggestions(null),
      { wrapper: createWrapper() },
    );

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('provides dismissSuggestion mutation', async () => {
    mockFetchExpenseData.mockResolvedValue({
      transactions: [],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useExpenseSuggestions(RESTAURANT_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.dismissSuggestion).toBe('function');
    expect(typeof result.current.snoozeSuggestion).toBe('function');
    expect(typeof result.current.acceptSuggestion).toBe('function');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/useExpenseSuggestions.test.ts`
Expected: FAIL — module `src/hooks/useExpenseSuggestions` does not exist

**Step 3: Write the implementation**

Create `src/hooks/useExpenseSuggestions.ts`:

```typescript
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchExpenseData } from '@/lib/expenseDataFetcher';
import { useOperatingCosts } from '@/hooks/useOperatingCosts';
import { detectRecurringExpenses } from '@/lib/expenseSuggestions';
import { useToast } from '@/hooks/use-toast';
import type { ExpenseSuggestion, SuggestionAction } from '@/types/operatingCosts';
import { format, subDays } from 'date-fns';

export function useExpenseSuggestions(restaurantId: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { costs, isLoading: costsLoading } = useOperatingCosts(restaurantId);

  // Fetch dismissals
  const { data: dismissals, isLoading: dismissalsLoading } = useQuery({
    queryKey: ['expenseSuggestionDismissals', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_suggestion_dismissals')
        .select('suggestion_key, action, snoozed_until')
        .eq('restaurant_id', restaurantId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  // Fetch bank transactions (last 90 days)
  const today = new Date();
  const ninetyDaysAgo = subDays(today, 90);
  const dateFrom = format(ninetyDaysAgo, 'yyyy-MM-dd');
  const dateTo = format(today, 'yyyy-MM-dd');

  const { data: expenseData, isLoading: expensesLoading } = useQuery({
    queryKey: ['expenseSuggestionTransactions', restaurantId, dateFrom],
    queryFn: () =>
      fetchExpenseData({
        restaurantId: restaurantId!,
        dateFrom,
        dateTo,
      }),
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes — suggestions don't need to be super fresh
  });

  // Compute suggestions from data
  const suggestions: ExpenseSuggestion[] = useMemo(() => {
    if (!expenseData?.transactions || costsLoading || dismissalsLoading) return [];
    return detectRecurringExpenses(
      expenseData.transactions,
      costs,
      dismissals ?? [],
    );
  }, [expenseData?.transactions, costs, costsLoading, dismissals, dismissalsLoading]);

  // Mutation: upsert a dismissal record
  const upsertDismissal = useMutation({
    mutationFn: async ({
      suggestionKey,
      action,
      snoozedUntil,
    }: {
      suggestionKey: string;
      action: SuggestionAction;
      snoozedUntil?: string | null;
    }) => {
      const { error } = await supabase
        .from('expense_suggestion_dismissals')
        .upsert(
          {
            restaurant_id: restaurantId!,
            suggestion_key: suggestionKey,
            action,
            snoozed_until: snoozedUntil ?? null,
          },
          { onConflict: 'restaurant_id,suggestion_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['expenseSuggestionDismissals', restaurantId],
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update suggestion. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const dismissSuggestion = (suggestionKey: string) => {
    upsertDismissal.mutate({ suggestionKey, action: 'dismissed' });
  };

  const snoozeSuggestion = (suggestionKey: string) => {
    const snoozedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    upsertDismissal.mutate({ suggestionKey, action: 'snoozed', snoozedUntil });
  };

  const acceptSuggestion = (suggestionKey: string) => {
    upsertDismissal.mutate({ suggestionKey, action: 'accepted' });
  };

  const isLoading = costsLoading || dismissalsLoading || expensesLoading;

  return {
    suggestions,
    isLoading,
    dismissSuggestion,
    snoozeSuggestion,
    acceptSuggestion,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/useExpenseSuggestions.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/hooks/useExpenseSuggestions.ts tests/unit/useExpenseSuggestions.test.ts
git commit -m "feat: add useExpenseSuggestions hook with tests"
```

---

### Task 5: `ExpenseSuggestionBanner` Component

**Files:**
- Create: `src/components/budget/ExpenseSuggestionBanner.tsx`
- Create: `tests/unit/ExpenseSuggestionBanner.test.tsx`

**Step 1: Write the failing tests**

Create `tests/unit/ExpenseSuggestionBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpenseSuggestionBanner } from '../../src/components/budget/ExpenseSuggestionBanner';
import type { ExpenseSuggestion } from '../../src/types/operatingCosts';

const mockSuggestion: ExpenseSuggestion = {
  id: 'abc-landlord:rent',
  payeeName: 'ABC Landlord',
  suggestedName: 'Rent / Lease',
  costType: 'fixed',
  monthlyAmount: 350000, // $3,500.00
  confidence: 0.9,
  source: 'bank',
  matchedMonths: 3,
};

describe('ExpenseSuggestionBanner', () => {
  it('renders suggestion with payee name and amount', () => {
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText(/ABC Landlord/)).toBeTruthy();
    expect(screen.getByText(/\$3,500/)).toBeTruthy();
    expect(screen.getByText(/Rent \/ Lease/)).toBeTruthy();
  });

  it('calls onAccept with suggestion when "Add to Budget" is clicked', () => {
    const onAccept = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={onAccept}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add to budget/i }));
    expect(onAccept).toHaveBeenCalledWith(mockSuggestion);
  });

  it('calls onSnooze with suggestion id when "Not Now" is clicked', () => {
    const onSnooze = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={onSnooze}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onSnooze).toHaveBeenCalledWith(mockSuggestion.id);
  });

  it('calls onDismiss with suggestion id when "Dismiss" is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith(mockSuggestion.id);
  });

  it('shows max 3 suggestions with "Show N more" link', () => {
    const suggestions = Array.from({ length: 5 }, (_, i) => ({
      ...mockSuggestion,
      id: `suggestion-${i}`,
      payeeName: `Vendor ${i}`,
    }));

    render(
      <ExpenseSuggestionBanner
        suggestions={suggestions}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    // Should show 3 banners
    expect(screen.getAllByText(/Add to Budget/i)).toHaveLength(3);
    // Should show "Show 2 more" link
    expect(screen.getByText(/show 2 more/i)).toBeTruthy();
  });

  it('renders nothing when suggestions array is empty', () => {
    const { container } = render(
      <ExpenseSuggestionBanner
        suggestions={[]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
```

**Note:** Fix typo `fireClick` → `fireEvent.click` during implementation review.

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/ExpenseSuggestionBanner.test.tsx`
Expected: FAIL — module does not exist

**Step 3: Write the component**

Create `src/components/budget/ExpenseSuggestionBanner.tsx`.

> **Use @superpowers:frontend-design skill** for the visual implementation, following the amber suggestion panel pattern from CLAUDE.md: `bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5`.

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Lightbulb } from 'lucide-react';
import type { ExpenseSuggestion } from '@/types/operatingCosts';

interface ExpenseSuggestionBannerProps {
  suggestions: ExpenseSuggestion[];
  onAccept: (suggestion: ExpenseSuggestion) => void;
  onSnooze: (suggestionId: string) => void;
  onDismiss: (suggestionId: string) => void;
}

const MAX_VISIBLE = 3;

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function ExpenseSuggestionBanner({
  suggestions,
  onAccept,
  onSnooze,
  onDismiss,
}: ExpenseSuggestionBannerProps) {
  const [showAll, setShowAll] = useState(false);

  if (suggestions.length === 0) return null;

  const visible = showAll ? suggestions : suggestions.slice(0, MAX_VISIBLE);
  const hiddenCount = suggestions.length - MAX_VISIBLE;

  return (
    <div className="space-y-2">
      {visible.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Lightbulb className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-[13px] text-foreground truncate">
              We found a recurring{' '}
              <span className="font-medium">{formatDollars(suggestion.monthlyAmount)}/mo</span>{' '}
              payment to{' '}
              <span className="font-medium">{suggestion.payeeName}</span>.{' '}
              Add as &ldquo;{suggestion.suggestedName}&rdquo;?
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] font-medium text-amber-700 hover:text-amber-800 hover:bg-amber-500/20"
              onClick={() => onAccept(suggestion)}
              aria-label="Add to Budget"
            >
              Add to Budget
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => onSnooze(suggestion.id)}
              aria-label="Not Now"
            >
              Not Now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-muted-foreground hover:text-destructive"
              onClick={() => onDismiss(suggestion.id)}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2.5"
        >
          Show {hiddenCount} more suggestion{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/ExpenseSuggestionBanner.test.tsx`
Expected: ALL PASS (fix `fireClick` typo if present in test file)

**Step 5: Commit**

```bash
git add src/components/budget/ExpenseSuggestionBanner.tsx tests/unit/ExpenseSuggestionBanner.test.tsx
git commit -m "feat: add ExpenseSuggestionBanner component with tests"
```

---

### Task 6: Wire Suggestions Into `CostBlock` and `BudgetRunRate`

**Files:**
- Modify: `src/components/budget/CostBlock.tsx`
- Modify: `src/pages/BudgetRunRate.tsx`

**Step 1: Add `suggestions` prop to CostBlock**

In `src/components/budget/CostBlock.tsx`:

1. Add imports at top:
```typescript
import { ExpenseSuggestionBanner } from '@/components/budget/ExpenseSuggestionBanner';
import type { ExpenseSuggestion } from '@/types/operatingCosts';
```

2. Extend `CostBlockProps` interface (line 9-20) to add:
```typescript
  suggestions?: ExpenseSuggestion[];
  onAcceptSuggestion?: (suggestion: ExpenseSuggestion) => void;
  onSnoozeSuggestion?: (suggestionId: string) => void;
  onDismissSuggestion?: (suggestionId: string) => void;
```

3. Destructure new props in function signature.

4. Insert banner inside `<CollapsibleContent>` at line 100, BEFORE the items div:
```tsx
<CollapsibleContent>
  <div className="px-4 pb-4 space-y-2">
    {/* Suggestion banners */}
    {suggestions && suggestions.length > 0 && onAcceptSuggestion && onSnoozeSuggestion && onDismissSuggestion && (
      <ExpenseSuggestionBanner
        suggestions={suggestions}
        onAccept={onAcceptSuggestion}
        onSnooze={onSnoozeSuggestion}
        onDismiss={onDismissSuggestion}
      />
    )}
    {/* Existing items rendering... */}
```

**Step 2: Wire up in BudgetRunRate page**

In `src/pages/BudgetRunRate.tsx`:

1. Add imports:
```typescript
import { useExpenseSuggestions } from '@/hooks/useExpenseSuggestions';
import type { ExpenseSuggestion } from '@/types/operatingCosts';
```

2. After the existing hook calls (line 33), add:
```typescript
const {
  suggestions,
  dismissSuggestion,
  snoozeSuggestion,
  acceptSuggestion,
} = useExpenseSuggestions(restaurantId);
```

3. Add handler for accepting a suggestion (opens dialog pre-filled):
```typescript
const handleAcceptSuggestion = (suggestion: ExpenseSuggestion) => {
  // Pre-fill the dialog with suggestion data
  const prefilledItem: CostBreakdownItem = {
    id: 'suggestion-prefill', // temporary ID
    name: suggestion.suggestedName,
    category: suggestion.id.split(':')[1] || suggestion.suggestedName.toLowerCase().replace(/\s+/g, '_'),
    daily: suggestion.monthlyAmount / 100 / 30,
    monthly: suggestion.monthlyAmount / 100,
    isPercentage: false,
    source: 'manual',
  };
  setEditingItem(prefilledItem);
  setDialogCostType(suggestion.costType);
  setDialogOpen(true);
  // Record as accepted
  acceptSuggestion(suggestion.id);
};
```

4. Filter suggestions by costType and pass to each CostBlock. For the Fixed Costs block:
```tsx
<CostBlock
  title="Fixed Costs"
  subtitle="Costs that don't change with sales"
  totalDaily={breakEvenData?.fixedCosts.totalDaily || 0}
  items={breakEvenData?.fixedCosts.items || []}
  onAddItem={() => handleAddItem('fixed')}
  onEditItem={handleEditItem}
  onDeleteItem={handleDeleteItem}
  showAddButton
  suggestions={suggestions.filter(s => s.costType === 'fixed')}
  onAcceptSuggestion={handleAcceptSuggestion}
  onSnoozeSuggestion={snoozeSuggestion}
  onDismissSuggestion={dismissSuggestion}
/>
```

Repeat for Utilities (`semi_variable`), Variable (`variable`), and Custom (`custom`) blocks.

**Step 3: Run all tests**

Run: `npm run test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/components/budget/CostBlock.tsx src/pages/BudgetRunRate.tsx
git commit -m "feat: wire expense suggestions into Budget page cost blocks"
```

---

### Task 7: Manual Verification and Polish

**Step 1: Run the dev server**

Run: `npm run dev`

**Step 2: Verify visually**

Navigate to Budget & Run Rate page. If the restaurant has bank transactions, suggestion banners should appear in the relevant cost blocks. If no bank data, the page should render identically to before (no suggestions, no errors).

**Step 3: Verify accept flow**

Click "Add to Budget" on a suggestion → dialog opens pre-filled with name and amount → save → suggestion disappears, cost entry appears.

**Step 4: Verify snooze/dismiss**

Click "Not Now" → banner disappears. Click "Dismiss" → banner disappears permanently.

**Step 5: Run full test suite**

Run: `npm run test`
Expected: ALL PASS

**Step 6: Run lint**

Run: `npm run lint`
Fix any issues introduced by new code.

**Step 7: Final commit if any polish needed**

```bash
git add -A
git commit -m "fix: polish expense suggestions UX"
```

---

### Task 8: Create PR

**Step 1: Push branch and create PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: smart expense suggestions in Budget & Run Rate" --body "..."
```

Include in PR body:
- Summary of what it does
- Link to design doc
- Test plan covering: accept/snooze/dismiss flows, empty state, no bank data gracefully
