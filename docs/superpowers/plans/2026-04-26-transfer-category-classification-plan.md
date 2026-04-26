# Transfer-Category P&L Classification Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bank transactions whose category's `account_type` is `asset|liability|equity` (e.g., "Transfer Clearing Account") must be excluded from monthly Income, Expense, and daily-spending aggregations on the dashboard.

**Architecture:** Approach B (read-path filter). A new `isTransferCategoryType()` helper in `chartOfAccountsUtils.ts` is the single source of truth. Every aggregation that derives P&L from bank transactions / pending outflows / split lines applies the helper after fetch. No write-time changes; no data migration.

**Tech Stack:** TypeScript, React Query, Supabase JS client, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-04-26-transfer-category-classification-design.md`

---

## File Map

| Path | Action |
|---|---|
| `src/lib/chartOfAccountsUtils.ts` | Modify — add `NON_PNL_ACCOUNT_TYPES` const + `isTransferCategoryType()` helper |
| `tests/unit/chartOfAccountsUtils.test.ts` | Modify — add a `describe('isTransferCategoryType', ...)` block |
| `src/lib/expenseDataFetcher.ts` | Modify — widen `chart_of_accounts` shape with `account_type`, add `account_type` to all 3 SELECT projections, filter results through `isTransferCategoryType` |
| `tests/unit/expenseDataFetcher.test.ts` | Create — mocked Supabase, asserts asset/liability/equity-typed rows are excluded from each of the 3 returned arrays |
| `src/hooks/useExpenseHealth.tsx` | Modify — add the missing `.eq('is_transfer', false)`, add `account_type` to projection, exclude transfer-typed rows from revenue + outflow + uncategorized reductions |
| `tests/unit/useExpenseHealth.test.ts` | Create — mocked Supabase, asserts revenue / foodCost / laborCost / uncategorizedSpend exclude transfer-typed rows |
| `src/hooks/useBankTransactions.tsx` | Modify — add `account_type` to the embedded `chart_account` projection (line 140-143) and to the `BankTransaction.chart_account` interface (line 57-60) |
| `src/pages/Index.tsx` | Modify — daily-spending filter at lines 310-318, exclude rows where `chart_account.account_type` is asset/liability/equity |
| `supabase/tests/categorize_transfer_account.sql` | Create — pgTAP test pinning that `categorize_bank_transaction` does NOT touch `is_transfer`, and that the chart_of_accounts join exposes `account_type` |

---

## Task 1: Add `isTransferCategoryType` helper

**Files:**
- Modify: `src/lib/chartOfAccountsUtils.ts`
- Modify: `tests/unit/chartOfAccountsUtils.test.ts`

- [ ] **Step 1.1: Write failing tests**

Append the following block to `tests/unit/chartOfAccountsUtils.test.ts` (inside the existing top-level `describe('chartOfAccountsUtils', ...)`):

```ts
import {
  createDefaultChartOfAccounts,
  DEFAULT_ACCOUNTS,
  isTransferCategoryType,
} from '@/lib/chartOfAccountsUtils';

// ... existing tests ...

  describe('isTransferCategoryType', () => {
    it.each(['asset', 'liability', 'equity'] as const)(
      'returns true for non-P&L type "%s"',
      (type) => {
        expect(isTransferCategoryType(type)).toBe(true);
      },
    );

    it.each(['expense', 'cogs', 'revenue'] as const)(
      'returns false for P&L type "%s"',
      (type) => {
        expect(isTransferCategoryType(type)).toBe(false);
      },
    );

    it('returns false for null', () => {
      expect(isTransferCategoryType(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTransferCategoryType(undefined)).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isTransferCategoryType('')).toBe(false);
    });

    it('returns false for an unknown string', () => {
      expect(isTransferCategoryType('something_else')).toBe(false);
    });
  });
```

(The existing top-level import line `import { createDefaultChartOfAccounts, DEFAULT_ACCOUNTS } from '@/lib/chartOfAccountsUtils';` should be widened to include `isTransferCategoryType` as shown above — replace the existing import; do not duplicate.)

- [ ] **Step 1.2: Run test, watch it fail**

```bash
npm run test -- tests/unit/chartOfAccountsUtils.test.ts
```

Expected: failures referencing `isTransferCategoryType is not a function` (or import error).

- [ ] **Step 1.3: Implement helper**

Append to `src/lib/chartOfAccountsUtils.ts` (after the existing exports):

```ts
import type { AccountType } from '@/hooks/useChartOfAccounts';

