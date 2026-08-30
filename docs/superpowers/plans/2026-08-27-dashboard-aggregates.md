# Dashboard Aggregates Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard pills, the cashflow view, and the monthly table agree, and add guardrails against the 1,000-row cap.

**Architecture:** Every high-volume dashboard query moves to `fetchAllRows` pagination. A shared helper (`fetchFinancialCOGSRows`) gives the period view and the monthly view one financial COGS fetch. One labor formula (`calculateActualLaborCostForRange`) replaces the two divergent labor totals. A `capped` flag and a `warnings` list surface partial data in the UI. Basis labels tell the user which accounting basis each section uses.

**Tech Stack:** React 18, TypeScript, React Query, Supabase (PostgREST), Vitest, Playwright, ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-08-27-dashboard-aggregates-design.md`

**Execution note:** This repo's `development-workflow` runs this plan through the `dev-build-and-ship` workflow (Phases 4–9). The REQUIRED SUB-SKILL line above applies only when a generic agent runs the plan outside that workflow.

## Global Constraints

- Write every word in STE-aligned English (ASD-STE100). This includes commit messages, comments, and warning text.
- Work on branch `fix/dashboard-aggregates` in the worktree at `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates`. Run every command from that worktree root.
- Never commit to `main`. Stage explicit paths only. Never run `git add -A`.
- End every commit with a second `-m` flag: `-m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`.
- Use semantic color tokens only. Exception: the amber warning panel (`bg-amber-500/10 border-amber-500/20`) matches the CLAUDE.md "AI suggestion panel" pattern and is spec-approved.
- New UI must handle the three states: loading, error, empty.
- Use React Query with `staleTime: 30000`. No manual caching.
- Every `.range()` fetch needs a deterministic sort. Add `.order('id')` as a tiebreaker after the time column. Use `.order('id')` alone for `bank_transaction_splits` and `tip_split_items`.
- Keep labor and tip math in integer cents. Keep COGS aggregation in dollars. Convert cents to dollars only at the final return.
- Pass `{ maxPages: COGS_MAX_PAGES }` (50 pages) to `fetchAllRows` for COGS fetch sites. All other sites keep the default 20 pages.
- A `capped: true` result is NOT an error. Show a `role="status"` warning next to the partial figure. A thrown fetch error is fatal: React Query reports it and the UI shows a `role="alert"` message.
- Do not change RPCs or SQL in this PR. The server-side RPC work is PR 2.
- Keep the exact existing query filters when you convert a query to `fetchAllRows`. Only the limit/pagination and the sort tiebreaker change.

## Warning Strings

Use these exact strings in the implementation and in the tests. Do not paraphrase them.

| Site | String |
|------|--------|
| Tips capped (monthly) | `The tip rows hit the fetch limit. The labor cost and tips figures are incomplete.` |
| Inventory capped (monthly) | `The inventory usage rows hit the fetch limit. The food cost figure is incomplete.` |
| Financial COGS capped (monthly) | `The financial COGS rows hit the fetch limit. The food cost figure is incomplete.` |
| Bank labor capped (monthly) | `The labor bank transactions hit the fetch limit. The paid labor figure is incomplete.` |
| Pending labor capped (monthly) | `The pending labor rows hit the fetch limit. The paid labor figure is incomplete.` |
| Punches capped (monthly) | `The time punches hit the fetch limit. The labor cost figure is incomplete.` |
| Manual payments failed (monthly) | `The manual labor payments failed to load. The labor cost figure can show a low value.` |
| Unified sales RPC failed (monthly, per month) | `` `The POS sales total for ${monthKey} failed to load. The collected amount uses the fallback formula.` `` |
| Period pills capped (Index) | `Some cost rows hit the fetch limit. The cost figures for this period can show low values.` |

---

### Task 1: DataCompletenessWarning component

**Files:**
- Create: `src/components/DataCompletenessWarning.tsx`
- Test: `tests/unit/DataCompletenessWarning.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `AlertTriangle` from `lucide-react`.
- Produces: `DataCompletenessWarning({ message: string; className?: string })` — a React component. It renders a `role="status"` amber panel, or `null` when `message` is empty. Tasks 6 and 10 import it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/DataCompletenessWarning.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DataCompletenessWarning } from '@/components/DataCompletenessWarning';

