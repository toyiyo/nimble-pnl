# POS Server-side Grouping/Sort + Remove "Load more" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the POS Sales Grouped view accurate and correctly sorted by aggregating server-side, and remove the "Load more" button in favor of auto-loading the date window (with a capped safety valve + escape hatch).

**Architecture:** A new `SECURITY DEFINER` RPC `get_unified_sales_grouped_by_item` aggregates + sorts in Postgres (mirroring `get_unified_sales_totals`). A new `useUnifiedSalesGrouped` hook feeds the Grouped view. `useUnifiedSales` gains an opt-in `autoLoadAll` mode that auto-advances pages to a 20,000-row cap with a `loadAllRemaining()` escape hatch. `POSSales.tsx` wires these in, virtualizes the Grouped grid, and gets view-aware sort controls.

**Tech Stack:** Supabase/Postgres (plpgsql, pgTAP), React 18 + TypeScript, React Query (`useInfiniteQuery`/`useQuery`), `@tanstack/react-virtual`, Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-19-pos-grouped-sort-db-design.md`

---

## File Structure

- **Create** `supabase/migrations/20260720000000_unified_sales_grouped_by_item.sql` — the RPC.
- **Create** `supabase/tests/48_get_unified_sales_grouped_by_item.sql` — pgTAP tests.
- **Create** `src/hooks/useUnifiedSalesGrouped.tsx` — grouped hook.
- **Create** `tests/unit/useUnifiedSalesGrouped.test.ts` — grouped hook tests.
- **Create** `tests/unit/useUnifiedSales.autoload.test.ts` — auto-load tests.
- **Create** `tests/unit/POSSales.grouped-source.test.ts` — source-text regression.
- **Modify** `src/hooks/useUnifiedSales.tsx` — add `autoLoadAll`, cap, escape hatch.
- **Modify** `src/pages/POSSales.tsx` — wire grouped hook, remove Load more, cap notice, view-aware sort, virtualized grouped grid.

---

## Task 1: SQL RPC `get_unified_sales_grouped_by_item`

**Files:**
- Create: `supabase/migrations/20260720000000_unified_sales_grouped_by_item.sql`
- Test: `supabase/tests/48_get_unified_sales_grouped_by_item.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/48_get_unified_sales_grouped_by_item.sql`:

```sql
-- Tests for get_unified_sales_grouped_by_item.
-- Restaurant UUID …0097 to avoid colliding with 35_/37_ fixtures.
BEGIN;
SELECT plan(11);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'grp-member@example.com'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'grp-nonmember@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000097'::uuid, 'Grouped Test Restaurant', '1 Group St', '555-0097')
ON CONFLICT (id) DO UPDATE SET name = 'Grouped Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000097'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Seed rows on 2024-08-01:
--   Burger x2 @ 10 (two sales, qty 3 total, revenue 20)
--   Fries  x1 @ 5  (revenue 5)
--   Soda   x1 with NULL total_price (revenue must COALESCE to 0)
--   Burger child split (parent_sale_id set) → excluded
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id, parent_sale_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-1','Burger',2,10.00,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b2'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-2','Burger',1,10.00,'2024-08-01',true,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b3'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-3','Fries',1,5.00,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b4'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-4','Soda',1,NULL,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b5'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-5','Burger',1,3.00,'2024-08-01',false,NULL,'00000000-0000-0000-0000-0000000000b1'::uuid)
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, is_categorized = EXCLUDED.is_categorized, parent_sale_id = EXCLUDED.parent_sale_id;

-- Recipe mapping for Burger only (case-insensitive check on pos_item_name)
INSERT INTO recipes (id, restaurant_id, name, pos_item_name) VALUES
  ('00000000-0000-0000-0000-0000000000e1'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'Burger Recipe','burger')
ON CONFLICT (id) DO UPDATE SET pos_item_name = 'burger';