const NON_PNL_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
  'asset',
  'liability',
  'equity',
]);

/**
 * Categories whose chart-of-accounts type is asset, liability, or equity
 * are not P&L events — e.g. "Transfer Clearing Account" or "Inter-Account
 * Transfer". The dashboard's income/expense aggregations must exclude them.
 */
export function isTransferCategoryType(
  accountType: string | null | undefined,
): boolean {
  if (!accountType) return false;
  return NON_PNL_ACCOUNT_TYPES.has(accountType as AccountType);
}
```

If `chartOfAccountsUtils.ts` already imports from `@/hooks/useChartOfAccounts` somewhere, just append to that existing import; otherwise add a fresh `import type` line at the top of the file.

- [ ] **Step 1.4: Run tests, watch them pass**

```bash
npm run test -- tests/unit/chartOfAccountsUtils.test.ts
```

Expected: all `isTransferCategoryType` tests pass; existing `createDefaultChartOfAccounts` tests still pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/chartOfAccountsUtils.ts tests/unit/chartOfAccountsUtils.test.ts
git commit -m "feat(coa): add isTransferCategoryType helper for P&L exclusion"
```

---

## Task 2: Filter `expenseDataFetcher` by category type

**Files:**
- Create: `tests/unit/expenseDataFetcher.test.ts`
- Modify: `src/lib/expenseDataFetcher.ts`

- [ ] **Step 2.1: Write failing test**

Create `tests/unit/expenseDataFetcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client BEFORE importing the module under test.
const txnRows = [
  {
    id: 'tx-expense-1',
    transaction_date: '2026-04-15',
    amount: -100,
    status: 'posted',
    description: 'Real expense',
    merchant_name: null,
    normalized_payee: null,
    category_id: 'cat-expense',
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    id: 'tx-transfer-1',
    transaction_date: '2026-04-15',
    amount: -500,
    status: 'posted',
    description: 'Transfer to savings',
    merchant_name: null,
    normalized_payee: null,
    category_id: 'cat-transfer',
    is_split: false,
    ai_confidence: null,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const pendingOutflowRows = [
  {
    amount: 200,
    category_id: 'cat-expense',
    issue_date: '2026-04-10',
    status: 'pending',
    chart_account: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    amount: 800,
    category_id: 'cat-transfer',
    issue_date: '2026-04-10',
    status: 'pending',
    chart_account: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const splitRows = [
  {
    transaction_id: 'tx-split-parent',
    amount: 50,
    category_id: 'cat-expense',
    chart_of_accounts: {
      account_name: 'Office Supplies',
      account_subtype: 'office_supplies',
      account_type: 'expense',
    },
  },
  {
    transaction_id: 'tx-split-parent',
    amount: 70,
    category_id: 'cat-equity',
    chart_of_accounts: {
      account_name: 'Inter-Account Transfer',
      account_subtype: 'owners_equity',
      account_type: 'equity',
    },
  },
];

// We need the mocked builder to be readable by the test, so define it once
// and reuse across the three .from() calls.
function makeQuery(returnRows: unknown) {
  const order = vi.fn().mockResolvedValue({ data: returnRows, error: null });
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const m of ['select', 'eq', 'in', 'is', 'lt', 'lte', 'gte']) {
    builder[m] = vi.fn(passthrough);
  }
  builder.order = order;
  // For pending_outflows / splits the call doesn't end in .order — return data directly.
  // We make these chainable methods also resolve when awaited as the terminal call.
  for (const m of ['eq', 'in', 'is', 'lte', 'gte']) {
    (builder[m] as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Object.assign(builder, {
        then: (cb: (v: { data: unknown; error: null }) => unknown) =>
          cb({ data: returnRows, error: null }),
      }),
    );
  }
  return builder;
}

vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'bank_transactions') return makeQuery(txnRows);
        if (table === 'pending_outflows') return makeQuery(pendingOutflowRows);
        if (table === 'bank_transaction_splits') return makeQuery(splitRows);
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
});

import { fetchExpenseData } from '@/lib/expenseDataFetcher';

describe('fetchExpenseData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes bank transactions whose category is asset/liability/equity-typed', async () => {
    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const ids = result.transactions.map((t) => t.id);
    expect(ids).toContain('tx-expense-1');
    expect(ids).not.toContain('tx-transfer-1');
  });

  it('excludes pending outflows whose category is asset/liability/equity-typed', async () => {
    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const amounts = result.pendingOutflows.map((p) => p.amount);
    expect(amounts).toContain(200);
    expect(amounts).not.toContain(800);
  });

  it('excludes split line items whose category is asset/liability/equity-typed', async () => {
    // Make the parent appear as a split-parent so split lookup runs.
    txnRows.push({
      id: 'tx-split-parent',
      transaction_date: '2026-04-15',
      amount: -120,
      status: 'posted',
      description: 'Split parent',
      merchant_name: null,
      normalized_payee: null,
      category_id: null,
      is_split: true,
      ai_confidence: null,
      chart_of_accounts: null,
    } as never);

    const result = await fetchExpenseData({
      restaurantId: 'r-1',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    });

    const splitAmounts = result.splitDetails.map((s) => s.amount);
    expect(splitAmounts).toContain(50);
    expect(splitAmounts).not.toContain(70);

    txnRows.pop();
  });
});
```