describe('DataCompletenessWarning', () => {
  it('renders the message in a role="status" panel', () => {
    const { container } = render(
      <DataCompletenessWarning message="Some rows hit the fetch limit." />
    );
    const panel = container.querySelector('[role="status"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Some rows hit the fetch limit.');
  });

  it('hides the icon from screen readers', () => {
    const { container } = render(
      <DataCompletenessWarning message="Some rows hit the fetch limit." />
    );
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders nothing for an empty message', () => {
    const { container } = render(<DataCompletenessWarning message="" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/DataCompletenessWarning.test.tsx`
Expected: FAIL — the module `@/components/DataCompletenessWarning` does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/DataCompletenessWarning.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface DataCompletenessWarningProps {
  message: string;
  className?: string;
}

export const DataCompletenessWarning = ({ message, className }: DataCompletenessWarningProps) => {
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[13px] text-foreground">{message}</p>
    </div>
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/DataCompletenessWarning.test.tsx`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/components/DataCompletenessWarning.tsx tests/unit/DataCompletenessWarning.test.tsx && git commit -m "feat(dashboard): add the DataCompletenessWarning component" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Shared financial COGS fetch helper

**Files:**
- Create: `src/services/cogsFetch.ts`
- Test: `tests/unit/cogsFetch.test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `@/utils/fetchAllRows` (signature: `fetchAllRows<T>(buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, opts?: { pageSize?: number; maxPages?: number }): Promise<{ rows: T[]; capped: boolean }>`); `toUtcDayKey`, `type BankTransactionRow`, `type PendingOutflowRow`, `type SplitItemRow` from `@/services/cogsCalculations`.
- Produces: `COGS_MAX_PAGES = 50` (a named export) and `fetchFinancialCOGSRows(client: SupabaseClient, restaurantId: string, startDateStr: string, endDateStr: string): Promise<FinancialCOGSRows>` where `FinancialCOGSRows = { bankTxns: BankTransactionRow[]; splitItems: SplitItemRow[]; parentDateMap: Map<string, string>; pendingTxns: PendingOutflowRow[]; capped: boolean }`. Tasks 3, 4, and 6 import these.

Warning: the `client` parameter uses the untyped `SupabaseClient` generic on purpose. Inside the helper, query results are `any`, so the `fetchAllRows<T>` generics type-check. The typed app client is assignable to this parameter. `fetchMonthRevenueTotals` in `src/hooks/useMonthlyMetrics.tsx` proves this exact pattern in this codebase.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cogsFetch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { COGS_MAX_PAGES, fetchFinancialCOGSRows } from '@/services/cogsFetch';

const BANK_SELECT = 'transaction_date, amount, chart_of_accounts!category_id(account_subtype)';
const PARENT_SELECT = 'id, transaction_date';
const SPLIT_SELECT = 'transaction_id, amount, chart_of_accounts!category_id(account_subtype)';
const PENDING_SELECT = 'issue_date, amount, chart_of_accounts!category_id(account_subtype)';

const bankRow = {
  transaction_date: '2026-08-01',
  amount: -40,
  chart_of_accounts: { account_subtype: 'food_cost' },
};

type Page = unknown[];

interface TableSpec {
  pages: Page[];
  calls: Array<[string, ...unknown[]]>;
  ranges: Array<[number, number]>;
}

const spec = (pages: Page[]): TableSpec => ({ pages, calls: [], ranges: [] });

// Query specs are keyed by `${table}|${selectColumns}`, because the helper
// runs two different queries against bank_transactions.
function makeClient(specs: Record<string, TableSpec>): SupabaseClient {
  const from = (table: string) => {
    let active: TableSpec | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.select = (columns: string) => {
      active = specs[`${table}|${columns}`];
      if (!active) throw new Error(`unexpected query: ${table}|${columns}`);
      return chain;
    };
    ['eq', 'in', 'is', 'lt', 'gte', 'lte', 'order'].forEach((method) => {
      chain[method] = (...args: unknown[]) => {
        active?.calls.push([method, ...args]);
        return chain;
      };
    });
    chain.range = (fromIdx: number, toIdx: number) => {
      active?.ranges.push([fromIdx, toIdx]);
      const page = active?.pages.shift() ?? [];
      return Promise.resolve({ data: page, error: null });
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

describe('fetchFinancialCOGSRows', () => {
  it('pages all four sources, keeps the filters, and maps parent dates', async () => {
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([Array(1000).fill(bankRow), [bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([
        [{ id: 'parent-1', transaction_date: '2026-08-03T00:00:00' }],
      ]),
      [`bank_transaction_splits|${SPLIT_SELECT}`]: spec([
        [{ transaction_id: 'parent-1', amount: -12, chart_of_accounts: { account_subtype: 'food_cost' } }],
      ]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([
        [{ issue_date: '2026-08-04', amount: -9, chart_of_accounts: { account_subtype: 'beverage_cost' } }],
      ]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.bankTxns).toHaveLength(1001);
    expect(specs[`bank_transactions|${BANK_SELECT}`].ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(result.parentDateMap.get('parent-1')).toBe('2026-08-03');
    expect(result.splitItems).toHaveLength(1);
    expect(result.pendingTxns).toHaveLength(1);
    expect(result.capped).toBe(false);

    expect(specs[`bank_transactions|${BANK_SELECT}`].calls).toEqual(
      expect.arrayContaining([
        ['eq', 'restaurant_id', 'rest-1'],
        ['in', 'status', ['posted', 'pending']],
        ['eq', 'is_transfer', false],
        ['eq', 'is_split', false],
        ['lt', 'amount', 0],
      ])
    );
    expect(specs[`pending_outflows|${PENDING_SELECT}`].calls).toEqual(
      expect.arrayContaining([
        ['in', 'status', ['pending', 'stale_30', 'stale_60', 'stale_90']],
        ['is', 'linked_bank_transaction_id', null],
      ])
    );
  });

  it('skips the splits query when there are no split parents', async () => {
    // No spec entry exists for bank_transaction_splits: a query against it
    // would throw "unexpected query".
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec([[bankRow]]),
      [`bank_transactions|${PARENT_SELECT}`]: spec([[]]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.splitItems).toEqual([]);
    expect(result.parentDateMap.size).toBe(0);
    expect(result.capped).toBe(false);
  });

  it('reports capped when a source exhausts the page budget', async () => {
    const specs = {
      [`bank_transactions|${BANK_SELECT}`]: spec(
        Array.from({ length: COGS_MAX_PAGES + 5 }, () => Array(1000).fill(bankRow))
      ),
      [`bank_transactions|${PARENT_SELECT}`]: spec([[]]),
      [`pending_outflows|${PENDING_SELECT}`]: spec([[]]),
    };

    const result = await fetchFinancialCOGSRows(makeClient(specs), 'rest-1', '2026-08-01', '2026-08-31');

    expect(result.capped).toBe(true);
    expect(specs[`bank_transactions|${BANK_SELECT}`].ranges).toHaveLength(COGS_MAX_PAGES);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/cogsFetch.test.ts`
Expected: FAIL — the module `@/services/cogsFetch` does not exist.

- [ ] **Step 3: Write the helper**

Create `src/services/cogsFetch.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  toUtcDayKey,
  type BankTransactionRow,
  type PendingOutflowRow,
  type SplitItemRow,
} from '@/services/cogsCalculations';
import { fetchAllRows } from '@/utils/fetchAllRows';

// COGS windows can exceed the default 20-page budget (a 90-day window held
// 31,813 inventory rows in production). 50 pages covers 50,000 rows.
export const COGS_MAX_PAGES = 50;

export interface FinancialCOGSRows {
  bankTxns: BankTransactionRow[];
  splitItems: SplitItemRow[];
  parentDateMap: Map<string, string>;
  pendingTxns: PendingOutflowRow[];
  capped: boolean;
}

interface SplitParentRow {
  id: string;
  transaction_date: string;
}

// One financial COGS fetch for useCOGSFromFinancials and useMonthlyMetrics.
// The `client` parameter stays on the untyped SupabaseClient generic so the
// fetchAllRows<T> generics type-check (see fetchMonthRevenueTotals).
export async function fetchFinancialCOGSRows(
  client: SupabaseClient,
  restaurantId: string,
  startDateStr: string,
  endDateStr: string
): Promise<FinancialCOGSRows> {
  const bank = await fetchAllRows<BankTransactionRow>(
    (from, to) =>
      client
        .from('bank_transactions')
        .select('transaction_date, amount, chart_of_accounts!category_id(account_subtype)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['posted', 'pending'])
        .eq('is_transfer', false)
        .eq('is_split', false)
        .lt('amount', 0)
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .order('transaction_date', { ascending: true })
        .order('id')
        .range(from, to),
    { maxPages: COGS_MAX_PAGES }
  );

  const parents = await fetchAllRows<SplitParentRow>(
    (from, to) =>
      client
        .from('bank_transactions')
        .select('id, transaction_date')
        .eq('restaurant_id', restaurantId)
        .eq('is_split', true)
        .in('status', ['posted', 'pending'])
        .eq('is_transfer', false)
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .order('transaction_date', { ascending: true })
        .order('id')
        .range(from, to),
    { maxPages: COGS_MAX_PAGES }
  );

  const parentDateMap = new Map<string, string>();
  for (const parent of parents.rows) {
    parentDateMap.set(parent.id, toUtcDayKey(parent.transaction_date));
  }

  let splits: { rows: SplitItemRow[]; capped: boolean } = { rows: [], capped: false };
  if (parents.rows.length > 0) {
    const parentIds = parents.rows.map((parent) => parent.id);
    splits = await fetchAllRows<SplitItemRow>(
      (from, to) =>
        client
          .from('bank_transaction_splits')
          .select('transaction_id, amount, chart_of_accounts!category_id(account_subtype)')
          .in('transaction_id', parentIds)
          .order('id')
          .range(from, to),
      { maxPages: COGS_MAX_PAGES }
    );
  }

  const pending = await fetchAllRows<PendingOutflowRow>(
    (from, to) =>
      client
        .from('pending_outflows')
        .select('issue_date, amount, chart_of_accounts!category_id(account_subtype)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .is('linked_bank_transaction_id', null)
        .gte('issue_date', startDateStr)
        .lte('issue_date', endDateStr)
        .order('issue_date', { ascending: true })
        .order('id')
        .range(from, to),
    { maxPages: COGS_MAX_PAGES }
  );

  return {
    bankTxns: bank.rows,
    splitItems: splits.rows,
    parentDateMap,
    pendingTxns: pending.rows,
    capped: bank.capped || parents.capped || splits.capped || pending.capped,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/cogsFetch.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/services/cogsFetch.ts tests/unit/cogsFetch.test.ts && git commit -m "feat(cogs): add the paged financial COGS fetch helper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Page the inventory COGS fetch in useFoodCosts

**Files:**
- Modify: `src/hooks/useFoodCosts.tsx` (79 lines; the queryFn and the return block)
- Test: `tests/unit/useFoodCosts.pagination.test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `@/utils/fetchAllRows`; `COGS_MAX_PAGES` from `@/services/cogsFetch` (Task 2); `aggregateInventoryCOGSByDate`, `type InventoryTransactionRow` from `@/services/cogsCalculations`.
- Produces: `FoodCostsResult` gains `capped: boolean`. Task 5 (`useUnifiedCOGS`) reads `inventoryCosts.capped`.

Warning: keep the two `.or()` date filters byte-for-byte identical to the current code. A changed filter changes which rows count as COGS.

Note: `src/hooks/useFoodCosts.tsx` is in the ESLint migration allowlist, so its `format(dateFrom, 'yyyy-MM-dd')` calls stay exempt from the restaurant-clock rules.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useFoodCosts.pagination.test.ts`:

```typescript
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const page0 = Array.from({ length: 1000 }, () => ({
  created_at: '2026-08-01T12:00:00Z',
  transaction_date: '2026-08-01',
  total_cost: 1,
}));
const page1 = Array.from({ length: 5 }, () => ({
  created_at: '2026-08-02T12:00:00Z',
  transaction_date: '2026-08-02',
  total_cost: 1,
}));

const rangeCalls: Array<[number, number]> = [];
const orderCalls: unknown[][] = [];
let callIndex = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inventoryChain: any = {};
['select', 'eq', 'or'].forEach((m) => {
  inventoryChain[m] = vi.fn(() => inventoryChain);
});
inventoryChain.order = vi.fn((...args: unknown[]) => {
  orderCalls.push(args);
  return inventoryChain;
});
inventoryChain.range = vi.fn((from: number, to: number) => {
  rangeCalls.push([from, to]);
  const page = callIndex === 0 ? page0 : callIndex === 1 ? page1 : [];
  callIndex++;
  return Promise.resolve({ data: page, error: null });
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => inventoryChain },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useFoodCosts pagination', () => {
  beforeEach(() => {
    rangeCalls.length = 0;
    orderCalls.length = 0;
    callIndex = 0;
  });

  it('pages inventory_transactions with .range() and a deterministic sort', async () => {
    const { useFoodCosts } = await import('@/hooks/useFoodCosts');

    const { result } = renderHook(
      () => useFoodCosts('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.current.totalCost).toBe(1005);
    expect(result.current.capped).toBe(false);
    // buildPage runs once per page, so duplicate order calls are expected.
    expect(orderCalls).toEqual(
      expect.arrayContaining([['created_at', { ascending: true }], ['id']])
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useFoodCosts.pagination.test.ts`
Expected: FAIL — the current hook calls `.limit(10000)`, which the mock chain does not define (TypeError), and `capped` does not exist on the result.

- [ ] **Step 3: Convert the hook to fetchAllRows**

In `src/hooks/useFoodCosts.tsx`:

Add these imports (keep the existing ones):

```typescript
import { COGS_MAX_PAGES } from '@/services/cogsFetch';
import { fetchAllRows } from '@/utils/fetchAllRows';
```

Add `type InventoryTransactionRow` to the existing `@/services/cogsCalculations` import.

Add `capped: boolean;` to the `FoodCostsResult` interface.

Replace the body of the queryFn (the part that builds the query, throws on error, and aggregates) with:

```typescript
const fromStr = format(dateFrom, 'yyyy-MM-dd');
const toStr = format(dateTo, 'yyyy-MM-dd');

const { rows, capped } = await fetchAllRows<InventoryTransactionRow>(
  (from, to) =>
    supabase
      .from('inventory_transactions')
      .select('created_at, transaction_date, total_cost')
      .eq('restaurant_id', restaurantId)
      .eq('transaction_type', 'usage')
      .or(`transaction_date.gte.${fromStr},and(transaction_date.is.null,created_at.gte.${fromStr})`)
      .or(`transaction_date.lte.${toStr},and(transaction_date.is.null,created_at.lte.${toStr}T23:59:59.999Z)`)
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  { maxPages: COGS_MAX_PAGES }
);

const dailyMap = aggregateInventoryCOGSByDate(rows);
```

Keep the existing map/sort/reduce tail that builds `dailyCosts` and `totalCost` from `dailyMap`. Change the queryFn's return to `return { dailyCosts, totalCost, capped };`. The select no longer requests `transaction_type` — the `.eq('transaction_type', 'usage')` filter makes the column redundant in the payload.

In the hook's return block, add `capped: data?.capped ?? false,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/useFoodCosts.pagination.test.ts`
Expected: PASS — 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useFoodCosts.tsx tests/unit/useFoodCosts.pagination.test.ts && git commit -m "fix(cogs): page the inventory COGS fetch in useFoodCosts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Use the paged helper in useCOGSFromFinancials

**Files:**
- Modify: `src/hooks/useCOGSFromFinancials.tsx` (158 lines; replace the four inline queries)
- Test: `tests/unit/useCOGSFromFinancials.capped.test.ts`

**Interfaces:**
- Consumes: `fetchFinancialCOGSRows` from `@/services/cogsFetch` (Task 2); `aggregateFinancialCOGSByDate` from `@/services/cogsCalculations`.
- Produces: `FinancialCOGSResult` gains `capped: boolean`. Task 5 (`useUnifiedCOGS`) reads `financialCosts.capped`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useCOGSFromFinancials.capped.test.ts`:

```typescript
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/services/cogsFetch', () => ({
  COGS_MAX_PAGES: 50,
  fetchFinancialCOGSRows: async () => ({
    bankTxns: [
      { transaction_date: '2026-08-01', amount: -40, chart_of_accounts: { account_subtype: 'food_cost' } },
    ],
    splitItems: [],
    parentDateMap: new Map(),
    pendingTxns: [
      { issue_date: '2026-08-02', amount: -10, chart_of_accounts: { account_subtype: 'beverage_cost' } },
    ],
    capped: true,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useCOGSFromFinancials with the paged helper', () => {
  it('aggregates the helper rows and passes the capped flag through', async () => {
    const { useCOGSFromFinancials } = await import('@/hooks/useCOGSFromFinancials');

    const { result } = renderHook(
      () =>
        useCOGSFromFinancials('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 40 },
      { date: '2026-08-02', total_cost: 10 },
    ]);
    expect(result.current.totalCost).toBe(50);
    expect(result.current.capped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useCOGSFromFinancials.capped.test.ts`
Expected: FAIL — the current hook queries `supabase.from(...)` directly; the empty `supabase` mock has no `from`, and `capped` does not exist on the result.

- [ ] **Step 3: Convert the hook to the helper**

In `src/hooks/useCOGSFromFinancials.tsx`:

Replace the `@/services/cogsCalculations` import with:

```typescript
import { aggregateFinancialCOGSByDate } from '@/services/cogsCalculations';
import { fetchFinancialCOGSRows } from '@/services/cogsFetch';
```

Keep the `format` import. Drop `toUtcDayKey` and the three row-type imports — the helper owns them now.

Add `capped: boolean;` to the `FinancialCOGSResult` interface.

Replace the whole queryFn (currently the four inline queries, the parentDateMap build, and the aggregate tail) with:

```typescript
queryFn: async () => {
  if (!restaurantId) return null;

  const { bankTxns, splitItems, parentDateMap, pendingTxns, capped } =
    await fetchFinancialCOGSRows(supabase, restaurantId, startDateStr, endDateStr);

  const dateMap = aggregateFinancialCOGSByDate({ bankTxns, splitItems, parentDateMap, pendingTxns });

  const dailyCosts: FinancialCOGSData[] = Array.from(dateMap.entries())
    .map(([date, total_cost]) => ({ date, total_cost }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);

  return { dailyCosts, totalCost, capped };
},
```

Keep the `startDateStr`/`endDateStr` definitions above the queryFn unchanged. In the hook's return block, add `capped: data?.capped ?? false,`.

Note the behavior change on purpose: the helper's `fetchAllRows` throws on a page error, so a failed splits or pending query is now a fatal query error, not a silent discard.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/useCOGSFromFinancials.capped.test.ts`
Expected: PASS — 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useCOGSFromFinancials.tsx tests/unit/useCOGSFromFinancials.capped.test.ts && git commit -m "fix(cogs): use the paged helper in useCOGSFromFinancials" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Thread the capped flag to usePeriodMetrics

**Files:**
- Modify: `src/hooks/useUnifiedCOGS.tsx` (95 lines)
- Modify: `src/hooks/useCostsFromSource.tsx` (108 lines)
- Modify: `src/hooks/usePeriodMetrics.tsx` (153 lines)
- Test: `tests/unit/useUnifiedCOGS.capped.test.ts`
- Test: `tests/unit/usePeriodMetrics.capped.test.ts`

**Interfaces:**
- Consumes: `capped: boolean` on `FoodCostsResult` (Task 3), `FinancialCOGSResult` (Task 4), and `useLaborCostsFromTimeTracking`'s result (already present).
- Produces: `UnifiedCOGSResult.capped: boolean`; `CostsFromSourceResult.capped: boolean`; the `usePeriodMetrics` return gains `capped: boolean`. Task 10 (`Index.tsx`) reads `usePeriodMetrics().capped`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/useUnifiedCOGS.capped.test.ts`:

```typescript
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

let cogsMethod: 'inventory' | 'financials' | 'combined' = 'combined';

vi.mock('@/hooks/useFoodCosts', () => ({
  useFoodCosts: () => ({
    dailyCosts: [],
    totalCost: 0,
    capped: false,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useCOGSFromFinancials', () => ({
  useCOGSFromFinancials: () => ({
    dailyCosts: [],
    totalCost: 0,
    capped: true,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useFinancialSettings', () => ({
  useFinancialSettings: () => ({ cogsMethod, isLoading: false }),
}));

describe('useUnifiedCOGS capped flag', () => {
  it('reports capped for the combined method when either source is capped', async () => {
    cogsMethod = 'combined';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });

  it('reports not capped for the inventory method when only financials is capped', async () => {
    cogsMethod = 'inventory';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(false);
  });

  it('reports capped for the financials method', async () => {
    cogsMethod = 'financials';
    const { useUnifiedCOGS } = await import('@/hooks/useUnifiedCOGS');
    const { result } = renderHook(() => useUnifiedCOGS('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });
});
```

Create `tests/unit/usePeriodMetrics.capped.test.ts`:

```typescript
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/useRevenueBreakdown', () => ({
  useRevenueBreakdown: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useCostsFromSource', () => ({
  useCostsFromSource: () => ({
    dailyCosts: [],
    totalFoodCost: 0,
    totalLaborCost: 0,
    pendingLaborCost: 0,
    actualLaborCost: 0,
    laborBasis: 'accrued',
    totalCost: 0,
    capped: true,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

describe('usePeriodMetrics capped flag', () => {
  it('passes the costs capped flag through', async () => {
    const { usePeriodMetrics } = await import('@/hooks/usePeriodMetrics');
    const { result } = renderHook(() => usePeriodMetrics('rest-1', new Date(), new Date()));
    expect(result.current.capped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/useUnifiedCOGS.capped.test.ts tests/unit/usePeriodMetrics.capped.test.ts`
Expected: FAIL — `result.current.capped` is `undefined` in both files (the hooks do not expose it yet).

- [ ] **Step 3: Thread the flag through the three hooks**

In `src/hooks/useUnifiedCOGS.tsx`:
1. Add `capped: boolean;` to the `UnifiedCOGSResult` interface.
2. Inside the `useMemo`, add `let capped = false;` before the `switch (cogsMethod)`.
3. In each case set it: the `'inventory'` case sets `capped = inventoryCosts.capped;`, the `'financials'` case sets `capped = financialCosts.capped;`, the `'combined'` case sets `capped = inventoryCosts.capped || financialCosts.capped;`.
4. Add `capped,` to the object the `useMemo` returns. The dependency array stays `[cogsMethod, inventoryCosts, financialCosts, settingsLoading]`.

In `src/hooks/useCostsFromSource.tsx`:
1. Add `capped: boolean;` to the `CostsFromSourceResult` interface.
2. In the return object (lines 95-106), add `capped: unifiedCOGS.capped || laborCosts.capped,`. (`laborCosts` is `useLaborCostsFromTimeTracking`, which already exposes `capped`. `transactionLaborCosts` has no such flag — out of scope for PR 1.)

In `src/hooks/usePeriodMetrics.tsx`:
1. Add `capped: boolean;` to the hook's return type (lines 59-64).
2. In the `useCostsFromSource` destructure (lines 78-87), add `capped: costsCapped,`.
3. In the return object (lines 146-151), add `capped: costsCapped,`.
4. The `PeriodMetrics` interface stays unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/useUnifiedCOGS.capped.test.ts tests/unit/usePeriodMetrics.capped.test.ts`
Expected: PASS — 4 passed across the 2 files.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useUnifiedCOGS.tsx src/hooks/useCostsFromSource.tsx src/hooks/usePeriodMetrics.tsx tests/unit/useUnifiedCOGS.capped.test.ts tests/unit/usePeriodMetrics.capped.test.ts && git commit -m "feat(dashboard): thread the capped flag to usePeriodMetrics" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: Page every useMonthlyMetrics fetch and collect warnings

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx` (641 lines; the queryFn and the hook wrapper)
- Modify: `tests/unit/useMonthlyMetrics.pagination.test.ts` (add a `.range` stub to its generic chain if absent)
- Test: `tests/unit/useMonthlyMetrics.warnings.test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `@/utils/fetchAllRows`; `fetchFinancialCOGSRows`, `COGS_MAX_PAGES` from `@/services/cogsFetch` (Task 2); `aggregateFinancialCOGSByDate`, `type InventoryTransactionRow` from `@/services/cogsCalculations`.
- Produces: the hook now returns `{ data: MonthlyMetrics[] | null, warnings: string[], isLoading, error, refetch }`. The queryFn returns `{ months: MonthlyMetrics[], warnings: string[] }`. Task 7 adds more warning pushes; Task 10 (`Index.tsx`) reads `warnings` and `error`.

Warning: keep every existing filter byte-for-byte when you convert a query. Use the exact warning strings from the Warning Strings table in the Global Constraints section.

Warning: the tips query gets `.order('id')` only. `tip_split_items` has no time column of its own in this select.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useMonthlyMetrics.warnings.test.ts`:

```typescript
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type TipMode = 'capped' | 'error';
let tipMode: TipMode = 'capped';

// A full 1000-row page on every call: fetchAllRows keeps paging until it
// exhausts its 20-page budget and reports capped.
const fullTipPage = Array.from({ length: 1000 }, () => ({
  amount: 100,
  employee_id: 'e1',
  tip_splits: { restaurant_id: 'rest-1', split_date: '2026-08-05' },
}));

// Generic chain for every other table. maybeSingle -> null keeps the COGS
// method on 'inventory', so the financial COGS block is skipped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGenericChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'or', 'is', 'lt', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTipChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.range = vi.fn(() => {
    if (tipMode === 'error') {
      return Promise.resolve({ data: null, error: new Error('tips fetch failed') });
    }
    return Promise.resolve({ data: fullTipPage, error: null });
  });
  return chain;
}

const fromMock = vi.fn((table: string) => {
  if (table === 'tip_split_items') return makeTipChain();
  return makeGenericChain();
});

const rpcMock = vi.fn(() => Promise.resolve({ data: [], error: null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useMonthlyMetrics warnings', () => {
  beforeEach(() => {
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  it('reports a warning when the tips fetch hits the page limit', async () => {
    tipMode = 'capped';
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () =>
        useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.warnings).toContain(
      'The tip rows hit the fetch limit. The labor cost figure is incomplete.'
    );
  });

  it('surfaces a tips fetch error as a query error', async () => {
    tipMode = 'error';
    const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');

    const { result } = renderHook(
      () =>
        useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useMonthlyMetrics.warnings.test.ts`
Expected: FAIL — `result.current.warnings` is `undefined` (the hook does not expose warnings), and the error case stays soft (`error` is null) because the current tips query only logs `console.warn`.

- [ ] **Step 3: Convert the hook**

All edits are in `src/hooks/useMonthlyMetrics.tsx`.

**3a. Imports.** Add:

```typescript
import { fetchFinancialCOGSRows, COGS_MAX_PAGES } from '@/services/cogsFetch';
```

Change the `@/services/cogsCalculations` import to:

```typescript
import {
  aggregateInventoryCOGSByDate,
  aggregateFinancialCOGSByDate,
  toUtcDayKey,
  type InventoryTransactionRow,
} from '@/services/cogsCalculations';
```

Keep the `fetchAllRows` import (already present for the punches fetch).

**3b. queryFn head.** Directly after `const fromStr = ...` / `const toStr = ...` (keep the `if (!restaurantId)` guard first — change its return to `return { months: [], warnings: [] };`), add:

```typescript
const warnings: string[] = [];
```

**3c. Inventory COGS query (currently lines 262-275, `.limit(10000)`).** Replace with:

```typescript
const { rows: foodCostsData, capped: inventoryCapped } = await fetchAllRows<InventoryTransactionRow>(
  (from, to) =>
    supabase
      .from('inventory_transactions')
      .select('created_at, transaction_date, total_cost')
      .eq('restaurant_id', restaurantId)
      .eq('transaction_type', 'usage')
      .or(`transaction_date.gte.${fromStr},and(transaction_date.is.null,created_at.gte.${fromStr})`)
      .or(`transaction_date.lte.${toStr},and(transaction_date.is.null,created_at.lte.${toStr}T23:59:59.999Z)`)
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  { maxPages: COGS_MAX_PAGES }
);

if (inventoryCapped) {
  console.warn('inventory COGS fetch hit the page limit; the food cost figure is incomplete.');
  warnings.push('The inventory COGS rows hit the fetch limit. The food cost figure is incomplete.');
}
```

Copy the two `.or()` filter strings from the current code byte-for-byte — the strings above match the current file. Downstream code that reads `foodCostsData` keeps its name and works unchanged.

**3d. Financial COGS block (currently lines 277-347).** Replace the whole gated block (the four inline queries, the parentDateMap build, and the `financialCOGSByDay` aggregation) with:

```typescript
let financialCOGSByDay = new Map<string, number>();
if (cogsMethod === 'financials' || cogsMethod === 'combined') {
  const { bankTxns, splitItems, parentDateMap, pendingTxns, capped: financialCapped } =
    await fetchFinancialCOGSRows(supabase, restaurantId, fromStr, toStr);

  if (financialCapped) {
    console.warn('financial COGS fetch hit the page limit; the food cost figure is incomplete.');
    warnings.push('The financial COGS rows hit the fetch limit. The food cost figure is incomplete.');
  }

  financialCOGSByDay = aggregateFinancialCOGSByDate({ bankTxns, splitItems, parentDateMap, pendingTxns });
}
```

This removes the three silent error discards (split parents, splits, pending COGS): the helper throws on any page error.

**3e. Bank labor query (currently lines 352-371, `.limit(10000)` + soft console.warn).** Replace with:

```typescript
const { rows: bankLabor, capped: bankLaborCapped } = await fetchAllRows(
  (from, to) =>
    supabase
      .from('bank_transactions')
      .select(`
        transaction_date,
        amount,
        status,
        chart_of_accounts!category_id(account_subtype)
      `)
      .eq('restaurant_id', restaurantId)
      .gte('transaction_date', fromStr)
      .lte('transaction_date', toStr)
      .in('status', ['posted', 'pending'])
      .lt('amount', 0)
      .order('transaction_date', { ascending: true })
      .order('id')
      .range(from, to)
);

if (bankLaborCapped) {
  console.warn('bank labor fetch hit the page limit; the labor cost figure is incomplete.');
  warnings.push('The bank labor rows hit the fetch limit. The labor cost figure is incomplete.');
}
```

Copy the multi-line select template from the current file byte-for-byte. A fetch error is now fatal (fetchAllRows throws) — delete the old `if (bankLaborError) console.warn(...)` branch. Downstream aggregation reads `bankLabor` directly (it was `bankLabor ?? []` semantics before; `rows` is always an array).

**3f. Pending labor query (currently lines 373-391).** Replace with the same shape:

```typescript
const { rows: pendingLabor, capped: pendingLaborCapped } = await fetchAllRows(
  (from, to) =>
    supabase
      .from('pending_outflows')
      .select(`
        issue_date,
        amount,
        status,
        chart_account:chart_of_accounts!category_id(account_subtype)
      `)
      .eq('restaurant_id', restaurantId)
      .gte('issue_date', fromStr)
      .lte('issue_date', toStr)
      .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
      .order('issue_date', { ascending: true })
      .order('id')
      .range(from, to)
);

if (pendingLaborCapped) {
  console.warn('pending labor fetch hit the page limit; the labor cost figure is incomplete.');
  warnings.push('The pending labor rows hit the fetch limit. The labor cost figure is incomplete.');
}
```

Copy the select template (with its `chart_account:` alias) from the current file byte-for-byte. Delete the old soft error branch.

**3g. Punches capped block (currently around line 420).** The punches fetch already uses `fetchAllRows`. In its `if (capped)` block, keep the existing `console.warn` and add:

```typescript
warnings.push('The time punch rows hit the fetch limit. The labor cost figure is incomplete.');
```

(Task 7 removes the surrounding try/catch; this task only adds the warning push.)

**3h. Tips query (currently lines 452-462 — no limit, no order, soft console.warn).** The `TipSplitRow` type currently sits below the fetch at lines 464-469; move it above the fetch. Replace the fetch with:

```typescript
const { rows: tipSplitsData, capped: tipsCapped } = await fetchAllRows<TipSplitRow>(
  (from, to) =>
    supabase
      .from('tip_split_items')
      .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
      .eq('tip_splits.restaurant_id', restaurantId)
      .gte('tip_splits.split_date', fromStr)
      .lte('tip_splits.split_date', toStr)
      .order('id')
      .range(from, to)
);

if (tipsCapped) {
  console.warn('tips fetch hit the page limit; the labor cost figure is incomplete.');
  warnings.push('The tip rows hit the fetch limit. The labor cost figure is incomplete.');
}
```

Delete the old soft error branch. Downstream code uses `tipSplitsData` directly — remove the old `(tipSplitsData ?? []) as TipSplitRow[]` cast; `rows` is already `TipSplitRow[]`.

**3i. queryFn tail.** Change the final return (currently `return result.sort(...)` at line 634) to:

```typescript
return {
  months: result.sort((a, b) => b.period.localeCompare(a.period)),
  warnings,
};
```

**3j. Hook wrapper.** The hook currently does `return useQuery({...})`. Change it to:

```typescript
const query = useQuery({
  // ... unchanged options ...
});

return {
  data: query.data?.months ?? null,
  warnings: query.data?.warnings ?? [],
  isLoading: query.isLoading,
  error: (query.error as Error | null) ?? null,
  refetch: query.refetch,
};
```

**3k. Existing pagination test.** Open `tests/unit/useMonthlyMetrics.pagination.test.ts`. In its generic chain factory, add this stub after the method `forEach` and before `chain.then` (skip if a `.range` stub already exists):

```typescript
chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
```

Its assertions read `result.current.data?.find(...)`, which stays valid under the new wrapper.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/useMonthlyMetrics.warnings.test.ts tests/unit/useMonthlyMetrics.pagination.test.ts`
Expected: PASS — both files green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: errors only in `src/pages/Index.tsx` if it destructures fields the wrapper no longer spreads — it uses `data`, `isLoading`, `error`, `refetch`, all of which the wrapper provides, so expect no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useMonthlyMetrics.tsx tests/unit/useMonthlyMetrics.warnings.test.ts tests/unit/useMonthlyMetrics.pagination.test.ts && git commit -m "fix(dashboard): page every useMonthlyMetrics fetch and collect warnings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: Classify useMonthlyMetrics failures as fatal or soft

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx` (four catch sites)
- Test: `tests/unit/useMonthlyMetrics.classification.test.ts`

**Interfaces:**
- Consumes: the `warnings: string[]` array and the `{ months, warnings }` return shape from Task 6.
- Produces: `MonthRevenueTotals` gains `salesTotalsFailed: boolean`. The taxonomy is final after this task: fatal = throw → React Query error → `role="alert"` UI; soft = console.warn + a warning string → `role="status"` UI.

The four sites this task changes:

| Site | Current behavior | New behavior |
|------|------------------|--------------|
| `employees_secure` fetch | console.warn, continue with `[]` | **fatal** — throw |
| punches fetch try/catch | catch → console.warn, continue | **fatal** — remove the try/catch |
| `daily_labor_allocations` (manual payments) | console.warn, continue | **soft** — keep console.warn, add a warning push |
| `get_unified_sales_totals` RPC in `fetchMonthRevenueTotals` | console.warn, fallback formula | **soft** — keep the fallback, report `salesTotalsFailed`, push a warning per month |

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useMonthlyMetrics.classification.test.ts`:

```typescript
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FailureMode = 'employees-error' | 'manual-error' | 'rpc-unified-error' | 'clean';
let mode: FailureMode = 'clean';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chainFor(table: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'or', 'is', 'lt', 'gte', 'lte', 'order'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
  chain.then = (resolve: (v: { data: unknown[] | null; error: Error | null }) => void) => {
    const shouldFail =
      (mode === 'employees-error' && table === 'employees_secure') ||
      (mode === 'manual-error' && table === 'daily_labor_allocations');
    if (shouldFail) {
      return resolve({ data: null, error: new Error(`${table} fetch failed`) });
    }
    return resolve({ data: [], error: null });
  };
  return chain;
}

const fromMock = vi.fn((table: string) => chainFor(table));

const rpcMock = vi.fn((fn: string) => {
  if (mode === 'rpc-unified-error' && fn === 'get_unified_sales_totals') {
    return Promise.resolve({ data: null, error: new Error('unified totals failed') });
  }
  return Promise.resolve({ data: [], error: null });
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: [string]) => fromMock(...args),
    rpc: (...args: [string, unknown]) => rpcMock(...args),
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

async function renderMetrics() {
  const { useMonthlyMetrics } = await import('@/hooks/useMonthlyMetrics');
  const { result } = renderHook(
    () =>
      useMonthlyMetrics('rest-1', new Date('2026-08-01T12:00:00Z'), new Date('2026-08-27T12:00:00Z')),
    { wrapper: createWrapper() },
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

describe('useMonthlyMetrics failure classification', () => {
  beforeEach(() => {
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  it('treats an employees fetch error as fatal', async () => {
    mode = 'employees-error';
    const result = await renderMetrics();
    expect(result.current.error).not.toBeNull();
  });

  it('treats a manual payments fetch error as soft with a warning', async () => {
    mode = 'manual-error';
    const result = await renderMetrics();
    expect(result.current.error).toBeNull();
    expect(result.current.warnings).toContain(
      'The manual payment rows failed to load. The labor cost figure is incomplete.'
    );
  });

  it('treats a unified sales totals RPC error as soft with a fallback warning', async () => {
    mode = 'rpc-unified-error';
    const result = await renderMetrics();
    expect(result.current.error).toBeNull();
    expect(result.current.warnings.some((w) => w.includes('fallback formula'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useMonthlyMetrics.classification.test.ts`
Expected: FAIL — the employees case stays soft (`error` is null), and the two soft cases produce no warning strings.

- [ ] **Step 3: Change the four sites**

All edits are in `src/hooks/useMonthlyMetrics.tsx`.

**3a. Employees fetch → fatal.** In the `employees_secure` block (currently lines 430-437), replace the `if (employeesError) console.warn(...)` branch with:

```typescript
if (employeesError) throw employeesError;
```

**3b. Punches fetch → fatal.** Remove the `try`/`catch` around the punches `fetchAllRows` call (Task 6 kept it). Keep the `if (capped)` block (console.warn + the warning push from Task 6). Rewrite the stale doc comment above the fetch (currently lines 399-405, which ends with "Errors stay non-fatal (console.warn)...") so its last line reads:

```typescript
// Errors are fatal: the query throws and the table shows the error state.
```

**3c. Manual payments → soft with a warning.** In the `daily_labor_allocations` block (currently lines 440-450), keep the `console.warn` and add directly after it:

```typescript
warnings.push('The manual payment rows failed to load. The labor cost figure is incomplete.');
```

**3d. Unified sales totals RPC → soft with a per-month warning.**

In `fetchMonthRevenueTotals` (lines 82-160): add `salesTotalsFailed: boolean;` to the `MonthRevenueTotals` interface (lines 43-51), and add `salesTotalsFailed: !!unifiedErr,` to the object the function returns. Keep the existing `console.warn` and the fallback `posCollectedCents` formula unchanged. (`revErr` and `passErr` already throw — leave them.)

In the per-month revenue loop (lines 227-252), directly after the `fetchMonthRevenueTotals` call resolves into `totals`, add:

```typescript
if (totals.salesTotalsFailed) {
  warnings.push(
    `The POS sales total for ${monthKey} failed to load. The collected amount uses the fallback formula.`
  );
}
```

`monthKey` already exists in the loop (line 235, `format(monthStart, 'yyyy-MM')`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/useMonthlyMetrics.classification.test.ts tests/unit/useMonthlyMetrics.warnings.test.ts tests/unit/useMonthlyMetrics.pagination.test.ts`
Expected: PASS — all three files green.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useMonthlyMetrics.tsx tests/unit/useMonthlyMetrics.classification.test.ts && git commit -m "fix(dashboard): classify useMonthlyMetrics failures as fatal or soft" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: Rename the monthly labor formula to a range formula

**Files:**
- Modify: `src/services/laborCalculations.ts` (lines 800-989: the monthly-formula section)
- Test: `tests/unit/laborCalculationsRange.test.ts`
- Regression: `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts` (must stay green, unchanged)

**Interfaces:**
- Consumes: `calculateEmployeePay` (the payroll authority at `src/services/payrollCalculations.ts:441`) — already used inside the function body; do not touch it.
- Produces: `calculateActualLaborCostForRange(input: RangeLaborInput): RangeLaborResult` where `RangeLaborInput = { employees: Employee[]; timePunches: TimePunch[]; tipsOwedByEmployee: Map<string, number>; rangeStart: Date; rangeEnd: Date; timezone: string }` and `RangeLaborResult = { wagesCents: number; tipsOwedCents: number; actualLaborCents: number }`. `calculateActualLaborCostForMonth(input: MonthlyLaborInput): MonthlyLaborResult` stays exported as a thin shim. Task 9 imports `calculateActualLaborCostForRange`.

The function body is not month-specific. The only month-specific code is the per-day clip (currently lines 961-965):

```typescript
const dayDate = new Date(dateKey + 'T12:00:00');
if (dayDate >= monthStart && dayDate <= monthEnd) {
  wagesCents += dayCents;
}
```

The clip works for any date range, so a rename plus a shim is the whole change.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/laborCalculationsRange.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCostForMonth,
  calculateActualLaborCostForRange,
} from '@/services/laborCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

const baseEmployee: Employee = {
  id: 'e1',
  restaurant_id: 'r1',
  name: 'Test Employee',
  position: 'Server',
  status: 'active',
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr in cents
  is_exempt: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

function punch(employeeId: string, time: string, type: 'clock_in' | 'clock_out'): TimePunch {
  return {
    id: `${employeeId}-${time}-${type}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: new Date(time).toISOString(),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as TimePunch;
}

describe('calculateActualLaborCostForRange', () => {
  it('equals calculateActualLaborCostForMonth for a one-month range', () => {
    const employees = [baseEmployee];
    const timePunches = [
      punch('e1', '2026-04-06T15:00:00Z', 'clock_in'),
      punch('e1', '2026-04-06T23:00:00Z', 'clock_out'),
    ];
    const tipsOwedByEmployee = new Map([['e1', 5000]]);

    const forRange = calculateActualLaborCostForRange({
      employees,
      timePunches,
      tipsOwedByEmployee,
      rangeStart: new Date('2026-04-01T00:00:00Z'),
      rangeEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });

    const forMonth = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00Z'),
      monthEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });

    expect(forRange).toEqual(forMonth);
    // 8h x 2000c = 16,000c wages + 5,000c tips = 21,000c.
    expect(forRange.actualLaborCents).toBe(21_000);
  });

  it('covers a two-month range as the sum of the two months, with OT banding', () => {
    const employees = [baseEmployee];
    // Six 10-hour shifts across the April/May boundary: one clock-in week,
    // 60 hours, so the OT banding applies.
    const timePunches = [
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ].flatMap((day) => [
      punch('e1', `${day}T08:00:00Z`, 'clock_in'),
      punch('e1', `${day}T18:00:00Z`, 'clock_out'),
    ]);
    const tipsOwedByEmployee = new Map<string, number>();

    const forRange = calculateActualLaborCostForRange({
      employees,
      timePunches,
      tipsOwedByEmployee,
      rangeStart: new Date('2026-04-01T00:00:00Z'),
      rangeEnd: new Date('2026-05-31T23:59:59Z'),
      timezone: 'UTC',
    });

    const april = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00Z'),
      monthEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });
    const may = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-05-01T00:00:00Z'),
      monthEnd: new Date('2026-05-31T23:59:59Z'),
      timezone: 'UTC',
    });

    // The proportional distribution guarantees per-day cents sum to the
    // week total, so the range equals the sum of the two month clips.
    expect(forRange.wagesCents).toBe(april.wagesCents + may.wagesCents);
    // 60h straight time is 120,000c; the OT banding pays more.
    expect(forRange.wagesCents).toBeGreaterThan(120_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/laborCalculationsRange.test.ts`
Expected: FAIL — `calculateActualLaborCostForRange` is not exported.

- [ ] **Step 3: Rename and shim**

In `src/services/laborCalculations.ts`, section at lines 800-989:

1. Rename the interface `MonthlyLaborInput` (lines 824-837) to `RangeLaborInput`. Rename its fields `monthStart` → `rangeStart` and `monthEnd` → `rangeEnd`. Keep the other fields, their types, and the doc comments.
2. Rename the interface `MonthlyLaborResult` (lines 839-846) to `RangeLaborResult`. No field changes.
3. Rename the function `calculateActualLaborCostForMonth` (lines 865-981) to `calculateActualLaborCostForRange`. Inside the body, rename every `monthStart` to `rangeStart` and every `monthEnd` to `rangeEnd`. Change nothing else — the clock-in-week state machine, the per-week `calculateEmployeePay` calls, the proportional distribution, and the tips sum stay byte-for-byte identical.
4. Update the function's doc comment so it speaks of a date range, not a month.
5. Append the backward-compatible shim after the renamed function:

```typescript
export interface MonthlyLaborInput {
  employees: Employee[];
  timePunches: TimePunch[];
  tipsOwedByEmployee: Map<string, number>;
  monthStart: Date;
  monthEnd: Date;
  timezone: string;
}

export type MonthlyLaborResult = RangeLaborResult;

export function calculateActualLaborCostForMonth(input: MonthlyLaborInput): MonthlyLaborResult {
  return calculateActualLaborCostForRange({
    employees: input.employees,
    timePunches: input.timePunches,
    tipsOwedByEmployee: input.tipsOwedByEmployee,
    rangeStart: input.monthStart,
    rangeEnd: input.monthEnd,
    timezone: input.timezone,
  });
}
```

If the file's original `MonthlyLaborInput` fields carry doc comments or slightly different types, copy them into the shim interface exactly as the file has them — the shim must be a drop-in for every current caller (`useMonthlyMetrics` keeps calling `calculateActualLaborCostForMonth` unchanged).

- [ ] **Step 4: Run both tests to verify they pass**

Run: `npx vitest run tests/unit/laborCalculationsRange.test.ts tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`
Expected: PASS — the new file green, and the existing ForMonth file still reports 7 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/services/laborCalculations.ts tests/unit/laborCalculationsRange.test.ts && git commit -m "refactor(labor): rename the monthly labor formula to a range formula" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: Use the payroll formula and tips in the period labor total

**Files:**
- Modify: `src/hooks/useLaborCostsFromTimeTracking.tsx` (199 lines)
- Modify: `tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts` (add a `.range` stub)
- Modify: `tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts` (add a `.range` stub)
- Test: `tests/unit/useLaborCostsFromTimeTracking.tips.test.ts`

**Interfaces:**
- Consumes: `calculateActualLaborCostForRange` from `@/services/laborCalculations` (Task 8); `fetchAllRows` (already imported in this hook).
- Produces: `totalCost` now uses the payroll formula (OT banding + tips owed + per-job dollars). `dailyCosts` stays the straight-time per-day series for the charts. `capped` becomes `punchesCapped || tipsCapped`. Task 5 already threads `capped` upward — no interface change for consumers.

Warning: `tip_split_items.amount` is INTEGER cents. Labor math stays in cents until the final division by 100.

- [ ] **Step 1: Add the `.range` stub to the two existing test files**

The new tips fetch calls `.range()` on the generic chain in both files; without the stub the fetch is a TypeError.

In `tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts`, inside `makeChainable()` (lines 114-123), add after the method `forEach` and before `chain.then`:

```typescript
chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
```

In `tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts`, inside `makeChainable()` (lines 26-40), add the same line after the `chain.gte`/`chain.lte` assignments (lines 35-36) and before `chain.then`:

```typescript
chain.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/useLaborCostsFromTimeTracking.tips.test.ts`:

```typescript
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RESTAURANT = 'rest-1';

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      {
        id: 'e1',
        restaurant_id: RESTAURANT,
        is_active: true,
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1000, // $10.00/hr in cents
      },
    ],
    loading: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

// One closed 8-hour shift on Jul 6 (15:00-23:00 UTC = 10:00-18:00 Chicago).
const punches = [
  {
    id: 'p1', employee_id: 'e1', restaurant_id: RESTAURANT,
    punch_time: '2026-07-06T15:00:00+00:00', punch_type: 'clock_in',
    created_at: '2026-07-06T15:00:00+00:00', updated_at: '2026-07-06T15:00:00+00:00',
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  },
  {
    id: 'p2', employee_id: 'e1', restaurant_id: RESTAURANT,
    punch_time: '2026-07-06T23:00:00+00:00', punch_type: 'clock_out',
    created_at: '2026-07-06T23:00:00+00:00', updated_at: '2026-07-06T23:00:00+00:00',
    shift_id: null, notes: null, photo_path: null, device_info: null,
    location: null, created_by: null, modified_by: null,
  },
];

// $5.00 of tips owed to e1 on the same day.
const tipRows = [
  { amount: 500, employee_id: 'e1', tip_splits: { restaurant_id: RESTAURANT, split_date: '2026-07-06' } },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRangeChain(rows: unknown[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  ['select', 'eq', 'in', 'gte', 'lte', 'order', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  // A page smaller than 1000 rows stops the paging after one call.
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

const fromMock = vi.fn((table: string) => {
  if (table === 'time_punches') return makeRangeChain(punches);
  if (table === 'tip_split_items') return makeRangeChain(tipRows);
  return makeRangeChain([]);
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: [string]) => fromMock(...args) },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useLaborCostsFromTimeTracking payroll total with tips', () => {
  it('adds tips owed to the total but keeps dailyCosts straight-time', async () => {
    const { useLaborCostsFromTimeTracking } = await import('@/hooks/useLaborCostsFromTimeTracking');

    const { result } = renderHook(
      () =>
        useLaborCostsFromTimeTracking(
          RESTAURANT,
          new Date('2026-07-06T00:00:00.000Z'),
          new Date('2026-07-06T23:59:59.999Z'),
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Straight-time chart series: 8h x $10.00 = $80.00 on Jul 6.
    const day = result.current.dailyCosts.find((d) => d.date === '2026-07-06');
    expect(day?.total_labor_cost).toBeCloseTo(80, 2);

    // Payroll total: $80.00 wages + $5.00 tips owed = $85.00.
    expect(result.current.totalCost).toBeCloseTo(85, 2);
    expect(result.current.capped).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify the new one fails**

Run: `npx vitest run tests/unit/useLaborCostsFromTimeTracking.tips.test.ts`
Expected: FAIL — `totalCost` is 80 (the straight-time sum), not 85; the hook fetches no tips yet.

- [ ] **Step 4: Rewire the hook**

All edits are in `src/hooks/useLaborCostsFromTimeTracking.tsx`.

**4a. Import.** Extend the labor import to include the range formula (keep `calculateActualLaborCost` — the daily series still uses it):

```typescript
import { calculateActualLaborCost, calculateActualLaborCostForRange } from '@/services/laborCalculations';
```

**4b. Rename the punches capped flag.** In the punches fetch destructure (lines 95-106), rename `capped` to `punchesCapped`:

```typescript
const { rows: timePunchesData, capped: punchesCapped } = await fetchAllRows(
```

(Keep the rest of that call unchanged; update the one place that reads the old name — the return in step 4d.)

**4c. Fetch the tips.** Insert after the manual payments block (lines 109-117):

```typescript
// Tips owed in the window (integer cents). Same source and window rule
// as useMonthlyMetrics so the two surfaces agree.
const { rows: tipRows, capped: tipsCapped } = await fetchAllRows<{
  amount: number;
  employee_id: string;
  tip_splits: { restaurant_id: string; split_date: string };
}>((from, to) =>
  supabase
    .from('tip_split_items')
    .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
    .eq('tip_splits.restaurant_id', restaurantId)
    .gte('tip_splits.split_date', toDateOnlyString(dateFrom))
    .lte('tip_splits.split_date', toDateOnlyString(dateTo))
    .order('id')
    .range(from, to)
);

const tipsOwedByEmployee = new Map<string, number>();
for (const row of tipRows) {
  tipsOwedByEmployee.set(
    row.employee_id,
    (tipsOwedByEmployee.get(row.employee_id) ?? 0) + row.amount
  );
}
```

(`toDateOnlyString` is already imported in this hook.)

**4d. Replace the total.** The `dateMap` build and the per-job merge (lines 146-178) stay — `dailyCosts` keeps straight time plus per-job per day for the charts. Replace only line 181:

```typescript
const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_labor_cost, 0);
```

with:

```typescript
// dailyCosts stays straight-time for the daily chart. totalCost uses
// the payroll formula (OT banding + tips owed) so the pills equal
// Monthly Performance and Payroll.
const rangeStart = new Date(dateFrom);
rangeStart.setHours(0, 0, 0, 0);
const rangeEnd = new Date(dateTo);
rangeEnd.setHours(23, 59, 59, 999);

const { actualLaborCents } = calculateActualLaborCostForRange({
  employees,
  timePunches: punchesForCost,
  tipsOwedByEmployee,
  rangeStart,
  rangeEnd,
  timezone,
});

const perJobDollars = (manualPaymentsData ?? []).reduce(
  (sum: number, payment: ManualPaymentDB) => sum + payment.allocated_cost / 100,
  0
);

const totalCost = actualLaborCents / 100 + perJobDollars;
```

Use the same variable names the file already has for the typed punches array (`punchesForCost`), the employees array, the timezone, and the manual payments rows — read the surrounding code and match them exactly.

**4e. Return.** Change the return (line 183) to:

```typescript
return { dailyCosts, totalCost, capped: punchesCapped || tipsCapped };
```

- [ ] **Step 5: Run all four labor test files to verify they pass**

Run: `npx vitest run tests/unit/useLaborCostsFromTimeTracking.tips.test.ts tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts tests/unit/laborCalculationsRange.test.ts`
Expected: PASS — all four files green. The pagination test's `$586.72` assertion reads `dailyCosts`, which this task does not change.

- [ ] **Step 6: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/hooks/useLaborCostsFromTimeTracking.tsx tests/unit/useLaborCostsFromTimeTracking.tips.test.ts tests/unit/useLaborCostsFromTimeTracking.pagination.test.ts tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts && git commit -m "fix(labor): use the payroll formula and tips in the period labor total" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: Show basis labels and completeness warnings on the dashboard

**Files:**
- Modify: `src/components/DashboardMetricCard.tsx` (80 lines)
- Modify: `src/pages/Index.tsx`
- Test: `tests/unit/dashboardMetricCard.caption.test.tsx`

**Interfaces:**
- Consumes: `usePeriodMetrics().capped` (Task 5); `useMonthlyMetrics()`'s `warnings` and `error` (Tasks 6-7); the `DataCompletenessWarning` component (Task 1).
- Produces: `DashboardMetricCard` gains an optional `caption?: string` prop. `Index.tsx` renders the basis labels, the warnings, and the monthly error state. Task 14's E2E asserts these labels.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboardMetricCard.caption.test.tsx` (no jest-dom matchers — use `toBeTruthy`/`toBeNull`):

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendingUp } from 'lucide-react';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';

describe('DashboardMetricCard caption', () => {
  it('renders the caption when given', () => {
    render(
      <DashboardMetricCard
        title="Gross Profit"
        value="$100"
        icon={TrendingUp}
        caption="Before other expenses"
      />
    );
    expect(screen.getByText('Before other expenses')).toBeTruthy();
  });

  it('renders no caption when the prop is absent', () => {
    render(<DashboardMetricCard title="Gross Profit" value="$100" icon={TrendingUp} />);
    expect(screen.queryByText('Before other expenses')).toBeNull();
  });
});
```

If `DashboardMetricCard` has other required props, read the component first and pass them — the two assertions above are the contract.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dashboardMetricCard.caption.test.tsx`
Expected: FAIL — the component has no `caption` prop, so the first test finds no text (and TypeScript flags the prop).

- [ ] **Step 3: Add the caption prop**

In `src/components/DashboardMetricCard.tsx`:
1. Add `caption?: string;` to the props interface.
2. Add `caption` to the destructure.
3. Inside the value `div`, after the existing subtitle conditional, insert:

```tsx
{caption && (
  <p className="text-[11px] text-muted-foreground mt-1">{caption}</p>
)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/dashboardMetricCard.caption.test.tsx`
Expected: PASS — 2 passed.

- [ ] **Step 5: Wire Index.tsx**

All edits are in `src/pages/Index.tsx`. The file has neither a `Skeleton` nor a `DataCompletenessWarning` import — add both:

```typescript
import { Skeleton } from '@/components/ui/skeleton';
import { DataCompletenessWarning } from '@/components/DataCompletenessWarning';
```

**5a. Destructures.** In the `usePeriodMetrics` destructure (lines 171-175), add `capped: periodCapped,`. In the `useMonthlyMetrics` destructure (lines 178-182), add `error: monthlyError,` and `warnings: monthlyWarnings,`. The existing `const monthlyData = monthlyMetrics || []` (around line 418) still compiles — `data` is now `MonthlyMetrics[] | null`.

**5b. Period warning.** Between `<CollapsibleContent>` (line 752) and the metrics grid `div` (line 753), insert:

```tsx
{periodCapped && (
  <DataCompletenessWarning
    className="mb-4"
    message="Some cost rows hit the fetch limit. The cost figures for this period can show low values."
  />
)}
```

**5c. Gross Profit caption.** In the Gross Profit card (the IIFE at lines 809-832), add to the `DashboardMetricCard` props:

```tsx
caption="Before other expenses"
```

**5d. Basis labels.** Wrap the Cashflow `h2` (line 890) in a `div` and add a subtitle:

```tsx
<div>
  <h2 className="text-xl font-semibold">Cashflow</h2>
  <p className="text-[12px] text-muted-foreground">Cash basis</p>
</div>
```

Do the same for the Monthly Performance `h2` (line 907) with the text `Accrual basis`. Keep each `h2`'s existing className and siblings — only wrap and add the `<p>`.

**5e. Monthly three-state block.** Replace the bare `<MonthlyBreakdownTable ... />` at line 915 with:

```tsx
{monthlyError ? (
  <div
    role="alert"
    className="p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-[13px] text-destructive"
  >
    The monthly data failed to load. Refresh the page.
  </div>
) : monthlyLoading ? (
  <Skeleton className="h-64 w-full rounded-xl" />
) : (
  <div className="space-y-3">
    {monthlyWarnings.length > 0 && (
      <DataCompletenessWarning message={monthlyWarnings.join(' ')} />
    )}
    <MonthlyBreakdownTable monthlyData={monthlyData} />
  </div>
)}
```

`monthlyLoading` is the existing name for the `useMonthlyMetrics` isLoading destructure — match whatever name the file uses.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/components/DashboardMetricCard.tsx src/pages/Index.tsx tests/unit/dashboardMetricCard.caption.test.tsx && git commit -m "feat(dashboard): show basis labels and completeness warnings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Add the revenue reconciliation line to the Sankey chart

**Files:**
- Modify: `src/components/dashboard/CashFlowSankeyChart.tsx`

**Interfaces:**
- Consumes: the component's existing `periodMetrics` prop (it carries `grossRevenue`, `discounts`, `refunds`, `netRevenue` — the `PeriodMetrics` shape from `usePeriodMetrics`).
- Produces: a file-local `RevenueReconciliationLine` component rendered in all three branches. Task 14's E2E asserts the `= Net $` text.

Warning: do not import the `PeriodMetrics` type into this file. Use the local structural interface below — it avoids a type-export dependency on the hook.

- [ ] **Step 1: Add the file-local component**

In `src/components/dashboard/CashFlowSankeyChart.tsx`, above the main component, add:

```tsx
interface ReconciliationMetrics {
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
}

// One line that reconciles the Sankey's gross flow with the header's net
// revenue, so the two figures no longer look like a mismatch.
const RevenueReconciliationLine = ({ metrics }: { metrics: ReconciliationMetrics | null }) => {
  if (!metrics) return null;
  const fmt = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
  const adjustments = (metrics.discounts || 0) + (metrics.refunds || 0);
  return (
    <p className="text-[12px] text-muted-foreground mt-1">
      Gross {fmt(metrics.grossRevenue)} − discounts and refunds {fmt(adjustments)} = Net{' '}
      {fmt(metrics.netRevenue)}
    </p>
  );
};
```

There is no `grossRevenue > 0` guard on purpose: a fresh restaurant renders `$0.00` values, which keeps the line visible for the E2E.

- [ ] **Step 2: Render it in all three branches**

The component returns three branches (loading around line 496, empty around line 517, success around line 546). In each branch, insert directly after the `CardDescription` element:

```tsx
<RevenueReconciliationLine metrics={periodMetrics} />
```

Use the actual prop name the component receives for the period metrics — read the component's props and match it.

- [ ] **Step 3: Fix the tooltip label**

In the tooltip (lines 237-239), change the percentage label text to `% of gross income` so the tooltip states its own basis.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Rendering is covered by the Task 14 E2E.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add src/components/dashboard/CashFlowSankeyChart.tsx && git commit -m "feat(dashboard): add the revenue reconciliation line to the Sankey chart" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: Flag .limit(10000) queries in ESLint

**Files:**
- Modify: `eslint.config.js` (243 lines)

**Interfaces:**
- Consumes: the existing timezone rule block (lines 44-84) and the migration allowlist block (lines 89-242).
- Produces: a hoisted `restaurantClockSelectors` array, a hoisted `highVolumeLimitSelector` object, and two appended per-file override blocks. Later PRs remove files from the appended `.limit` allowlist as they convert.

ESLint flat config resolves per-rule: a later block's `no-restricted-syntax` value replaces an earlier one for matching files. That is why the selectors must be hoisted constants — each block must restate the full selector list it wants.

- [ ] **Step 1: Hoist the selector constants**

In `eslint.config.js`, between the imports (line 5) and `export default tseslint.config(` (line 7), add:

```javascript
// The timezone selectors, hoisted so later blocks can restate them.
// Flat config resolves per rule: a later block's no-restricted-syntax value
// REPLACES an earlier one for matching files, so every block that wants a
// subset must list it in full.
const restaurantClockSelectors = [
  {
    selector: "CallExpression[callee.name='format'] > Literal.arguments[value=/yyyy-MM-dd/]",
    message:
      "restaurant-clock: format(instant, 'yyyy-MM-dd') buckets by the VIEWER's timezone. Use toBusinessDay() from useRestaurantClock(), or toDateOnlyString() if this is a calendar-day token.",
  },
  {
    selector: "MemberExpression[property.name=/^toLocale(Date|Time)?String$/]",
    message:
      "restaurant-clock: toLocale*String renders in the viewer's timezone. Use formatInstant() from useRestaurantClock().",
  },
  {
    selector:
      "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name='split']",
    message:
      "restaurant-clock: .toISOString().split('T')[0] is neither a calendar day nor a moment in time. Use toBusinessDay() or toDateOnlyString().",
  },
  // Both the bare `DateTimeFormat()` and the `Intl.`-qualified form. The
  // latter nests a MemberExpression under `object.callee`, so a plain
  // `object.callee.name` test silently matches nothing -- and
  // `Intl.DateTimeFormat()` is the only form this codebase uses.
  {
    selector:
      "MemberExpression[property.name='resolvedOptions']:matches([object.callee.name='DateTimeFormat'], [object.callee.property.name='DateTimeFormat'])",
    message:
      "restaurant-clock: never default to the viewer's timezone. Use safeTz(restaurant.timezone).",
  },
];

const highVolumeLimitSelector = {
  selector: "CallExpression[callee.property.name='limit'] > Literal.arguments[value=10000]",
  message:
    "Use fetchAllRows from '@/utils/fetchAllRows'. A fixed .limit(10000) truncates silently at the PostgREST 1,000-row cap.",
};
```

Copy the four selector objects from the current file verbatim (they sit in the timezone block at lines 44-84, including the `DateTimeFormat` comment) — the code above matches them. Then delete the inline copies as part of step 2.

- [ ] **Step 2: Restate the two existing blocks with the constants**

Change the timezone block's rules (lines 44-84) to:

```javascript
rules: {
  "no-restricted-syntax": ["error", ...restaurantClockSelectors, highVolumeLimitSelector],
},
```

Change the migration allowlist block's rules (lines 89-242, currently ending with `"no-restricted-syntax": "off"` at line 241) to:

```javascript
rules: {
  "no-restricted-syntax": ["error", highVolumeLimitSelector],
},
```

The allowlisted files stay exempt from the timezone rules but now get the `.limit(10000)` rule.

- [ ] **Step 3: Append the two override blocks**

Before the closing `);` of `tseslint.config(`, append:

```javascript
// .limit(10000) call sites that PR 1 does not convert. Remove a file from
// this list when a later PR converts it to fetchAllRows.
{
  files: [
    "src/hooks/useLaborCosts.tsx",
    "src/hooks/useLaborCostsFromTransactions.tsx",
    "src/hooks/useRevenueBreakdown.tsx",
  ],
  rules: {
    "no-restricted-syntax": "off",
  },
},
// useBankStatementImport keeps its .limit(10000) exemption but is NOT in
// the timezone migration allowlist, so restate the timezone rules alone.
{
  files: ["src/hooks/useBankStatementImport.tsx"],
  rules: {
    "no-restricted-syntax": ["error", ...restaurantClockSelectors],
  },
},
```

(The first three files are in the timezone migration allowlist, so `"off"` restores their status quo exactly. `useBankStatementImport.tsx` is not, so it must keep the timezone rules.)

- [ ] **Step 4: Verify the rule fires and the repo passes**

Probe that the rule fires:

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && echo "supabase.from('x').select('*').limit(10000);" | npx eslint --stdin --stdin-filename src/hooks/zzLimitProbe.ts
```

Expected: 1 problem, with the "Use fetchAllRows" message.

Then run: `npm run lint`
Expected: passes. If it reports a `.limit(10000)` offender not in the allowlist above, that file was missed in reconnaissance — add it to the allowlist block and note it for a follow-up PR.

- [ ] **Step 5: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add eslint.config.js && git commit -m "feat(lint): flag .limit(10000) queries" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Add the high-volume query guard test

**Files:**
- Test: `tests/unit/highVolumeQueryGuard.test.ts`

**Interfaces:**
- Consumes: the repo source tree (node:fs walk) and the paged imports (`@/utils/fetchAllRows`, `@/services/cogsFetch`).
- Produces: a characterization test that fails when someone adds an unpaged query against a high-volume table. Run it AFTER Tasks 3, 4, and 6 — the converted hooks must already import the paged helpers.

- [ ] **Step 1: Write the test**

Create `tests/unit/highVolumeQueryGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Any file that queries a high-volume table must import a paged fetch
// helper, or sit in the allowlist below. The allowlist may only SHRINK:
// remove an entry when its file converts to fetchAllRows.
const HIGH_VOLUME_TABLES = [
  'unified_sales',
  'inventory_transactions',
  'time_punches',
  'bank_transactions',
  'pending_outflows',
];

const FROM_RE = new RegExp(
  `\\.from\\(\\s*['"](?:${HIGH_VOLUME_TABLES.join('|')})['"]`
);
const PAGED_IMPORT_RE = /@\/(?:utils\/fetchAllRows|services\/cogsFetch)/;

const ALLOWLIST = new Set([
  'src/components/POSSalesImportReview.tsx',
  'src/components/ReceiptMappingReview.tsx',
  'src/components/ReconciliationItemDetail.tsx',
  'src/components/VarianceAnalysis.tsx',
  'src/components/financial-statements/BalanceSheet.tsx',
  'src/hooks/adapters/useCloverSalesAdapter.tsx',
  'src/hooks/adapters/useRevelSalesAdapter.tsx',
  'src/hooks/adapters/useShift4SalesAdapter.tsx',
  'src/hooks/adapters/useSquareSalesAdapter.tsx',
  'src/hooks/adapters/useToastSalesAdapter.tsx',
  'src/hooks/useAlertsIntelligence.tsx',
  'src/hooks/useAttachments.ts',
  'src/hooks/useAutomaticInventoryDeduction.tsx',
  'src/hooks/useBankReconciliation.tsx',
  'src/hooks/useBankStatementImport.tsx',
  'src/hooks/useBankTransactions.tsx',
  'src/hooks/useBreakEvenAnalysis.tsx',
  'src/hooks/useBulkPosSaleActions.tsx',
  'src/hooks/useBulkTransactionActions.tsx',
  'src/hooks/useCalculateOpeningBalance.tsx',
  'src/hooks/useCashFlowInsights.tsx',
  'src/hooks/useConsumptionIntelligence.tsx',
  'src/hooks/useExpenseHealth.tsx',
  'src/hooks/useHourlySalesPattern.ts',
  'src/hooks/useInventoryAudit.tsx',
  'src/hooks/useInventoryDeduction.tsx',
  'src/hooks/useInventoryMetrics.tsx',
  'src/hooks/useInventoryPurchases.tsx',
  'src/hooks/useLaborCostsFromTransactions.tsx',
  'src/hooks/useLiquidityMetrics.tsx',
  'src/hooks/usePendingOutflows.tsx',
  'src/hooks/usePredictableExpenses.tsx',
  'src/hooks/usePredictiveMetrics.tsx',
  'src/hooks/useReceiptImport.tsx',
  'src/hooks/useRecipeIntelligence.tsx',
  'src/hooks/useReconcileTransactions.tsx',
  'src/hooks/useReconciliation.tsx',
  'src/hooks/useRevenueBreakdown.tsx',
  'src/hooks/useRevenueHealth.tsx',
  'src/hooks/useSplhData.ts',
  'src/hooks/useSplitPosSale.tsx',
  'src/hooks/useSupplierPriceAnalytics.tsx',
  'src/hooks/useTopVendors.tsx',
  'src/hooks/useUncategorizedTotals.tsx',
  'src/hooks/useUnifiedSales.tsx',
  'src/hooks/useWeekStaffingSuggestions.ts',
  'src/lib/expenseDataFetcher.ts',
  'src/pages/Banking.tsx',
  'src/services/inventoryTransactions.service.ts',
  'src/services/recipeAnalytics.service.ts',
  'src/utils/offlineQueue.ts',
]);

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('high-volume query guard', () => {
  it('finds no unpaged high-volume queries outside the allowlist', () => {
    const offenders: string[] = [];
    for (const full of walk(srcRoot)) {
      const repoPath = relative(repoRoot, full);
      if (ALLOWLIST.has(repoPath)) continue;
      const content = readFileSync(full, 'utf8');
      if (FROM_RE.test(content) && !PAGED_IMPORT_RE.test(content)) {
        offenders.push(repoPath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist shrink-only', () => {
    for (const repoPath of ALLOWLIST) {
      const full = join(repoRoot, repoPath);
      expect(
        existsSync(full),
        `${repoPath} no longer exists — remove it from ALLOWLIST`
      ).toBe(true);
      const content = readFileSync(full, 'utf8');
      expect(
        FROM_RE.test(content),
        `${repoPath} no longer queries a high-volume table — remove it from ALLOWLIST`
      ).toBe(true);
      expect(
        PAGED_IMPORT_RE.test(content),
        `${repoPath} now pages with fetchAllRows — remove it from ALLOWLIST`
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/highVolumeQueryGuard.test.ts`
Expected: PASS — 2 passed. This is a characterization test; the allowlist was verified against the tree during planning, so a first-run failure means the tree changed. If a failure names a file, follow the message: add a genuinely new offender to the allowlist (and note it for a follow-up PR), or remove a stale entry.

- [ ] **Step 3: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add tests/unit/highVolumeQueryGuard.test.ts && git commit -m "test(guard): add the high-volume query guard test" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: Add the E2E check for the basis labels

**Files:**
- Test: `tests/e2e/dashboard-basis-labels.spec.ts`

**Interfaces:**
- Consumes: the basis captions from Task 10 ('Cash basis', 'Accrual basis', 'Before other expenses') and the reconciliation line from Task 11 (`= Net $...`).
- Produces: the E2E coverage the workflow's E2E gate requires for this UI change.

The test signs up a fresh restaurant with no data. The dashboard then renders zero values, but the captions and the reconciliation line must still show. Task 11 renders the line without a `grossRevenue > 0` guard for this reason.

- [ ] **Step 1: Write the test**

Create `tests/e2e/dashboard-basis-labels.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

test.describe('dashboard basis labels', () => {
  test('shows the basis labels and the reconciliation line', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    await page.goto('/');
    await expect(page.getByText('Performance Overview')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Before other expenses')).toBeVisible();

    const cashflowHeading = page.getByRole('heading', { name: 'Cashflow', exact: true });
    await cashflowHeading.scrollIntoViewIfNeeded();
    await expect(page.getByText('Cash basis', { exact: true })).toBeVisible();
    await expect(page.getByText(/= Net \$/)).toBeVisible({ timeout: 20000 });

    const monthlyHeading = page.getByRole('heading', { name: 'Monthly Performance' });
    await monthlyHeading.scrollIntoViewIfNeeded();
    await expect(page.getByText('Accrual basis', { exact: true })).toBeVisible();
  });
});
```

`exact: true` on the Cashflow heading keeps the locator away from the "Cashflow Visualization" card title.

- [ ] **Step 2: Run the test**

Warning: the local Supabase stack must run first (`npm run db:start` if it does not).

Run: `npx playwright test tests/e2e/dashboard-basis-labels.spec.ts --reporter=line`
Expected: 1 passed

- [ ] **Step 3: Commit**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && git add tests/e2e/dashboard-basis-labels.spec.ts && git commit -m "test(e2e): check the dashboard basis labels" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Execution Notes

**Task order matters.** Tasks 1-2 build the shared pieces. Tasks 3-7 convert the fetches. Tasks 8-9 fix the labor formula. Tasks 10-11 wire the UI. Tasks 12-14 add the guardrails and the E2E check. Run Task 13 only after Tasks 3, 4, and 6 — the guard test expects the converted hooks to import the paged helpers.

**Full verification before the PR.** After Task 14, run the complete gate:

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && npm run typecheck && npm run lint && npx vitest run
```

Expected: typecheck clean, lint clean, all unit tests pass. Then run the two E2E specs that cover this change:

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/dashboard-aggregates && npx playwright test tests/e2e/dashboard-basis-labels.spec.ts tests/e2e/labor-cost-alignment.spec.ts --reporter=line
```

Expected: 2 passed. `labor-cost-alignment.spec.ts` must stay green after the Task 9 rewire — its fixture has no overtime and no tips, so both labor formulas give the same total.

**Out of scope for PR 1** (the spec lists these for later PRs — do not build them here):
- PR 2: the server RPCs `get_inventory_usage_totals` and `get_tip_totals` (pattern: migration `20260809120000_get_labor_sales_analytics.sql`).
- Security PR: membership checks for `get_pass_through_totals` and `get_revenue_by_account` (callers: `src/hooks/useRevenueBreakdown.tsx:171,184`, `src/hooks/useMonthlyMetrics.tsx:93,98`).
- The Deno labor timezone bug in `supabase/functions/_shared/laborCalculations.ts:497`.

