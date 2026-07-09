# Fix useUnifiedSales Pagination Offset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `useUnifiedSales` so "Load more" advances the pagination offset instead of re-fetching page 0, eliminating the duplicate-page accumulation that inflates the Grouped view's per-item totals.

**Architecture:** `useUnifiedSales` uses `useInfiniteQuery` where `pageParam` is the SQL row offset passed to `.range(from, to)`. `getNextPageParam` currently reads a phantom `lastPage.nextPage` (never set → always `0`), so every page re-fetches offset 0 and gets appended as a duplicate. Fix: derive the offset from `allPages.length * PAGE_SIZE`, and add an `id` tiebreaker to the ORDER BY so OFFSET paging is fully deterministic at page boundaries.

**Tech Stack:** React 18, TanStack React Query (`useInfiniteQuery`), Supabase JS client (`.from().select()...range()`), Vitest + `@testing-library/react` `renderHook`.

**Design doc:** `docs/superpowers/specs/2026-07-06-unified-sales-pagination-offset-design.md`

---

## File Structure

- **Modify:** `src/hooks/useUnifiedSales.tsx`
  - Line ~96-99: add `.order('id', { ascending: false })` as the final ORDER BY tiebreaker.
  - Line ~160: replace `getNextPageParam` with the `allPages`-derived offset.
- **Create:** `tests/unit/useUnifiedSales.pagination.test.ts`
  - Contract/regression test for offset advancement, no-duplicate-ids, short-first-page termination, and the `id` tiebreaker.

---

## Task 1: Pagination regression test (RED)

**Files:**
- Create: `tests/unit/useUnifiedSales.pagination.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useUnifiedSales.pagination.test.ts` with this exact content:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock auth + toast (hook calls useAuth() and useToast()) ---
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// --- Mock the Supabase client query builder ---
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useUnifiedSales } from '@/hooks/useUnifiedSales';

const PAGE_SIZE = 500;

// Records every .range() and .order() call the hook makes against unified_sales.
let rangeCalls: Array<[number, number]>;
let orderCalls: Array<[string, unknown]>;