- [ ] **Step 2.2: Run test, watch it fail**

```bash
npm run test -- tests/unit/expenseDataFetcher.test.ts
```

Expected: failures because `tx-transfer-1` IS in `result.transactions` (and similar for pendingOutflows / splits). The fetcher hasn't been taught to filter on `account_type` yet.

- [ ] **Step 2.3: Implement the fix in `src/lib/expenseDataFetcher.ts`**

Three concrete edits:

(a) **Widen the three interfaces** at the top of the file:

```ts
export interface ExpenseTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  status: string;
  description: string;
  merchant_name: string | null;
  normalized_payee: string | null;
  category_id: string | null;
  is_split: boolean;
  ai_confidence: string | null;
  chart_of_accounts: {
    account_name: string;
    account_subtype: string;
    account_type: string;
  } | null;
}

export interface PendingOutflowRecord {
  amount: number;
  category_id: string | null;
  issue_date: string;
  status: string;
  chart_account: {
    account_name: string;
    account_subtype: string;
    account_type: string;
  } | null;
}

export interface SplitDetail {
  transaction_id: string;
  amount: number;
  category_id: string;
  chart_of_accounts: {
    account_name: string;
    account_subtype: string;
    account_type: string;
  } | null;
}
```

(b) **Add `account_type` to all three SELECT projections.** In `fetchExpenseData`:

```ts
// transactions
.select(`
  id,
  transaction_date,
  amount,
  status,
  description,
  merchant_name,
  normalized_payee,
  category_id,
  is_split,
  ai_confidence,
  chart_of_accounts!category_id(account_name, account_subtype, account_type)
`)
```

```ts
// pending outflows
.select(`
  amount,
  category_id,
  issue_date,
  status,
  chart_account:chart_of_accounts!category_id(account_name, account_subtype, account_type)
`)
```

```ts
// splits
.select(`
  transaction_id,
  amount,
  category_id,
  chart_of_accounts:chart_of_accounts!category_id(account_name, account_subtype, account_type)
`)
```

(c) **Filter results before returning.** Add an import at the top:

```ts
import { isTransferCategoryType } from '@/lib/chartOfAccountsUtils';
```

Then, immediately after each fetch result is captured, filter it. Concretely:

After `const txns = (transactions || []) as ExpenseTransaction[];`:

```ts
const filteredTxns = txns.filter(
  (t) => !isTransferCategoryType(t.chart_of_accounts?.account_type),
);
```

After `const pendingOutflowRecords = (pendingOutflows || []) as PendingOutflowRecord[];`:

```ts
const filteredPendingOutflows = pendingOutflowRecords.filter(
  (p) => !isTransferCategoryType(p.chart_account?.account_type),
);
```

After `splitDetails = (splits || []) as SplitDetail[];`:

```ts
splitDetails = splitDetails.filter(
  (s) => !isTransferCategoryType(s.chart_of_accounts?.account_type),
);
```

Replace the **previously-used local names** (`txns`, `pendingOutflowRecords`) in the rest of the function with `filteredTxns` and `filteredPendingOutflows`. Specifically:

- `currentPeriodTxns = filteredTxns.filter(...)`
- The `splitParentIds` derivation must read from `filteredTxns`
- The two `txns.filter(...)` calls inside the `includePreviousPeriod` block become `filteredTxns.filter(...)`
- Both `return` statements use `filteredTxns` and `filteredPendingOutflows` (the variable names in the returned object stay `transactions`, `pendingOutflows`, `splitDetails` — those are the public API).

Update the JSDoc comment on `fetchExpenseData` to mention the new exclusion:

```ts
/**
 * ...
 * - Transfer exclusion (is_transfer = false) AND category type exclusion
 *   (asset / liability / equity categories are not P&L events)
 * ...
 */
```

- [ ] **Step 2.4: Run test, watch it pass**

```bash
npm run test -- tests/unit/expenseDataFetcher.test.ts
```

Expected: all 3 cases pass.

- [ ] **Step 2.5: Run downstream tests for regressions**

```bash
npm run test -- tests/unit/
```

Expected: no new failures. (Existing tests for `useMonthlyExpenses`, `Index`, etc., are not directly testing the fetcher — they should remain green.)

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/expenseDataFetcher.ts tests/unit/expenseDataFetcher.test.ts
git commit -m "fix(dashboard): exclude transfer-typed categories from expense aggregations"
```

---

## Task 3: Fix `useExpenseHealth` (revenue + outflow + uncategorized)

**Files:**
- Create: `tests/unit/useExpenseHealth.test.ts`
- Modify: `src/hooks/useExpenseHealth.tsx`

- [ ] **Step 3.1: Write failing test**

Create `tests/unit/useExpenseHealth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockTxns = [
  // Real revenue
  {
    transaction_date: '2026-04-10',
    amount: 1000,
    status: 'posted',
    description: 'Sales deposit',
    merchant_name: null,
    category_id: 'cat-revenue',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Sales',
      account_subtype: 'food_revenue',
      account_type: 'revenue',
    },
  },
  // Inflow that's actually a transfer (should NOT be revenue)
  {
    transaction_date: '2026-04-11',
    amount: 500,
    status: 'posted',
    description: 'Transfer in from savings',
    merchant_name: null,
    category_id: 'cat-transfer',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
  // Real food cost
  {
    transaction_date: '2026-04-12',
    amount: -200,
    status: 'posted',
    description: 'Vendor invoice',
    merchant_name: null,
    category_id: 'cat-cogs',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Food Cost',
      account_subtype: 'cost_of_goods_sold',
      account_type: 'expense',
    },
  },
  // Outflow that's actually a transfer (should NOT count as expense)
  {
    transaction_date: '2026-04-13',
    amount: -700,
    status: 'posted',
    description: 'Transfer to savings',
    merchant_name: null,
    category_id: 'cat-transfer',
    is_split: false,
    chart_of_accounts: {
      account_name: 'Transfer Clearing Account',
      account_subtype: 'cash',
      account_type: 'asset',
    },
  },
];

const lteSpy = vi.fn();
const gteSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn((...args) => {
    eqSpy(...args);
    return builder;
  });
  builder.in = vi.fn((...args) => {
    inSpy(...args);
    return builder;
  });
  builder.gte = vi.fn((...args) => {
    gteSpy(...args);
    return builder;
  });
  builder.lte = vi.fn((...args) => {
    lteSpy(...args);
    return Promise.resolve({ data: mockTxns, error: null });
  });
  return {
    supabase: {
      from: vi.fn(() => builder),
    },
  };
});

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r-1' },
  }),
}));