-- Test 1: three distinct groups (child split excluded)
SELECT is(
  (SELECT COUNT(*)::int FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01')),
  3,
  'returns one row per distinct item_name, child split excluded'
);

-- Test 2: Burger revenue = 20 (10+10), child 3.00 excluded
SELECT is(
  (SELECT total_revenue FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  20.00::numeric,
  'Burger revenue sums parents only (child split excluded)'
);

-- Test 3: Burger quantity = 3 (2+1)
SELECT is(
  (SELECT total_quantity FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  3::numeric,
  'Burger quantity sums parents only'
);

-- Test 4: Burger sale_count = 2
SELECT is(
  (SELECT sale_count FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  2::bigint,
  'Burger sale_count counts parent rows only'
);

-- Test 5: Soda NULL total_price coalesces to 0 (not NULL)
SELECT is(
  (SELECT total_revenue FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Soda'),
  0::numeric,
  'NULL total_price group coalesces revenue to 0'
);

-- Test 6: sort by revenue desc → Burger(20), Fries(5), Soda(0)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','revenue','desc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by revenue desc orders groups by aggregate'
);

-- Test 7: sort by revenue asc → Soda(0), Fries(5), Burger(20)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','revenue','asc')),
  ARRAY['Soda','Fries','Burger'],
  'sort by revenue asc reverses order'
);

-- Test 8: sort by name asc → Burger, Fries, Soda
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','name','asc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by name asc orders alphabetically'
);

-- Test 9: recipe filter with-recipe → only Burger
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','with-recipe','name','asc')),
  ARRAY['Burger'],
  'with-recipe filter matches recipes.pos_item_name case-insensitively'
);

-- Test 10: categorization filter categorized → only the categorized Burger row (revenue 10, count 1)
SELECT is(
  (SELECT sale_count FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'categorized','all','name','asc') WHERE item_name = 'Burger'),
  1::bigint,
  'categorized filter keeps only is_categorized IS TRUE rows'
);