// Build a distinct, non-overlapping page of rows for a given offset.
// IDs encode the offset so any duplicate page fetch is detectable by id.
function pageForOffset(from: number, size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${from + i}`,
    restaurant_id: 'rest-1',
    pos_system: 'toast',
    external_order_id: `ord-${from + i}`,
    external_item_id: `item-${from + i}`,
    item_name: `Item ${from + i}`,
    quantity: 1,
    unit_price: 1,
    total_price: 1,
    sale_date: '2026-07-01',
    sale_time: '10:00:00',
    pos_category: null,
    synced_at: null,
    created_at: '2026-07-01T10:00:00Z',
    category_id: null,
    suggested_category_id: null,
    ai_confidence: null,
    ai_reasoning: null,
    item_type: 'sale',
    adjustment_type: null,
    is_categorized: false,
    is_split: false,
    parent_sale_id: null,
    suggested_chart_account: null,
    approved_chart_account: null,
  }));
}

// Chainable builder: every method returns the builder; awaiting it resolves
// via `resolver`. `.range`/`.order` calls are captured for assertions.
function makeBuilder(resolver: (b: any) => { data: any; error: any }) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'not']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.order = vi.fn((col: string, opts: unknown) => {
    orderCalls.push([col, opts]);
    return builder;
  });
  builder.range = vi.fn((from: number, to: number) => {
    builder.__range = [from, to];
    rangeCalls.push([from, to]);
    return builder;
  });
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(resolver(builder)).then(onFulfilled, onRejected);
  return builder;
}

// `firstPageSize` controls whether more pages exist (=== PAGE_SIZE → hasMore).
function setup(firstPageSize: number) {
  rangeCalls = [];
  orderCalls = [];
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'recipes') {
      return makeBuilder(() => ({ data: [], error: null }));
    }
    // unified_sales: resolve the slice for whatever offset was requested.
    return makeBuilder((b) => {
      const [from] = b.__range as [number, number];
      const size = from === 0 ? firstPageSize : PAGE_SIZE;
      return { data: pageForOffset(from, size), error: null };
    });
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances the offset on Load more and never duplicates rows', async () => {
    setup(PAGE_SIZE); // full first page → hasMore true

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sales).toHaveLength(PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMoreSales();
    });

    await waitFor(() => expect(result.current.sales).toHaveLength(PAGE_SIZE * 2));

    // The SECOND unified_sales page must be fetched at offset PAGE_SIZE, not 0.
    const unifiedRanges = rangeCalls;
    expect(unifiedRanges[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(unifiedRanges[1]).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);

    // No duplicate ids across the two pages.
    const ids = result.current.sales.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stops paging when the first page is short (no dead-end Load more)', async () => {
    setup(12); // 12 < PAGE_SIZE → hasMore false

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sales).toHaveLength(12);
    expect(result.current.hasMore).toBe(false);
  });

  it('orders by a unique id tiebreaker for deterministic OFFSET paging', async () => {
    setup(PAGE_SIZE);

    const { result } = renderHook(() => useUnifiedSales('rest-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The ORDER BY chain must include an `id` ordering call.
    expect(orderCalls.some(([col]) => col === 'id')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/useUnifiedSales.pagination.test.ts`

Expected: FAIL. Specifically:
- "advances the offset…" fails — with the bug the second fetch is `[0, 499]` (so `unifiedRanges[1]` is `[0, 499]`, and duplicate ids collapse the Set), and `sales` length reaches `PAGE_SIZE * 2` only as duplicates, so the `new Set(ids).size === ids.length` assertion fails.
- "orders by a unique id tiebreaker…" fails — no `id` order call exists yet.
- "stops paging when the first page is short…" may already PASS (termination doesn't depend on the bug); that's fine — it guards the common path going forward.

---

## Task 2: Fix the offset + add tiebreaker (GREEN)

**Files:**
- Modify: `src/hooks/useUnifiedSales.tsx`

- [ ] **Step 1: Add the `id` ORDER BY tiebreaker**

In `src/hooks/useUnifiedSales.tsx`, find (around line 96-99):

```ts
      query = query
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);
```

Replace with:

```ts
      query = query
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
```

- [ ] **Step 2: Fix `getNextPageParam`**

Find (around line 160):

```ts
    getNextPageParam: (lastPage: any) => (lastPage?.hasMore ? (lastPage?.nextPage || 0) : undefined),
```

Replace with:

```ts
    getNextPageParam: (lastPage: any, allPages: any[]) =>
      lastPage?.hasMore ? allPages.length * PAGE_SIZE : undefined,
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm run test -- tests/unit/useUnifiedSales.pagination.test.ts`

Expected: PASS (all three tests green).

- [ ] **Step 4: Typecheck the changed files**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUnifiedSales.tsx tests/unit/useUnifiedSales.pagination.test.ts
git commit -m "fix(pos-sales): advance unified-sales pagination offset + id tiebreaker

getNextPageParam read a phantom lastPage.nextPage (always 0), so every
Load more re-fetched offset 0 and useInfiniteQuery appended a duplicate
page. flatSales accumulated N copies, inflating the client-side Grouped
totals (revenue/qty/sale_count) in lockstep. Derive the offset from
allPages.length * PAGE_SIZE, and add an id ORDER BY tiebreaker so OFFSET
paging is deterministic at page boundaries. Adds a pagination contract
test (offset advances, no duplicate ids, short-page termination).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:**
  - Fix `getNextPageParam` → Task 2 Step 2. ✅
  - `id` tiebreaker → Task 2 Step 1. ✅
  - Offset-advances + no-duplicate contract test → Task 1 test 1. ✅
  - Short-first-page termination test → Task 1 test 2. ✅
  - Tiebreaker verified in test → Task 1 test 3. ✅
  - Grouped-view server RPC → explicitly out of scope (design doc). ✅
- **Placeholder scan:** none — all code and commands are literal.
- **Type consistency:** `getNextPageParam` signature `(lastPage, allPages)` matches TanStack `useInfiniteQuery`; `PAGE_SIZE` is the existing module constant (500). `result.current.sales`, `.loading`, `.hasMore`, `.loadMoreSales` match the hook's returned API (lines 574-590). The builder mock exposes every method the hook chains (`select/eq/ilike/gte/lte/order/range` for unified_sales, `select/eq/not` for recipes).
```