import { useExpenseHealth } from '@/hooks/useExpenseHealth';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useExpenseHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies is_transfer = false in the query', async () => {
    renderHook(
      () => useExpenseHealth(new Date('2026-04-01'), new Date('2026-04-30')),
      { wrapper },
    );

    await waitFor(() => {
      expect(eqSpy).toHaveBeenCalledWith('is_transfer', false);
    });
  });

  it('excludes asset/liability/equity inflows from revenue and outflows from cost totals', async () => {
    const { result } = renderHook(
      () => useExpenseHealth(new Date('2026-04-01'), new Date('2026-04-30')),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    // Revenue should be 1000 (the +500 transfer is excluded).
    // foodCost / revenue = 200 / 1000 = 20%
    expect(data.foodCostPercentage).toBeCloseTo(20, 5);
    // The +500 transfer must NOT have inflated revenue (else foodCostPct would be ~13.3%).
    expect(data.foodCostPercentage).not.toBeCloseTo(200 / 1500 * 100, 2);
  });
});
```

- [ ] **Step 3.2: Run test, watch it fail**

```bash
npm run test -- tests/unit/useExpenseHealth.test.ts
```

Expected: both tests fail. (`is_transfer` filter not applied; revenue includes the transfer inflow.)

- [ ] **Step 3.3: Implement the fix in `src/hooks/useExpenseHealth.tsx`**

(a) Add the import:

```ts
import { isTransferCategoryType } from '@/lib/chartOfAccountsUtils';
```

(b) Update the query at lines 45-51 — add the missing `is_transfer` filter and `account_type` to the projection:

```ts
let txQuery = supabase
  .from('bank_transactions')
  .select('transaction_date, amount, status, description, merchant_name, category_id, is_split, chart_of_accounts!category_id(account_name, account_subtype, account_type)')
  .eq('restaurant_id', selectedRestaurant.restaurant_id)
  .in('status', ['posted', 'pending'])
  .eq('is_transfer', false)
  .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
  .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));
```

(c) After `const txns = transactions || [];`, add:

```ts
const pnlTxns = txns.filter(
  (t) => !isTransferCategoryType(t.chart_of_accounts?.account_type),
);
```

(d) Replace `txns` with `pnlTxns` in every downstream filter inside this function — namely the `revenue`, `foodCost`, `laborCost`, `processingFees`, and `outflows` reductions. The `txns.filter(...)` calls become `pnlTxns.filter(...)`. The `txns` variable itself can be left in place (it's still useful for the count if any future logic needs it), but every numeric reduction must be over `pnlTxns`.

- [ ] **Step 3.4: Run test, watch it pass**

```bash
npm run test -- tests/unit/useExpenseHealth.test.ts
```

Expected: both tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/hooks/useExpenseHealth.tsx tests/unit/useExpenseHealth.test.ts
git commit -m "fix(dashboard): is_transfer + transfer-typed exclusion in expense health"
```

---

## Task 4: Fix daily-spending filter on `Index.tsx`

**Files:**
- Modify: `src/hooks/useBankTransactions.tsx`
- Modify: `src/pages/Index.tsx`