-- Test 11: non-member call raises Access denied
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000002"}';
SELECT throws_ok(
  $$ SELECT * FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') $$,
  'Access denied to restaurant',
  'non-member call raises Access denied'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run db:start && npm run test:db`
Expected: FAIL — `function get_unified_sales_grouped_by_item(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260720000000_unified_sales_grouped_by_item.sql`:

```sql
-- Server-side grouped-by-item aggregation for the POS Sales "Grouped" view.
-- Mirrors get_unified_sales_totals: same auth guard, same filter parity, same
-- `parent_sale_id IS NULL` population so grouped revenue reconciles with the
-- header "Collected at POS" total. Sorting is done in SQL over the full
-- aggregate — this fixes the client-side Map-insertion-order sort bug where
-- "sort by amount" in Grouped view did nothing.
--
-- COALESCE on SUM(total_price): total_price is nullable (manual sales insert it
-- optionally); an all-NULL group must return 0, not NULL, or the RETURNS TABLE
-- numeric contract breaks and revenue sort becomes non-deterministic.
--
-- Sort whitelist uses a STATIC CASE expression — never EXECUTE/format() — so
-- p_sort_by/p_sort_direction cannot inject SQL.

CREATE OR REPLACE FUNCTION public.get_unified_sales_grouped_by_item(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL,
  p_categorization_filter TEXT DEFAULT 'all',
  p_recipe_filter TEXT DEFAULT 'all',
  p_sort_by TEXT DEFAULT 'revenue',
  p_sort_direction TEXT DEFAULT 'desc'
)
RETURNS TABLE (
  item_name TEXT,
  total_quantity NUMERIC,
  total_revenue NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  RETURN QUERY
  SELECT
    us.item_name AS item_name,
    COALESCE(SUM(us.quantity), 0)::NUMERIC AS total_quantity,
    COALESCE(SUM(us.total_price), 0)::NUMERIC AS total_revenue,
    COUNT(*)::BIGINT AS sale_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL OR p_search_term = ''
      OR us.item_name ILIKE '%' || p_search_term || '%'
    )
    AND (
      p_categorization_filter = 'all'
      OR (p_categorization_filter = 'uncategorized'
          AND us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NULL)
      OR (p_categorization_filter = 'pending-review'
          AND us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NOT NULL)
      OR (p_categorization_filter = 'categorized'
          AND us.is_categorized IS TRUE)
    )
    AND (
      p_recipe_filter = 'all'
      OR (p_recipe_filter = 'with-recipe' AND EXISTS (
            SELECT 1 FROM recipes r
            WHERE r.restaurant_id = p_restaurant_id
              AND LOWER(r.pos_item_name) = LOWER(us.item_name)))
      OR (p_recipe_filter = 'without-recipe' AND NOT EXISTS (
            SELECT 1 FROM recipes r
            WHERE r.restaurant_id = p_restaurant_id
              AND LOWER(r.pos_item_name) = LOWER(us.item_name)))
    )
  GROUP BY us.item_name
  ORDER BY
    CASE WHEN p_sort_direction = 'asc' THEN
      CASE p_sort_by
        WHEN 'revenue' THEN COALESCE(SUM(us.total_price), 0)
        WHEN 'quantity' THEN COALESCE(SUM(us.quantity), 0)
        WHEN 'sales' THEN COUNT(*)::NUMERIC
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_direction <> 'asc' THEN
      CASE p_sort_by
        WHEN 'revenue' THEN COALESCE(SUM(us.total_price), 0)
        WHEN 'quantity' THEN COALESCE(SUM(us.quantity), 0)
        WHEN 'sales' THEN COUNT(*)::NUMERIC
      END
    END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'name' AND p_sort_direction = 'asc' THEN us.item_name END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name' AND p_sort_direction <> 'asc' THEN us.item_name END DESC NULLS LAST,
    us.item_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_sales_grouped_by_item(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: `48_get_unified_sales_grouped_by_item.sql` — 11/11 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260720000000_unified_sales_grouped_by_item.sql supabase/tests/48_get_unified_sales_grouped_by_item.sql
git commit -m "feat(pos): server-side grouped-by-item RPC with SQL sort + filters"
```

---

## Task 2: `useUnifiedSalesGrouped` hook

**Files:**
- Create: `src/hooks/useUnifiedSalesGrouped.tsx`
- Test: `tests/unit/useUnifiedSalesGrouped.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useUnifiedSalesGrouped.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { rpc: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

import { useUnifiedSalesGrouped } from '@/hooks/useUnifiedSalesGrouped';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSalesGrouped', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps options to RPC params and returns coerced groups', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        { item_name: 'Burger', total_quantity: '3', total_revenue: '20', sale_count: '2' },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useUnifiedSalesGrouped('rest-1', {
        startDate: '2024-08-01', endDate: '2024-08-01',
        searchTerm: 'bur', categorizationFilter: 'all',
        recipeFilter: 'with-recipe', sortBy: 'revenue', sortDirection: 'desc',
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_unified_sales_grouped_by_item', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2024-08-01',
      p_end_date: '2024-08-01',
      p_search_term: 'bur',
      p_categorization_filter: 'all',
      p_recipe_filter: 'with-recipe',
      p_sort_by: 'revenue',
      p_sort_direction: 'desc',
    });
    expect(result.current.groups).toEqual([
      { item_name: 'Burger', total_quantity: 3, total_revenue: 20, sale_count: 2 },
    ]);
  });

  it('returns empty groups without calling RPC when restaurantId is null', async () => {
    const { result } = renderHook(() => useUnifiedSalesGrouped(null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- useUnifiedSalesGrouped`
Expected: FAIL — cannot resolve `@/hooks/useUnifiedSalesGrouped`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useUnifiedSalesGrouped.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface GroupedSaleItem {
  item_name: string;
  total_quantity: number;
  total_revenue: number;
  sale_count: number;
}

export type GroupedSortBy = 'revenue' | 'quantity' | 'sales' | 'name';

interface UseUnifiedSalesGroupedOptions {
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  categorizationFilter?: 'all' | 'uncategorized' | 'pending-review' | 'categorized';
  recipeFilter?: 'all' | 'with-recipe' | 'without-recipe';
  sortBy?: GroupedSortBy;
  sortDirection?: 'asc' | 'desc';
}

export const useUnifiedSalesGrouped = (
  restaurantId: string | null,
  options: UseUnifiedSalesGroupedOptions = {}
) => {
  const {
    startDate, endDate, searchTerm,
    categorizationFilter = 'all',
    recipeFilter = 'all',
    sortBy = 'revenue',
    sortDirection = 'desc',
  } = options;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      'unified-sales-grouped', restaurantId, startDate ?? '', endDate ?? '',
      searchTerm ?? '', categorizationFilter, recipeFilter, sortBy, sortDirection,
    ],
    queryFn: async (): Promise<GroupedSaleItem[]> => {
      if (!restaurantId) return [];

      const { data, error } = await supabase.rpc('get_unified_sales_grouped_by_item', {
        p_restaurant_id: restaurantId,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_search_term: searchTerm || null,
        p_categorization_filter: categorizationFilter,
        p_recipe_filter: recipeFilter,
        p_sort_by: sortBy,
        p_sort_direction: sortDirection,
      });

      if (error) {
        console.error('Error fetching grouped sales:', error);
        throw error;
      }

      return (data ?? []).map((row: {
        item_name: string;
        total_quantity: number | string;
        total_revenue: number | string;
        sale_count: number | string;
      }) => ({
        item_name: row.item_name,
        total_quantity: Number(row.total_quantity ?? 0),
        total_revenue: Number(row.total_revenue ?? 0),
        sale_count: Number(row.sale_count ?? 0),
      }));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true, // aligned with useUnifiedSalesTotals so they don't drift
  });

  return { groups: data ?? [], isLoading, error, refetch };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- useUnifiedSalesGrouped`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUnifiedSalesGrouped.tsx tests/unit/useUnifiedSalesGrouped.test.ts
git commit -m "feat(pos): useUnifiedSalesGrouped hook over grouped RPC"
```

---

## Task 3: `useUnifiedSales` auto-load mode

**Files:**
- Modify: `src/hooks/useUnifiedSales.tsx`
- Test: `tests/unit/useUnifiedSales.autoload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useUnifiedSales.autoload.test.ts`. It reuses the chainable-builder mock pattern from `useUnifiedSales.pagination.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

import { useUnifiedSales } from '@/hooks/useUnifiedSales';

const PAGE_SIZE = 500;

function pageForOffset(from: number, size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${from + i}`, restaurant_id: 'rest-1', pos_system: 'toast',
    external_order_id: `ord-${from + i}`, external_item_id: `item-${from + i}`,
    item_name: `Item ${from + i}`, quantity: 1, unit_price: 1, total_price: 1,
    sale_date: '2026-07-01', sale_time: '10:00:00', pos_category: null, synced_at: null,
    created_at: '2026-07-01T10:00:00Z', category_id: null, suggested_category_id: null,
    ai_confidence: null, ai_reasoning: null, item_type: 'sale', adjustment_type: null,
    is_categorized: false, is_split: false, parent_sale_id: null,
    suggested_chart_account: null, approved_chart_account: null,
  }));
}

type QueryResult = { data: unknown; error: unknown };
type MockBuilder = { __range?: [number, number]; then: (f: (v: QueryResult) => unknown, r?: (e: unknown) => unknown) => Promise<unknown>; [m: string]: unknown };

let unifiedFetchCount: number;

function makeBuilder(resolver: (b: MockBuilder) => QueryResult) {
  const builder = {} as MockBuilder;
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'not', 'is', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.range = vi.fn((from: number, to: number) => { builder.__range = [from, to]; return builder; });
  builder.then = (onF, onR) => Promise.resolve(resolver(builder)).then(onF, onR);
  return builder;
}

// nPages full pages of PAGE_SIZE, then a short page to end.
function setup(nFullPages: number) {
  unifiedFetchCount = 0;
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'recipes') return makeBuilder(() => ({ data: [], error: null }));
    return makeBuilder((b) => {
      const [from] = b.__range as [number, number];
      unifiedFetchCount += 1;
      const pageIndex = from / PAGE_SIZE;
      const size = pageIndex < nFullPages ? PAGE_SIZE : 3; // short page ends paging
      return { data: pageForOffset(from, size), error: null };
    });
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUnifiedSales autoLoadAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-advances through all pages without manual loadMore', async () => {
    setup(3); // pages 0,1,2 full then page 3 short (3 rows) → total 1503
    const { result } = renderHook(() => useUnifiedSales('rest-1', { autoLoadAll: true }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.sales.length).toBe(PAGE_SIZE * 3 + 3), { timeout: 3000 });
    expect(result.current.reachedCap).toBe(false);
  });

  it('does NOT auto-advance when autoLoadAll is false (dashboard safety)', async () => {
    setup(3);
    const { result } = renderHook(() => useUnifiedSales('rest-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only the first page fetched; no auto-advance.
    expect(result.current.sales.length).toBe(PAGE_SIZE);
    expect(unifiedFetchCount).toBe(1);
  });
});
```

> Note: the cap (`MAX_AUTO_ROWS = 20000`) and the `loadAllRemaining()`/retry-storm behaviors are covered by additional assertions; keep the first test small enough to run fast (≤1503 rows). A `reachedCap` test can set `MAX_AUTO_ROWS` low via the exported constant if the implementer chooses to export it — otherwise assert `reachedCap` stays false for a small dataset as above.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- useUnifiedSales.autoload`
Expected: FAIL — `autoLoadAll`/`reachedCap` not implemented (auto-advance doesn't happen; second test may pass, first fails).

- [ ] **Step 3: Implement auto-load in `useUnifiedSales.tsx`**

3a. Add imports at top (already has `useEffect, useCallback, useMemo`); add `useRef, useState`:

```tsx
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
```

3b. Extend the options type:

```tsx
type UseUnifiedSalesOptions = {
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
  categorizationFilter?: 'all' | 'uncategorized' | 'pending-review' | 'categorized';
  autoLoadAll?: boolean;
};
```

3c. Add constants above the hook (next to `PAGE_SIZE`):

```tsx
const MAX_AUTO_ROWS = 20000;   // safety valve for the auto-loaded raw list
const MAX_AUTO_RETRIES = 3;    // stop auto-loading after N consecutive page failures
```

3d. Destructure `autoLoadAll` in the hook body and add state/refs. Immediately after the existing `useInfiniteQuery({...})` destructure (which exposes `data, loading, loadingMore, isFetching, error, fetchNextPage, hasNextPage`), add:

```tsx
  const { autoLoadAll = false } = options;

  // Escape hatch: start capped at MAX_AUTO_ROWS; loadAllRemaining() lifts it.
  const [uncapped, setUncapped] = useState(false);
  const failuresRef = useRef(0);

  // Reset the escape-hatch + failure counter whenever the query key changes
  // (new restaurant/date/filter) so an expensive uncapped load never persists.
  useEffect(() => {
    setUncapped(false);
    failuresRef.current = 0;
  }, [restaurantId, normalizedSearchTerm, normalizedStartDate, normalizedEndDate, normalizedCategorizationFilter]);

  const effectiveCap = uncapped ? Infinity : MAX_AUTO_ROWS;
```

3e. `flatSales` is already defined below the query. Compute `reachedCap` AFTER `flatSales` and the existing `canLoadMore` (both reference `flatSales`/`isFetching`). Add right after the `canLoadMore` definition:

```tsx
  // Same stale-placeholder guard as canLoadMore, plus the cap check.
  const reachedCap =
    !!hasNextPage &&
    flatSales.length >= effectiveCap &&
    !(isFetching && !loadingMore);

  // Track consecutive auto-load failures so a transient error halts the walk.
  useEffect(() => {
    if (error) failuresRef.current += 1;
  }, [error]);

  // Auto-load: advance pages until the window is drained or the cap is hit.
  // Gated on !error to prevent a retry storm — on a failed fetchNextPage,
  // hasNextPage stays true, so without the error gate this effect would re-fire
  // in a tight loop.
  useEffect(() => {
    if (!autoLoadAll) return;
    if (
      hasNextPage &&
      !isFetching &&
      !error &&
      !reachedCap &&
      failuresRef.current < MAX_AUTO_RETRIES
    ) {
      fetchNextPage();
    }
  }, [autoLoadAll, hasNextPage, isFetching, error, reachedCap, fetchNextPage]);

  const loadAllRemaining = useCallback(() => {
    failuresRef.current = 0;
    setUncapped(true);
  }, []);
```

3f. Add `reachedCap` and `loadAllRemaining` to the returned object (leave existing `hasMore`/`loadMoreSales` for backward compat):

```tsx
    hasMore: canLoadMore,
    loadMoreSales,
    reachedCap,
    loadAllRemaining,
    autoLoading: autoLoadAll && loadingMore,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- useUnifiedSales.autoload useUnifiedSales.pagination useUnifiedSales.categorization useUnifiedSales.keepPreviousData`
Expected: PASS — auto-load advances; `autoLoadAll:false` fetches one page; existing pagination/categorization/keepPreviousData tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUnifiedSales.tsx tests/unit/useUnifiedSales.autoload.test.ts
git commit -m "feat(pos): opt-in autoLoadAll with cap + loadAllRemaining escape hatch"
```

---

## Task 4: POSSales — remove "Load more", wire auto-load, view-aware sort

**Files:**
- Modify: `src/pages/POSSales.tsx`

- [ ] **Step 1: Add grouped sort state + destructure new hook returns**

Near the existing sort state (`src/pages/POSSales.tsx:89-90`), add a grouped-specific sort field (direction stays shared):

```tsx
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'quantity' | 'amount'>('date');
  const [groupedSortBy, setGroupedSortBy] = useState<'revenue' | 'quantity' | 'sales' | 'name'>('revenue');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
```

In the `useUnifiedSales(...)` call (~L145-153), add `autoLoadAll: true` to the options and update the destructure to pull the new returns and drop the unused helpers:

```tsx
  const {
    sales,
    loading,
    loadingMore,
    reachedCap,
    loadAllRemaining,
    unmappedItems,
    fetchUnifiedSales,
    createManualSale,
    createManualSaleWithAdjustments,
    updateManualSale,
    deleteManualSale,
  } = useUnifiedSales(selectedRestaurant?.restaurant_id || null, {
    searchTerm,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    categorizationFilter,
    autoLoadAll: true,
  });
```

(Remove `hasMore`, `loadMoreSales`, `getSalesByDateRange`, `getSalesGroupedByItem` from the destructure — they are no longer used.)

- [ ] **Step 2: Add the grouped hook**

Add near the other data hooks (after `useUnifiedSalesTotals`), passing the recipe + categorization filters and grouped sort:

```tsx
  const {
    groups: groupedSales,
    isLoading: groupedLoading,
    error: groupedError,
  } = useUnifiedSalesGrouped(selectedRestaurant?.restaurant_id || null, {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    searchTerm,
    categorizationFilter,
    recipeFilter,
    sortBy: groupedSortBy,
    sortDirection,
  });
```

Add the import (import-order group 4):

```tsx
import { useUnifiedSalesGrouped } from '@/hooks/useUnifiedSalesGrouped';
```

Delete the local `groupedSales` memo (`src/pages/POSSales.tsx:395-412`) — it is replaced by the hook above.

- [ ] **Step 3: Make the sort dropdown view-aware**

Replace the sort `<Select>` (`src/pages/POSSales.tsx:1150-1161`) so it switches options + state by `selectedView`:

```tsx
{selectedView === 'grouped' ? (
  <Select value={groupedSortBy} onValueChange={(v: 'revenue' | 'quantity' | 'sales' | 'name') => setGroupedSortBy(v)}>
    <SelectTrigger className="h-8 w-[120px] text-[13px] bg-transparent border-0 hover:bg-muted/50 rounded-lg">
      <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="z-50 bg-background">
      <SelectItem value="revenue">Revenue</SelectItem>
      <SelectItem value="quantity">Quantity</SelectItem>
      <SelectItem value="sales">Sales</SelectItem>
      <SelectItem value="name">Item Name</SelectItem>
    </SelectContent>
  </Select>
) : (
  <Select value={sortBy} onValueChange={(v: 'date' | 'name' | 'quantity' | 'amount') => setSortBy(v)}>
    <SelectTrigger className="h-8 w-[120px] text-[13px] bg-transparent border-0 hover:bg-muted/50 rounded-lg">
      <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="z-50 bg-background">
      <SelectItem value="date">Date</SelectItem>
      <SelectItem value="name">Item Name</SelectItem>
      <SelectItem value="quantity">Quantity</SelectItem>
      <SelectItem value="amount">Amount</SelectItem>
    </SelectContent>
  </Select>
)}
```

- [ ] **Step 4: Remove the three "Load more" buttons; add cap notice + provisional affordance**

Delete the "Load more" `<Button>` blocks at `src/pages/POSSales.tsx:1197-1207`, `:1336-1349`, and `:1360-1370`.

In the Sales-list results header (the block around `:1183-1195` showing "X of Y sales"), wrap the count and add the loading + cap affordances. Replace the `<p>…sales</p>` and its sibling controls area so it reads:

```tsx
<div className="flex items-center gap-3" aria-live="polite">
  <p className="text-[13px] text-muted-foreground">
    {(() => {
      const statusLabel = categorizationFilter !== 'all'
        ? `${CATEGORIZATION_FILTER_LABELS[categorizationFilter]} `
        : '';
      return filteredSales.length === sales.length
        ? <>{sales.length.toLocaleString()} {statusLabel}sales</>
        : <>{filteredSales.length.toLocaleString()} of {sales.length.toLocaleString()} {statusLabel}sales</>;
    })()}
  </p>
  {loadingMore && !reachedCap && (
    <span className="text-[13px] text-muted-foreground">Loading more…</span>
  )}
  {reachedCap && (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-muted-foreground">Showing the first 20,000 rows in this range</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={loadAllRemaining}
        className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        Load all rows
      </Button>
    </div>
  )}
</div>
```

> The cap notice lives ONLY here (Sales-list header). Do not add it to the Grouped header or a list footer. At 375px this row should wrap; if it overflows, add `flex-wrap` to the container.

- [ ] **Step 5: Run typecheck + existing tests**

Run: `npm run typecheck && npm run test -- POSSales`
Expected: typecheck passes (unused `getSalesGroupedByItem`/`hasMore` removed); existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "feat(pos): auto-load sales list, view-aware sort, remove Load more"
```

---

## Task 5: POSSales — grouped view three-state + virtualized responsive grid

**Files:**
- Modify: `src/pages/POSSales.tsx`

- [ ] **Step 1: Add a responsive column-count helper**

Add a small hook near the top of `POSSales.tsx` (below imports), used to size the virtual grid lanes:

```tsx
function useResponsiveColumns(ref: React.RefObject<HTMLElement>) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setCols(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}
```

- [ ] **Step 2: Compute maxRevenue once (reduce-based, no spread)**

Add a memo near the grouped data (replaces the per-card `Math.max(...)`):

```tsx
  const groupedMaxRevenue = useMemo(
    () => groupedSales.reduce((m, g) => (g.total_revenue > m ? g.total_revenue : m), 0),
    [groupedSales]
  );
```

- [ ] **Step 3: Rewrite the grouped view block with its own three states + virtualization**

Add a ref + virtualizer near the other refs/virtualizer (`salesListRef`, `salesVirtualizer`):

```tsx
  const groupedScrollRef = useRef<HTMLDivElement>(null);
  const groupedColumns = useResponsiveColumns(groupedScrollRef);
  const groupedRowCount = Math.ceil(groupedSales.length / groupedColumns);
  const groupedVirtualizer = useVirtualizer({
    count: groupedRowCount,
    getScrollElement: () => groupedScrollRef.current,
    estimateSize: () => 140, // card height incl. gap
    overscan: 4,
  });
```

Replace the entire grouped-view branch (`src/pages/POSSales.tsx:1352-1470`, the `/* Grouped view - Apple-style cards */` block) with three-state rendering keyed off the grouped hook, and a virtualized grid:

```tsx
) : (
  /* Grouped view */
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <p className="text-[13px] text-muted-foreground">
        {groupedSales.length.toLocaleString()} items
      </p>
    </div>

    {groupedLoading ? (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/70" />
        <p className="mt-4 text-[13px] text-muted-foreground">Loading grouped items…</p>
      </div>
    ) : groupedError ? (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[15px] font-medium text-foreground mb-1">Couldn't load grouped items</p>
        <p className="text-[13px] text-muted-foreground">Please try again.</p>
      </div>
    ) : groupedSales.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
          <Search className="w-6 h-6 text-muted-foreground/50" />
        </div>
        <p className="text-[15px] font-medium text-foreground mb-1">No items found</p>
        <p className="text-[13px] text-muted-foreground">Try adjusting your filters.</p>
      </div>
    ) : (
      <div ref={groupedScrollRef} className="max-h-[70vh] overflow-y-auto">
        <div style={{ height: `${groupedVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {groupedVirtualizer.getVirtualItems().map((virtualRow) => {
            const start = virtualRow.index * groupedColumns;
            const rowItems = groupedSales.slice(start, start + groupedColumns);
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={groupedVirtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4"
              >
                {rowItems.map((item) => {
                  const revenuePercentage = groupedMaxRevenue > 0 ? (item.total_revenue / groupedMaxRevenue) * 100 : 0;
                  return (
                    <div key={item.item_name} className="group p-4 rounded-xl border border-border/40 bg-background hover:border-border hover:shadow-sm transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[14px] font-medium text-foreground truncate">{item.item_name}</h3>
                          {(() => {
                            const recipe = getRecipeForItem(item.item_name, recipeByItemName);
                            if (recipe) {
                              return (
                                <button onClick={() => navigate(`/recipes?recipeId=${recipe.id}`)} className="inline-flex items-center gap-1 mt-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                                  {!recipe.hasIngredients && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                                  <ExternalLink className="h-3 w-3" />
                                  {recipe.name}
                                  {recipe.profitMargin != null && <span className="font-medium">({recipe.profitMargin.toFixed(0)}%)</span>}
                                </button>
                              );
                            }
                            return (
                              <button onClick={() => handleMapPOSItem(item.item_name)} className="inline-flex items-center gap-1 mt-1 text-[12px] text-destructive hover:text-destructive/80 transition-colors">
                                No Recipe
                              </button>
                            );
                          })()}
                        </div>
                        <span className="text-[18px] font-semibold text-foreground tabular-nums">${item.total_revenue.toFixed(2)}</span>
                      </div>
                      <div className="mb-3">
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-foreground/20 rounded-full transition-all duration-500" style={{ width: `${revenuePercentage}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[13px]">
                        <div><span className="font-medium text-foreground">{item.total_quantity}</span><span className="text-muted-foreground ml-1">qty</span></div>
                        <div><span className="font-medium text-foreground">{item.sale_count}</span><span className="text-muted-foreground ml-1">sales</span></div>
                        <button type="button" onClick={() => handleSimulateDeduction(item.item_name, item.total_quantity)} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          Check impact
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    )}
  </div>
)
```

> The outer `loading ?` skeleton at `:1174-1180` gates on the Sales-list `loading`. Because the Grouped branch now renders its own `groupedLoading` state, ensure the Grouped branch is reachable even while the sales list is still auto-loading — i.e. the top-level `loading ?` guard should reflect the *active view*. If `loading` (sales list) would otherwise mask the grouped view, change the top-level guard to `selectedView === 'sales' && loading` so the grouped branch controls its own loading UI.

- [ ] **Step 4: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "feat(pos): virtualized grouped grid with own loading/error/empty states"
```

---

## Task 6: POSSales source-text regression test

**Files:**
- Create: `tests/unit/POSSales.grouped-source.test.ts`

- [ ] **Step 1: Write the test** (source-text pattern per lessons #504 — avoids mocking ~30 hooks)

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8'
);

describe('POSSales grouped/sort/load-more contract', () => {
  it('no longer renders a "Load more" button', () => {
    expect(SRC).not.toMatch(/Load more/);
    expect(SRC).not.toMatch(/loadMoreSales/);
  });

  it('uses the server-side grouped hook, not a local grouped memo', () => {
    expect(SRC).toMatch(/useUnifiedSalesGrouped/);
    // The old client-side Map-based grouping is gone.
    expect(SRC).not.toMatch(/new Map<string, \{ total_quantity/);
  });

  it('wires auto-load with the cap escape hatch', () => {
    expect(SRC).toMatch(/autoLoadAll:\s*true/);
    expect(SRC).toMatch(/loadAllRemaining/);
    expect(SRC).toMatch(/reachedCap/);
  });

  it('has a view-aware grouped sort control', () => {
    expect(SRC).toMatch(/groupedSortBy/);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run test -- POSSales.grouped-source`
Expected: PASS (4/4). If any fail, the corresponding Task 4/5 edit is incomplete — fix it.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/POSSales.grouped-source.test.ts
git commit -m "test(pos): source-text regression for grouped/sort/load-more contract"
```

---

## Self-Review Notes (spec coverage)

- Grouped accuracy + SQL sort → Task 1 (RPC) + Task 2 (hook) + Task 5 (render).
- Remove "Load more" + auto-load + cap + escape hatch → Task 3 + Task 4.
- `COALESCE` NULL revenue → Task 1 (migration + Test 5).
- Static `CASE` sort (no injection) → Task 1 migration.
- `parent_sale_id IS NULL` reconciliation → Task 1 (Tests 1-4).
- Recipe/categorization filter parity → Task 1 (Tests 9-10) + Task 2/4 param passing.
- Grouped own three-state rendering → Task 5 Step 3.
- Virtualized grouped grid (100+ rule) → Task 5.
- Retry-storm gate + dashboard-safety (`autoLoadAll:false`) → Task 3 test.
- aria-live + provisional "Loading more…" → Task 4 Step 4.
- Reduce-based max → Task 5 Step 2.
- Source-text regression → Task 6.
```