This task widens the `useBankTransactions` hook to expose `chart_account.account_type`, then uses it in the daily-spending filter. There is no dedicated unit test for this filter (it's an inline `useMemo` inside `Index.tsx`); the existing `useExpenseHealth` and `expenseDataFetcher` tests cover the calculation pattern.

- [ ] **Step 4.1: Widen `BankTransaction.chart_account` interface**

`src/hooks/useBankTransactions.tsx` lines 57-60 — replace:

```ts
chart_account?: {
  id: string;
  account_name: string;
} | null;
```

with:

```ts
chart_account?: {
  id: string;
  account_name: string;
  account_type: string | null;
} | null;
```

- [ ] **Step 4.2: Add `account_type` to the SELECT projection**

`src/hooks/useBankTransactions.tsx` lines 140-143 — replace:

```ts
chart_account:chart_of_accounts!category_id(
  id,
  account_name
),
```

with:

```ts
chart_account:chart_of_accounts!category_id(
  id,
  account_name,
  account_type
),
```

- [ ] **Step 4.3: Update daily-spending filter in `Index.tsx`**

Add the import at the top of `src/pages/Index.tsx` (alongside other `@/lib` imports):

```ts
import { isTransferCategoryType } from '@/lib/chartOfAccountsUtils';
```

Replace the filter at lines 310-318:

```ts
const expenses = allTransactions.filter(t => {
  const transactionDate = new Date(t.transaction_date);
  return (
    t.amount < 0 && // Expenses are negative
    !t.is_transfer && // Exclude paired transfers
    !isTransferCategoryType(t.chart_account?.account_type) && // Exclude asset/liability/equity-categorized
    !t.excluded_reason && // Exclude transactions marked as excluded
    transactionDate >= thirtyDaysAgo // Last 30 days only
  );
});
```

- [ ] **Step 4.4: Verify typecheck and tests still pass**

```bash
npm run typecheck && npm run test -- tests/unit/
```

Expected: no errors. (`chart_account.account_type` is additive; consumers that don't read it are unaffected.)

- [ ] **Step 4.5: Commit**

```bash
git add src/hooks/useBankTransactions.tsx src/pages/Index.tsx
git commit -m "fix(dashboard): exclude transfer-typed categories from daily spending filter"
```

---

## Task 5: pgTAP test pinning RPC contract

**Files:**
- Create: `supabase/tests/categorize_transfer_account.sql`

This test documents the *current* write-time behavior the read-path fix relies on: `categorize_bank_transaction` does NOT auto-set `is_transfer`. If a future change starts setting it, this test fails and a reviewer is forced to update both the read-path filter and this test together.

- [ ] **Step 5.1: Write the pgTAP test**

Create `supabase/tests/categorize_transfer_account.sql`:

```sql
-- File: supabase/tests/categorize_transfer_account.sql
-- Description: Pins write-time contract that categorize_bank_transaction does
-- NOT touch is_transfer when assigning an asset/equity category. The dashboard
-- read-path (expenseDataFetcher) relies on this — if the RPC starts setting
-- is_transfer automatically, both this test and the read-path filter need
-- to be revisited together.

BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000201"}';

-- Fixture: user, restaurant, membership
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000201', 'transfer-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000299', 'Transfer Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000299', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Chart of accounts: one expense account, one transfer (asset) account
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance) VALUES
  ('00000000-0000-0000-0000-000000000251', '00000000-0000-0000-0000-000000000299', '5000', 'Office Supplies', 'expense', 'office_supplies', 'debit'),
  ('00000000-0000-0000-0000-000000000252', '00000000-0000-0000-0000-000000000299', '1050', 'Transfer Clearing Account', 'asset', 'cash', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Connected bank + bank transaction fixture
INSERT INTO connected_banks (id, restaurant_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000299', 'Test Bank', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, transaction_date, amount, description, status, is_categorized, is_transfer
) VALUES (
  '00000000-0000-0000-0000-000000000271',
  '00000000-0000-0000-0000-000000000299',
  '00000000-0000-0000-0000-000000000261',
  '2026-04-15', -500, 'Move to savings', 'posted', false, false
)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = false,
  is_transfer = false,
  category_id = NULL;

-- TEST 1: chart_of_accounts row exposes account_type for joined reads
SELECT is(
  (SELECT account_type::text FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000000252'),
  'asset',
  'Transfer Clearing Account is account_type=asset (read-path filter relies on this)'
);

-- TEST 2: Calling categorize_bank_transaction on the transfer account does not raise
SELECT lives_ok(
  $$ SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000271'::uuid,
       '00000000-0000-0000-0000-000000000252'::uuid,
       NULL, NULL, NULL
     ) $$,
  'categorize_bank_transaction succeeds when assigning a Transfer (asset) category'
);

-- TEST 3: After categorization, category_id is set and is_categorized is true
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000271'),
  '00000000-0000-0000-0000-000000000252'::uuid,
  'category_id is updated to the transfer-clearing account'
);

-- TEST 4: is_transfer remains false (the bug surface — RPC does NOT auto-set this)
SELECT is(
  (SELECT is_transfer FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000271'),
  false,
  'is_transfer remains false after asset-typed categorization (read-path must filter on account_type)'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5.2: Run pgTAP**

```bash
npm run test:db
```

Expected: all 4 assertions pass. If `connected_banks` schema requires more columns than `id, restaurant_id, institution_name, status` in the local schema, adjust the INSERT to satisfy NOT NULL constraints — the runner will print which column is missing.

- [ ] **Step 5.3: Commit**

```bash
git add supabase/tests/categorize_transfer_account.sql
git commit -m "test(db): pin categorize_bank_transaction does not touch is_transfer"
```

---

## Self-Review Checklist (verify before marking plan complete)

| Spec section | Implemented in |
|---|---|
| `isTransferCategoryType` helper | Task 1 |
| `expenseDataFetcher` widening + filtering | Task 2 |
| `useExpenseHealth` is_transfer + filter | Task 3 |
| `Index.tsx` daily-spending filter | Task 4 |
| pgTAP RPC contract test | Task 5 |
| Type widening of `chart_of_accounts` shape | Tasks 2 & 4 (additive `account_type` field) |

No placeholders. Each step contains the actual code or actual command. Helper name `isTransferCategoryType` is consistent across all 5 tasks.
