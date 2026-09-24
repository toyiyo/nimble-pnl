# Dashboard "This Month" Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two serial `inventory_transactions` page chains with one DB rollup RPC, and make the period switch feel instant.

**Architecture:** A new `get_inventory_usage_by_day` RPC aggregates usage cost per day in the database. A new `useInventoryUsageByDay` hook calls it. `useFoodCosts` becomes a thin wrapper over the new hook. `useMonthlyMetrics` swaps its inventory page chain for one RPC call and fetches its months concurrently. `Index.tsx` gets `startTransition`, guarded `placeholderData`, a data-presence skeleton gate, and an `isFetching` dimming state. Five presentational components get `React.memo`. `ChatMessage` loads lazily.

**Tech Stack:** React 18, TypeScript, React Query (TanStack v5), Supabase (PostgreSQL RPC, RLS), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-30-dashboard-this-month-perf-design.md` (commit 36e27c64).

## Global Constraints

- Write all prose (comments, commit messages) STE-aligned per `docs/STE100_STYLE.md`. Keep code identifiers exact.
- Do NOT edit the bodies of `src/hooks/useUnifiedCOGS.tsx`, `src/services/cogsFetch.ts`, `src/services/cogsCalculations.ts`. Peer sessions own them. Imports from them are allowed.
- The RPC must return the same numbers as the client code it replaces: ABS per row, `transaction_date` wins over `created_at`, UTC fallback for NULL `transaction_date`, end bound `23:59:59.999`.
- Keep `refetchOnWindowFocus: true` where a hook already sets it. Do not add manual caching.
- Commit with `git commit --no-verify`, explicit file paths, and this trailer on the last line of the message body: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- This is a BSD/bash-3.2 machine. `timeout` and `gtimeout` do not exist. Bound every wait with the Bash tool `timeout` parameter.
- Warning: before Task 1, run `ls supabase/migrations | tail -3`. The newest known migration is `20260821190923_remove_bank_categorization_insert_trigger.sql`. If a peer session added a migration with a timestamp at or after `20260830120000`, rename both new migration files to later timestamps.

---

### Task 1: `get_inventory_usage_by_day` RPC, partial index, pgTAP test

**Files:**
- Create: `supabase/tests/69_inventory_usage_by_day.sql`
- Create: `supabase/migrations/20260830120000_get_inventory_usage_by_day.sql`
- Create: `supabase/migrations/20260830120500_idx_inventory_transactions_usage_date.sql`

**Interfaces:**
- Consumes: table `public.inventory_transactions` (columns `restaurant_id UUID`, `transaction_type TEXT`, `transaction_date DATE` nullable, `created_at TIMESTAMPTZ`, `total_cost NUMERIC` nullable). RLS SELECT policy: `user_has_capability(restaurant_id, 'view:inventory')`.
- Produces: `public.get_inventory_usage_by_day(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE) RETURNS TABLE(day DATE, food_cost NUMERIC)`. Tasks 2 and 4 call it as `supabase.rpc('get_inventory_usage_by_day', { p_restaurant_id, p_start_date, p_end_date })`.

- [ ] **Step 1: Check the migration timestamp slot**

Run: `ls supabase/migrations | tail -3`
Expected: the last line is `20260821190923_remove_bank_categorization_insert_trigger.sql`. If a later timestamp exists, pick new timestamps after it for both files in this task.

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/69_inventory_usage_by_day.sql`:

```sql
-- Tests get_inventory_usage_by_day (dashboard COGS per-day rollup).
-- The RPC runs as SECURITY INVOKER: RLS on inventory_transactions scopes the
-- caller, so a non-member sees zero rows rather than an error.
--
-- Assertions:
--   1. Per-row ABS: -10 and +2 on one day give food_cost 12, not 8. The
--      rows carry created_at in September but transaction_date '2026-04-05':
--      transaction_date drives the bucket and the filter.
--   2. A NULL transaction_date falls back to created_at (UTC). A purchase
--      row in the same month is excluded.
--   3. Boundary: a NULL-transaction_date usage row at 23:59:59.999 UTC on
--      the end day contributes.
--   4. An empty range returns zero rows without an error.
--   5. Tenancy: a non-member under authenticated gets zero rows for a
--      foreign restaurant.
--   6. The anon role has no EXECUTE privilege.

BEGIN;
SELECT plan(6);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000260'::uuid, 'usage-day-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000261'::uuid, 'Usage By Day Test Restaurant'),
  ('00000000-0000-0000-0000-000000000262'::uuid, 'Usage By Day Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000260'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO products (id, restaurant_id, sku, name) VALUES
  ('00000000-0000-0000-0000-000000000263'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid, 'USAGE-DAY-SKU-1', 'Usage By Day Test Product'),
  ('00000000-0000-0000-0000-000000000264'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid, 'USAGE-DAY-SKU-2', 'Usage By Day Foreign Product')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Restaurant 261, April: two usage rows on transaction_date '2026-04-05'.
--   Both rows carry created_at in September: transaction_date must win.
-- Restaurant 261, May: a NULL-transaction_date usage row (created_at drives
--   the bucket) plus a purchase row that must not count.
-- Restaurant 261, June: a NULL-transaction_date usage row at the
--   23:59:59.999 end-of-day boundary.
-- Restaurant 261, July: no rows at all.
-- Restaurant 262, June: a usage row a non-member must not see.
INSERT INTO inventory_transactions
  (id, restaurant_id, product_id, transaction_type, quantity, total_cost, transaction_date, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000265'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -10, -10, '2026-04-05'::date, '2026-09-15 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000266'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', 2, 2, '2026-04-05'::date, '2026-09-15 11:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000267'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -7, -7, NULL, '2026-05-10 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000268'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -50, -50, NULL, '2026-06-30 23:59:59.999+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000269'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid,
   '00000000-0000-0000-0000-000000000264'::uuid,
   'usage', -75, -75, '2026-06-15'::date, '2026-06-15 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000270'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'purchase', 100, 500, '2026-05-20'::date, '2026-05-20 10:00:00+00'::timestamptz)
ON CONFLICT (id) DO UPDATE SET
  transaction_type = EXCLUDED.transaction_type,
  total_cost = EXCLUDED.total_cost,
  transaction_date = EXCLUDED.transaction_date,
  created_at = EXCLUDED.created_at;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000260","role":"authenticated"}';

-- Test 1: per-row ABS and transaction_date precedence.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  $$ VALUES ('2026-04-05'::date, 12::numeric) $$,
  'A -10 row and a +2 row give food_cost 12 (per-row ABS); transaction_date drives the bucket'
);

-- Test 2: NULL transaction_date falls back to created_at; purchase excluded.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-05-01'::date, '2026-05-31'::date) $$,
  $$ VALUES ('2026-05-10'::date, 7::numeric) $$,
  'A NULL transaction_date row buckets by created_at; the purchase row is excluded'
);

-- Test 3: boundary. 23:59:59.999 UTC on the end day contributes.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  $$ VALUES ('2026-06-30'::date, 50::numeric) $$,
  'A NULL transaction_date row at 23:59:59.999 UTC on the end day is included'
);

-- Test 4: an empty range returns zero rows without an error.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-07-01'::date, '2026-07-31'::date) $$,
  'An empty range returns zero rows without an error'
);

-- Test 5: tenancy. A non-member gets zero rows for a foreign restaurant.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000262'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  'A non-member gets zero rows for a foreign restaurant'
);

RESET ROLE;
RESET request.jwt.claims;

-- Test 6: the anon role has no EXECUTE privilege.
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_inventory_usage_by_day(uuid,date,date)', 'EXECUTE'),
  'The anon role has no EXECUTE privilege on get_inventory_usage_by_day'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the test to confirm it fails**

Warning: `npm run test:db` needs the local Supabase stack. Check first:

Run: `npx supabase status`
If the command reports the stack is not running, run: `npm run db:start`

Then run: `npm run test:db`
Expected: FAIL. Test file 69 aborts with an error that contains `function get_inventory_usage_by_day(uuid, date, date) does not exist`.

- [ ] **Step 4: Write the RPC migration**

Create `supabase/migrations/20260830120000_get_inventory_usage_by_day.sql`:

```sql
-- get_inventory_usage_by_day: per-day usage-cost rollup for the dashboard.
-- It replaces the client-side page loops in useFoodCosts and
-- useMonthlyMetrics. Semantics match the client code exactly:
--   * The day bucket uses transaction_date first, then created_at (UTC).
--   * The filter has the same two branches: transaction_date bounds when
--     present, created_at (UTC) bounds when transaction_date is NULL.
--   * The sum applies ABS per row, the same as the client Math.abs.
--     This differs from get_inventory_usage_by_month (ABS of the SUM).

CREATE OR REPLACE FUNCTION public.get_inventory_usage_by_day(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(day DATE, food_cost NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(it.transaction_date::date, (it.created_at AT TIME ZONE 'UTC')::date) AS day,
    SUM(ABS(COALESCE(it.total_cost, 0)))::NUMERIC AS food_cost
  FROM inventory_transactions it
  WHERE it.restaurant_id = p_restaurant_id
    AND it.transaction_type = 'usage'
    AND (
      it.transaction_date >= p_start_date
      OR (it.transaction_date IS NULL
        AND it.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC'))
    )
    AND (
      it.transaction_date <= p_end_date
      OR (it.transaction_date IS NULL
        AND it.created_at <= ((p_end_date::timestamp AT TIME ZONE 'UTC') + interval '23:59:59.999'))
    )
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_by_day(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_usage_by_day IS
  'Per-day usage cost for the dashboard. SECURITY INVOKER: RLS on inventory_transactions applies. The day bucket uses transaction_date first, then created_at (UTC). The sum applies ABS per row.';
```

- [ ] **Step 5: Write the index migration**

Create `supabase/migrations/20260830120500_idx_inventory_transactions_usage_date.sql`:

```sql
-- Partial index for get_inventory_usage_by_day.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this
-- migration contains only this statement (precedent: 20260708193107).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_transactions_usage_date
  ON public.inventory_transactions (restaurant_id, transaction_date)
  WHERE transaction_type = 'usage';
```

- [ ] **Step 6: Apply the migrations and run the tests**

Run: `npm run db:reset`
Expected: the reset applies all migrations. The output lists `20260830120000` and `20260830120500` without an error.

Run: `npm run test:db`
Expected: PASS. The summary reports all test files successful, including `69_inventory_usage_by_day.sql` with 6 subtests.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260830120000_get_inventory_usage_by_day.sql supabase/migrations/20260830120500_idx_inventory_transactions_usage_date.sql supabase/tests/69_inventory_usage_by_day.sql
git commit --no-verify -m "feat(db): add get_inventory_usage_by_day RPC and partial index

The RPC aggregates usage cost per day in the database. It replaces two
client-side page chains on the dashboard. pgTAP test 69 covers per-row
ABS, transaction_date precedence, the NULL fallback, the end-of-day
boundary, tenancy, and the anon privilege.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: RPC types and the `useInventoryUsageByDay` hook

**Files:**
- Modify: `src/integrations/supabase/types.ts:11319-11321`
- Create: `src/hooks/useInventoryUsageByDay.tsx`
- Test: `tests/unit/inventoryUsageByDay.test.ts`

**Interfaces:**
- Consumes: `get_inventory_usage_by_day` RPC from Task 1.
- Produces: `useInventoryUsageByDay(restaurantId: string | null, dateFrom: Date, dateTo: Date)` — a React Query result whose `data` is `{ dailyCosts: { date: string; total_cost: number }[]; totalCost: number }`. Also the exported pure function `mapUsageRows(rows: { day: string; food_cost: number }[])` with the same return shape. Tasks 3 and 5 rely on these exact names.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/inventoryUsageByDay.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// The hook module imports the supabase client at the top level. Mock it so
// this pure-function test does not construct a real client.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { mapUsageRows } from '@/hooks/useInventoryUsageByDay';

describe('mapUsageRows', () => {
  it('maps RPC rows to dailyCosts and sums totalCost', () => {
    const result = mapUsageRows([
      { day: '2026-08-01', food_cost: 10.5 },
      { day: '2026-08-02', food_cost: 4.5 },
    ]);
    expect(result.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 10.5 },
      { date: '2026-08-02', total_cost: 4.5 },
    ]);
    expect(result.totalCost).toBe(15);
  });

  it('returns empty data for zero rows', () => {
    const result = mapUsageRows([]);
    expect(result.dailyCosts).toEqual([]);
    expect(result.totalCost).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/unit/inventoryUsageByDay.test.ts`
Expected: FAIL. The error says the module `@/hooks/useInventoryUsageByDay` cannot be resolved.

- [ ] **Step 3: Add the RPC entry to the generated types**

In `src/integrations/supabase/types.ts`, the `Functions` block is NOT strictly alphabetical. Find this exact anchor (the end of `get_cash_flow_metrics` at lines 11319-11321):

```ts
        Returns: Json
      }
      get_labor_sales_analytics: {
```

Replace it with:

```ts
        Returns: Json
      }
      get_inventory_usage_by_day: {
        Args: {
          p_end_date: string
          p_restaurant_id: string
          p_start_date: string
        }
        Returns: {
          day: string
          food_cost: number
        }[]
      }
      get_labor_sales_analytics: {
```

- [ ] **Step 4: Write the hook**

Create `src/hooks/useInventoryUsageByDay.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface UsageDayRow {
  day: string;
  food_cost: number;
}

export interface UsageByDayData {
  dailyCosts: { date: string; total_cost: number }[];
  totalCost: number;
}

// Map the RPC rows to the shape the dashboard consumes. The RPC returns the
// rows ordered by day. Pure and exported for the unit test.
export function mapUsageRows(rows: UsageDayRow[]): UsageByDayData {
  const dailyCosts = rows.map((row) => ({
    date: row.day,
    total_cost: Number(row.food_cost),
  }));
  const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_cost, 0);
  return { dailyCosts, totalCost };
}

/**
 * Per-day inventory usage cost from the get_inventory_usage_by_day RPC.
 * The database aggregates, so one request replaces the old page loop.
 */
export function useInventoryUsageByDay(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) {
  const fromStr = format(dateFrom, 'yyyy-MM-dd');
  const toStr = format(dateTo, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['inventory-usage-by-day', restaurantId, fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_usage_by_day', {
        p_restaurant_id: restaurantId!,
        p_start_date: fromStr,
        p_end_date: toStr,
      });
      if (error) throw error;
      return mapUsageRows((data ?? []) as UsageDayRow[]);
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // Keep the previous period's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
  });
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/inventoryUsageByDay.test.ts`
Expected: PASS, 2 tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useInventoryUsageByDay.tsx tests/unit/inventoryUsageByDay.test.ts
git commit --no-verify -m "feat(dashboard): add useInventoryUsageByDay hook and RPC types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `useFoodCosts` becomes a thin wrapper

**Files:**
- Modify: `src/hooks/useFoodCosts.tsx` (full rewrite, 89 lines)
- Delete: `tests/unit/useFoodCosts.pagination.test.ts`
- Test: `tests/unit/useFoodCosts.rpc.test.ts` (new)

**Interfaces:**
- Consumes: `useInventoryUsageByDay` from Task 2.
- Produces: `useFoodCosts(restaurantId, dateFrom, dateTo): FoodCostsResult` — unchanged public interface. `FoodCostData` and `FoodCostsResult` exports stay. `capped` is now always `false`.

- [ ] **Step 1: Delete the pagination test**

The old test asserts `.range()` page calls that the wrapper no longer makes.

```bash
git rm tests/unit/useFoodCosts.pagination.test.ts
```

- [ ] **Step 2: Write the failing replacement test**

Create `tests/unit/useFoodCosts.rpc.test.ts`. Warning: use the `new Date(2026, 7, 1)` local-time constructor so `format(..., 'yyyy-MM-dd')` gives the same string in every host timezone.

```ts
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpcMock = vi.fn(() =>
  Promise.resolve({
    data: [
      { day: '2026-08-01', food_cost: 1000 },
      { day: '2026-08-02', food_cost: 5 },
    ],
    error: null,
  })
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('useFoodCosts (RPC wrapper)', () => {
  beforeEach(() => {
    rpcMock.mockClear();
  });

  it('makes one RPC call, maps the rows, and never reports capped', async () => {
    const { useFoodCosts } = await import('@/hooks/useFoodCosts');

    const { result } = renderHook(
      () => useFoodCosts('rest-1', new Date(2026, 7, 1), new Date(2026, 7, 27)),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_inventory_usage_by_day', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-27',
    });
    expect(result.current.dailyCosts).toEqual([
      { date: '2026-08-01', total_cost: 1000 },
      { date: '2026-08-02', total_cost: 5 },
    ]);
    expect(result.current.totalCost).toBe(1005);
    expect(result.current.capped).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx vitest run tests/unit/useFoodCosts.rpc.test.ts`
Expected: FAIL. The current hook calls `supabase.from(...)`, which the mock does not provide, so the query errors and the assertions fail.

- [ ] **Step 4: Rewrite the hook**

Replace the full content of `src/hooks/useFoodCosts.tsx` with:

```tsx
import { useInventoryUsageByDay } from '@/hooks/useInventoryUsageByDay';

export interface FoodCostData {
  date: string;
  total_cost: number;
}

export interface FoodCostsResult {
  dailyCosts: FoodCostData[];
  totalCost: number;
  capped: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Food costs from inventory_transactions (source of truth), aggregated per
 * day by the get_inventory_usage_by_day RPC. The database aggregates, so
 * the result cannot hit a page cap: `capped` is always false and stays
 * only for interface compatibility.
 *
 * @param restaurantId - Restaurant ID to filter transactions
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Food cost data aggregated by date
 */
export function useFoodCosts(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): FoodCostsResult {
  const { data, isLoading, error, refetch } = useInventoryUsageByDay(
    restaurantId,
    dateFrom,
    dateTo
  );

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    capped: false,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run tests/unit/useFoodCosts.rpc.test.ts tests/unit/inventoryUsageByDay.test.ts`
Expected: PASS, 3 tests across 2 files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useFoodCosts.tsx tests/unit/useFoodCosts.rpc.test.ts
git commit --no-verify -m "refactor(dashboard): useFoodCosts calls the RPC through the new hook

The public interface does not change. The capped flag is always false
because the database aggregates. The pagination test asserted deleted
behavior; an RPC-based test replaces it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `useMonthlyMetrics` — RPC swap, concurrent months, concurrent settings

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx:1-20` (imports), `:240-281` (month loop + settings), `:289-306` (inventory promise), `:429-457` (destructure + cap warning), `:547-555` (month bucket loop), `:683-694` (options + return)

**Interfaces:**
- Consumes: `get_inventory_usage_by_day` RPC from Task 1.
- Produces: the hook return gains `isFetching: boolean`. Task 5 destructures it in `Index.tsx` as `isFetching: monthlyFetching`.

- [ ] **Step 1: Replace the inventory page chain with the RPC call**

Find this exact block (lines 289-306):

```ts
      // Inventory COGS rows, when the method uses inventory data.
      const inventoryCOGSPromise =
        cogsMethod === 'inventory' || cogsMethod === 'combined'
          ? fetchAllRows<InventoryTransactionRow>(
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
            )
          : Promise.resolve({ rows: [] as InventoryTransactionRow[], capped: false });
```

Replace it with:

```ts
      // Inventory COGS per day from the get_inventory_usage_by_day RPC,
      // when the method uses inventory data. The database aggregates, so
      // there is no page loop and no cap.
      const inventoryCOGSPromise =
        cogsMethod === 'inventory' || cogsMethod === 'combined'
          ? supabase
              .rpc('get_inventory_usage_by_day', {
                p_restaurant_id: restaurantId,
                p_start_date: fromStr,
                p_end_date: toStr,
              })
              .then(({ data, error }) => {
                if (error) throw error;
                return (data ?? []) as { day: string; food_cost: number }[];
              })
          : Promise.resolve([] as { day: string; food_cost: number }[]);
```

- [ ] **Step 2: Update the Promise.all destructure**

Find this exact line (line 430, the first element of the nine-way destructure):

```ts
        { rows: foodCostsData, capped: inventoryCapped },
```

Replace it with:

```ts
        inventoryUsageDays,
```

- [ ] **Step 3: Delete the inventory cap warning**

The RPC cannot cap, so the warning is dead. Find this exact block (lines 451-457):

```ts
      // Warnings keep the same order as the serial version so the warning
      // text the UI joins stays stable.
      pushCapWarning(
        inventoryCapped,
        'The inventory COGS rows hit the fetch limit. The food cost figure is incomplete.',
        'inventory COGS fetch hit the page limit; the food cost figure is incomplete.'
      );
```

Replace it with (keep the comment; it still governs the warnings below):

```ts
      // Warnings keep the same order as the serial version so the warning
      // text the UI joins stays stable.
```

- [ ] **Step 4: Bucket the RPC days into months**

Find this exact block (lines 547-555):

```ts
      // Inventory COGS (when method is 'inventory' or 'combined')
      // Inventory COGS: use shared helper to get day→dollars map, then bucket to months (cents).
      if (cogsMethod === 'inventory' || cogsMethod === 'combined') {
        const invDaily = aggregateInventoryCOGSByDate(foodCostsData ?? []);
        for (const [dateKey, dollars] of invDaily) {
          const monthKey = dateKey.slice(0, 7); // yyyy-MM-dd → yyyy-MM
          ensureMonth(monthKey).food_cost += toC(dollars);
        }
      }
```

Replace it with:

```ts
      // Inventory COGS: the RPC returns day→dollars; bucket to months (cents).
      if (cogsMethod === 'inventory' || cogsMethod === 'combined') {
        for (const { day, food_cost } of inventoryUsageDays) {
          const monthKey = day.slice(0, 7); // yyyy-MM-dd → yyyy-MM
          ensureMonth(monthKey).food_cost += toC(Number(food_cost));
        }
      }
```

- [ ] **Step 5: Fetch the months concurrently and overlap the settings fetch**

Find this exact block (lines 240-281, the serial month loop plus the settings fetch):

```ts
      // Source revenue + POS from the same RPCs useRevenueBreakdown uses.
      // Per month so we can clamp the first and last partial months to the query window.
      const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });
      for (const rawMonthStart of monthsInRange) {
        const monthStart = startOfMonth(rawMonthStart);
        const monthEndFull = endOfMonth(monthStart);
        const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
        const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
        if (clampedStart > clampedEnd) continue;

        const monthKey = format(monthStart, 'yyyy-MM');
        const totals = await fetchMonthRevenueTotals(
          supabase,
          restaurantId,
          toDateOnlyString(clampedStart),
          toDateOnlyString(clampedEnd)
        );

        if (totals.salesTotalsFailed) {
          warnings.push(
            `The POS sales total for ${monthKey} failed to load. The collected amount uses the fallback formula.`
          );
        }

        const month = ensureMonth(monthKey);
        month.gross_revenue          = totals.grossRevenueCents;
        month.discounts              = totals.discountsCents;
        month.net_revenue            = totals.netRevenueCents;
        month.sales_tax              = totals.salesTaxCents;
        month.tips                   = totals.tipsCents;
        month.other_liabilities      = totals.otherLiabilitiesCents;
        month.total_collected_at_pos = totals.posCollectedCents;
        month.has_data               = true;
      }

      // Fetch COGS preference setting
      const { data: settingsData } = await supabase
        .from('restaurant_financial_settings')
        .select('cogs_calculation_method')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      const cogsMethod = (settingsData?.cogs_calculation_method as string) || 'inventory';
```

Replace it with:

```ts
      // Start the settings fetch now so it overlaps the month fetches below.
      const settingsPromise = supabase
        .from('restaurant_financial_settings')
        .select('cogs_calculation_method')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      // Source revenue + POS from the same RPCs useRevenueBreakdown uses.
      // Per month so we can clamp the first and last partial months to the
      // query window. The month fetches start together; the apply loop below
      // runs in month order so the warning order stays stable.
      const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });
      const monthTotals = await Promise.all(
        monthsInRange.map(async (rawMonthStart) => {
          const monthStart = startOfMonth(rawMonthStart);
          const monthEndFull = endOfMonth(monthStart);
          const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
          const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
          if (clampedStart > clampedEnd) return null;

          const monthKey = format(monthStart, 'yyyy-MM');
          const totals = await fetchMonthRevenueTotals(
            supabase,
            restaurantId,
            toDateOnlyString(clampedStart),
            toDateOnlyString(clampedEnd)
          );
          return { monthKey, totals };
        })
      );

      for (const entry of monthTotals) {
        if (!entry) continue;
        const { monthKey, totals } = entry;

        if (totals.salesTotalsFailed) {
          warnings.push(
            `The POS sales total for ${monthKey} failed to load. The collected amount uses the fallback formula.`
          );
        }

        const month = ensureMonth(monthKey);
        month.gross_revenue          = totals.grossRevenueCents;
        month.discounts              = totals.discountsCents;
        month.net_revenue            = totals.netRevenueCents;
        month.sales_tax              = totals.salesTaxCents;
        month.tips                   = totals.tipsCents;
        month.other_liabilities      = totals.otherLiabilitiesCents;
        month.total_collected_at_pos = totals.posCollectedCents;
        month.has_data               = true;
      }

      const { data: settingsData } = await settingsPromise;
      const cogsMethod = (settingsData?.cogs_calculation_method as string) || 'inventory';
```

- [ ] **Step 6: Add placeholderData and expose isFetching**

Find this exact block (lines 683-686):

```ts
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
```

Replace it with:

```ts
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    // Keep the previous range's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
  });
```

Then find this exact block (lines 688-694):

```ts
  return {
    data: query.data?.months ?? null,
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
```

Replace it with:

```ts
  return {
    data: query.data?.months ?? null,
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
```

- [ ] **Step 7: Delete the dead imports**

After Steps 1-4, `aggregateInventoryCOGSByDate`, `InventoryTransactionRow`, and `COGS_MAX_PAGES` have no remaining use in this file. Confirm first:

Run: `grep -n "aggregateInventoryCOGSByDate\|InventoryTransactionRow\|COGS_MAX_PAGES" src/hooks/useMonthlyMetrics.tsx`
Expected: only the import lines (lines 6-11 and 16) match.

Find this exact block (lines 6-11):

```ts
import {
  aggregateInventoryCOGSByDate,
  aggregateFinancialCOGSByDate,
  toUtcDayKey,
  type InventoryTransactionRow,
} from '@/services/cogsCalculations';
```

Replace it with:

```ts
import {
  aggregateFinancialCOGSByDate,
  toUtcDayKey,
} from '@/services/cogsCalculations';
```

Find this exact line (line 16):

```ts
import { fetchFinancialCOGSRows, COGS_MAX_PAGES } from '@/services/cogsFetch';
```

Replace it with:

```ts
import { fetchFinancialCOGSRows } from '@/services/cogsFetch';
```

Warning: keep `fetchAllRows` (line 15). The labor, punches, and tips fetches still use it.

- [ ] **Step 8: Run the affected tests**

Run: `npx vitest run tests/unit/useMonthlyMetrics tests/unit/monthlyMetrics.test.ts`
Expected: PASS. All 8 `useMonthlyMetrics.*` files plus `monthlyMetrics.test.ts` pass. Their mocks stub `supabase.rpc` with `{ data: [], error: null }` and resolve generic chains through `.then`/`.maybeSingle`, so the RPC swap and the settings reorder do not change the assertions.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useMonthlyMetrics.tsx
git commit --no-verify -m "perf(dashboard): useMonthlyMetrics uses the RPC and concurrent fetches

One get_inventory_usage_by_day call replaces the inventory page chain.
The 12 month-revenue fetches start together; a sequential apply loop
keeps the warning order. The settings fetch overlaps the month fetches.
The hook exposes isFetching and keeps previous data via placeholderData.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Smooth period switch — transitions, placeholder data, skeleton gate

**Files:**
- Modify: `src/hooks/useRevenueBreakdown.tsx:795-799`
- Modify: `src/hooks/useCOGSFromFinancials.tsx:58-61`
- Modify: `src/hooks/useLaborCostsFromTransactions.tsx:134-137`
- Modify: `src/hooks/useLaborCostsFromTimeTracking.tsx:282-284`
- Modify: `src/hooks/useInventoryPurchases.tsx:55-58`
- Modify: `src/hooks/usePeriodMetrics.tsx:59-76,148-154`
- Modify: `src/pages/Index.tsx:1,173,180-184,699,765-768,773-774,925-926,945-946`

**Interfaces:**
- Consumes: `isFetching: monthlyFetching` from Task 4's `useMonthlyMetrics` return.
- Produces: `usePeriodMetrics` return gains `isFetching: boolean` (true while `useRevenueBreakdown` refetches).

- [ ] **Step 1: Add guarded placeholderData to the five leaf hooks**

Every one of these hooks keys its query as `[<name>, restaurantId, ...]`, so `queryKey[1]` is the restaurant id. Append the same `placeholderData` block to each options object, directly before the closing `});` of the `useQuery` call.

In `src/hooks/useRevenueBreakdown.tsx` (lines 795-799), find:

```ts
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes - reduce refetch frequency
    refetchOnWindowFocus: false, // Disable automatic refetch on window focus
    refetchOnMount: false, // Disable automatic refetch on mount
  });
```

Replace with:

```ts
    enabled: !!restaurantId,
    staleTime: 300000, // 5 minutes - reduce refetch frequency
    refetchOnWindowFocus: false, // Disable automatic refetch on window focus
    refetchOnMount: false, // Disable automatic refetch on mount
    // Keep the previous period's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
  });
```

In `src/hooks/useCOGSFromFinancials.tsx` (lines 58-61) and `src/hooks/useLaborCostsFromTransactions.tsx` (lines 134-137), find (identical in both files):

```ts
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
```

Replace with (in both files):

```ts
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // Keep the previous period's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
```

In `src/hooks/useInventoryPurchases.tsx` (lines 55-58), the same four option lines appear; apply the same replacement.

In `src/hooks/useLaborCostsFromTimeTracking.tsx` (lines 282-284), find:

```ts
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
```

Replace with:

```ts
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    // Keep the previous period's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
```

Warning: if an exact block above does not match (a peer commit moved lines), re-read that file and append the same `placeholderData` block to the options of its main `useQuery` call. Do not change any other option.

- [ ] **Step 2: Thread isFetching through usePeriodMetrics**

In `src/hooks/usePeriodMetrics.tsx`, find the return type block (lines 59-65):

```ts
): {
  data: PeriodMetrics | null;
  isLoading: boolean;
  error: Error | null;
  capped: boolean;
  refetch: () => void;
} {
```

Replace with:

```ts
): {
  data: PeriodMetrics | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  capped: boolean;
  refetch: () => void;
} {
```

Find the useRevenueBreakdown destructure (lines 67-72):

```ts
  const {
    data: revenueData,
    isLoading: revenueLoading,
    refetch: refetchRevenue,
    error: revenueError,
  } = useRevenueBreakdown(
```

Replace with:

```ts
  const {
    data: revenueData,
    isLoading: revenueLoading,
    isFetching: revenueFetching,
    refetch: refetchRevenue,
    error: revenueError,
  } = useRevenueBreakdown(
```

Find the return block (lines 148-154):

```ts
  return {
    data: metrics,
    isLoading: revenueLoading || costsLoading,
    error: revenueError ?? costsError ?? null,
    capped,
    refetch,
  };
```

Replace with:

```ts
  return {
    data: metrics,
    isLoading: revenueLoading || costsLoading,
    isFetching: revenueFetching,
    error: revenueError ?? costsError ?? null,
    capped,
    refetch,
  };
```

- [ ] **Step 3: Wire the page state in Index.tsx**

In `src/pages/Index.tsx`, find line 1:

```ts
import { useEffect, useState, useMemo, type ReactNode } from 'react';
```

Replace with:

```ts
import { useEffect, useState, useMemo, startTransition, type ReactNode } from 'react';
```

Find line 173:

```ts
  const { data: periodMetrics, isLoading: periodLoading, capped: periodCapped } = usePeriodMetrics(
```

Replace with:

```ts
  const { data: periodMetrics, isLoading: periodLoading, isFetching: periodFetching, capped: periodCapped } = usePeriodMetrics(
```

Find the useMonthlyMetrics destructure (lines 180-185):

```ts
  const {
    data: monthlyMetrics,
    isLoading: monthlyLoading,
    error: monthlyError,
    warnings: monthlyWarnings
  } = useMonthlyMetrics(
```

Replace with:

```ts
  const {
    data: monthlyMetrics,
    isLoading: monthlyLoading,
    isFetching: monthlyFetching,
    error: monthlyError,
    warnings: monthlyWarnings
  } = useMonthlyMetrics(
```

- [ ] **Step 4: Gate the skeleton on data presence**

With `placeholderData`, a period switch keeps the old data while `isLoading` stays false. The skeleton must show only when a section has no data at all. Find line 699:

```tsx
          {todaysLoading || periodLoading || alertsLoading ? (
```

Replace with:

```tsx
          {alertsLoading || (todaysLoading && !todaysData) || (periodLoading && !periodData) ? (
```

- [ ] **Step 5: Wrap the period change in startTransition and announce updates**

Find lines 765-768:

```tsx
              <PeriodSelector
                selectedPeriod={selectedPeriod}
                onPeriodChange={setSelectedPeriod}
              />
```

Replace with:

```tsx
              <PeriodSelector
                selectedPeriod={selectedPeriod}
                onPeriodChange={(period) => startTransition(() => setSelectedPeriod(period))}
              />
              <output aria-live="polite" className="sr-only">
                {periodFetching ? '' : `Dashboard updated for ${selectedPeriod.label}`}
              </output>
```

- [ ] **Step 6: Dim stale sections while a refetch runs**

Three sections show period- or month-scoped data. Give each inner wrapper a fetch-state opacity. The file does not import `cn`, so use template literals.

Find lines 773-774:

```tsx
              <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
                <div className="space-y-4">
```

Replace with:

```tsx
              <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
                <div className={`space-y-4 transition-opacity ${periodFetching ? 'opacity-60' : ''}`}>
```

Find lines 925-926:

```tsx
              <Collapsible open={cashflowOpen} onOpenChange={setCashflowOpen}>
                <div className="space-y-4">
```

Replace with:

```tsx
              <Collapsible open={cashflowOpen} onOpenChange={setCashflowOpen}>
                <div className={`space-y-4 transition-opacity ${periodFetching ? 'opacity-60' : ''}`}>
```

Find lines 945-946:

```tsx
              <Collapsible open={monthlyOpen} onOpenChange={setMonthlyOpen}>
                <div className="space-y-4">
```

Replace with:

```tsx
              <Collapsible open={monthlyOpen} onOpenChange={setMonthlyOpen}>
                <div className={`space-y-4 transition-opacity ${monthlyFetching ? 'opacity-60' : ''}`}>
```

- [ ] **Step 7: Run the affected tests**

Run: `npx vitest run tests/unit/periodMetrics.test.ts tests/unit/usePeriodMetrics.capped.test.ts`
Expected: PASS. The capped test mocks the leaf hooks; a missing `isFetching` in a mock destructures to `undefined` without an error.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useRevenueBreakdown.tsx src/hooks/useCOGSFromFinancials.tsx src/hooks/useLaborCostsFromTransactions.tsx src/hooks/useLaborCostsFromTimeTracking.tsx src/hooks/useInventoryPurchases.tsx src/hooks/usePeriodMetrics.tsx src/pages/Index.tsx
git commit --no-verify -m "perf(dashboard): smooth period switch

startTransition keeps the pills responsive. Guarded placeholderData
keeps the previous period on screen during a refetch and clears it on a
restaurant switch. The skeleton gate now checks data presence. Stale
sections dim at opacity-60 while a refetch runs, with an aria-live
announcement when the update lands.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Memoize five presentational dashboard components

**Files:**
- Modify: `src/components/dashboard/LaborPnlCard.tsx:1,44` + end of file
- Modify: `src/components/dashboard/LaborEfficiencyCard.tsx:1,47` + end of file
- Modify: `src/components/dashboard/OperationsHealthCard.tsx:1,21` + end of file
- Modify: `src/components/BankSnapshotSection.tsx:1,13` + end of file
- Modify: `src/components/DashboardQuickActions.tsx:1,4` + end of file

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the same five named exports. Pattern for every file: rename the function to `<Name>Base`, then append `export const <Name> = memo(<Name>Base);` as the last line. Named imports elsewhere do not change. All five components take primitive props or none, so `memo` needs no custom comparator.

- [ ] **Step 1: LaborPnlCard**

In `src/components/dashboard/LaborPnlCard.tsx`, find line 1:

```ts
import { useMemo } from 'react';
```

Replace with:

```ts
import { memo, useMemo } from 'react';
```

Find line 44:

```ts
export function LaborPnlCard({ restaurantId }: LaborPnlCardProps) {
```

Replace with:

```ts
function LaborPnlCardBase({ restaurantId }: LaborPnlCardProps) {
```

Append at the end of the file (after the closing `}` of the function):

```ts

export const LaborPnlCard = memo(LaborPnlCardBase);
```

Warning: line 31 also exports `buildLaborSparklineData`. Do not change it.

- [ ] **Step 2: LaborEfficiencyCard**

In `src/components/dashboard/LaborEfficiencyCard.tsx`, find line 1:

```ts
import { useMemo } from 'react';
```

Replace with:

```ts
import { memo, useMemo } from 'react';
```

Find line 47:

```ts
export function LaborEfficiencyCard({ restaurantId }: LaborEfficiencyCardProps) {
```

Replace with:

```ts
function LaborEfficiencyCardBase({ restaurantId }: LaborEfficiencyCardProps) {
```

Append at the end of the file:

```ts

export const LaborEfficiencyCard = memo(LaborEfficiencyCardBase);
```

Warning: line 34 also exports `buildSparklineData`. Do not change it.

- [ ] **Step 3: OperationsHealthCard**

`src/components/dashboard/OperationsHealthCard.tsx` has no react import and uses double quotes. Add this as the new first line of the file:

```ts
import { memo } from "react";
```

Find lines 21-27:

```ts
export function OperationsHealthCard({
  primeCost,
  primeCostTarget,
  lowInventoryCount,
  unmappedPOSCount,
  uncategorizedTransactions,
}: OperationsHealthCardProps) {
```

Replace with:

```ts
function OperationsHealthCardBase({
  primeCost,
  primeCostTarget,
  lowInventoryCount,
  unmappedPOSCount,
  uncategorizedTransactions,
}: OperationsHealthCardProps) {
```

Append at the end of the file:

```ts

export const OperationsHealthCard = memo(OperationsHealthCardBase);
```

- [ ] **Step 4: BankSnapshotSection**

In `src/components/BankSnapshotSection.tsx`, find line 1:

```ts
import { useMemo } from 'react';
```

Replace with:

```ts
import { memo, useMemo } from 'react';
```

Find line 13:

```ts
export function BankSnapshotSection({ restaurantId }: BankSnapshotSectionProps) {
```

Replace with:

```ts
function BankSnapshotSectionBase({ restaurantId }: BankSnapshotSectionProps) {
```

Append at the end of the file:

```ts

export const BankSnapshotSection = memo(BankSnapshotSectionBase);
```

- [ ] **Step 5: DashboardQuickActions**

`src/components/DashboardQuickActions.tsx` has no react import. Add this as the new first line of the file (match the file's quote style; if its imports use double quotes, write `"react"`):

```ts
import { memo } from 'react';
```

Find line 4:

```ts
export function DashboardQuickActions() {
```

Replace with:

```ts
function DashboardQuickActionsBase() {
```

Append at the end of the file:

```ts

export const DashboardQuickActions = memo(DashboardQuickActionsBase);
```

- [ ] **Step 6: Check and commit**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors in the five files.

```bash
git add src/components/dashboard/LaborPnlCard.tsx src/components/dashboard/LaborEfficiencyCard.tsx src/components/dashboard/OperationsHealthCard.tsx src/components/BankSnapshotSection.tsx src/components/DashboardQuickActions.tsx
git commit --no-verify -m "perf(dashboard): memoize five presentational components

Each takes primitive props or none, so React.memo skips their re-render
when a transition re-renders the page.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Lazy-load ChatMessage; delete the dead AiChat component

**Files:**
- Modify: `src/components/ai-chat/AiChatPanel.tsx`
- Delete: `src/components/AiChat.tsx`

**Interfaces:**
- Consumes: `ChatMessage` named export at `src/components/ChatMessage.tsx:99`.
- Produces: no interface change. `ChatMessage` and its markdown/mermaid dependencies move out of the main bundle chunk.

- [ ] **Step 1: Confirm AiChat.tsx is dead**

Run: `grep -rn "components/AiChat'" src/`
Expected: no output. If a match appears, stop and report; do not delete the file.

- [ ] **Step 2: Make ChatMessage lazy**

In `src/components/ai-chat/AiChatPanel.tsx`, find line 1:

```ts
import { useState, useRef, useEffect, useCallback } from 'react';
```

Replace with:

```ts
import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
```

Delete line 19:

```ts
import { ChatMessage } from '@/components/ChatMessage';
```

After the import block and before this line:

```ts
const MIN_WIDTH = 320;
```

insert:

```ts
// ChatMessage pulls in the markdown + mermaid stack. Load it only when the
// panel shows messages; the effect below prefetches when the panel opens.
const ChatMessage = lazy(() =>
  import('@/components/ChatMessage').then((m) => ({ default: m.ChatMessage }))
);

```

- [ ] **Step 3: Prefetch when the panel opens**

Inside the component, directly after this line:

```ts
  const hasAiAccess = hasFeature('ai_assistant');
```

insert:

```ts

  // Prefetch the lazy chunk as soon as the panel opens, before the first
  // message renders.
  useEffect(() => {
    if (isOpen) {
      import('@/components/ChatMessage');
    }
  }, [isOpen]);
```

- [ ] **Step 4: Wrap the message list in Suspense**

Find this exact block (inside the `<div className="space-y-4 py-4">` list):

```tsx
                    {messages.map((message) => (
                      <ChatMessage key={message.id} message={message} />
                    ))}
```

Replace with:

```tsx
                    <Suspense
                      fallback={
                        <Card className="max-w-[85%] px-3 py-2 bg-muted/50 border-0 shadow-none">
                          <p className="text-[13px] text-muted-foreground">Loading messages…</p>
                        </Card>
                      }
                    >
                      {messages.map((message) => (
                        <ChatMessage key={message.id} message={message} />
                      ))}
                    </Suspense>
```

`Card` is already imported in this file (the isStreaming bubble uses it).

- [ ] **Step 5: Delete the dead component**

```bash
git rm src/components/AiChat.tsx
```

- [ ] **Step 6: Build and check the chunks**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: the build succeeds. The chunk listing shows a new `ChatMessage-*.js` (or mermaid-carrying) chunk separate from the main `index-*.js`.

Run: `ls dist/assets | grep -i -E "chatmessage|mermaid"`
Expected: at least one matching chunk file.

- [ ] **Step 7: Commit**

```bash
git add src/components/ai-chat/AiChatPanel.tsx
git commit --no-verify -m "perf(chat): lazy-load ChatMessage and delete the dead AiChat component

The markdown + mermaid stack leaves the main chunk. The panel prefetches
the chunk on open, so the first message renders without a visible wait.
src/components/AiChat.tsx had zero importers.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification and the production parity probe

**Files:**
- None created or modified. This task only checks.

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: a green local check suite and a parity confirmation from production.

- [ ] **Step 1: Run the full local checks**

Run each command; every one must pass before the PR step of the workflow:

```bash
npm run typecheck
```
Expected: no errors.

```bash
npm run lint
```
Expected: no new errors against the branch.

```bash
npm run test
```
Expected: PASS. All unit tests, including the new `inventoryUsageByDay.test.ts` and `useFoodCosts.rpc.test.ts`.

```bash
npm run test:db
```
Expected: PASS. All pgTAP files, including `69_inventory_usage_by_day.sql`.

```bash
npm run build
```
Expected: the build succeeds.

- [ ] **Step 2: Re-run the parity probe on production**

Run this read-only SELECT via `mcp__supabase-prod__execute_sql` (not via chat hand-off). It compares the RPC's `WHERE` expression against the client `.or()` expression for Wetzel's, August 2026:

```sql
SELECT
  count(*) FILTER (WHERE
    (transaction_date IS NOT NULL
      AND transaction_date >= DATE '2026-08-01'
      AND transaction_date <= DATE '2026-08-31')
    OR
    (transaction_date IS NULL
      AND created_at >= (DATE '2026-08-01'::timestamp AT TIME ZONE 'UTC')
      AND created_at <= ((DATE '2026-08-31'::timestamp AT TIME ZONE 'UTC')
        + interval '23:59:59.999'))
  ) AS rpc_rows,
  sum(ABS(COALESCE(total_cost, 0))) FILTER (WHERE
    (transaction_date IS NOT NULL
      AND transaction_date >= DATE '2026-08-01'
      AND transaction_date <= DATE '2026-08-31')
    OR
    (transaction_date IS NULL
      AND created_at >= (DATE '2026-08-01'::timestamp AT TIME ZONE 'UTC')
      AND created_at <= ((DATE '2026-08-31'::timestamp AT TIME ZONE 'UTC')
        + interval '23:59:59.999'))
  ) AS rpc_sum,
  count(*) FILTER (WHERE
    (transaction_date >= DATE '2026-08-01'
      OR (transaction_date IS NULL
        AND created_at >= TIMESTAMPTZ '2026-08-01T00:00:00Z'))
    AND
    (transaction_date <= DATE '2026-08-31'
      OR (transaction_date IS NULL
        AND created_at <= TIMESTAMPTZ '2026-08-31T23:59:59.999Z'))
  ) AS client_rows,
  sum(ABS(COALESCE(total_cost, 0))) FILTER (WHERE
    (transaction_date >= DATE '2026-08-01'
      OR (transaction_date IS NULL
        AND created_at >= TIMESTAMPTZ '2026-08-01T00:00:00Z'))
    AND
    (transaction_date <= DATE '2026-08-31'
      OR (transaction_date IS NULL
        AND created_at <= TIMESTAMPTZ '2026-08-31T23:59:59.999Z'))
  ) AS client_sum
FROM inventory_transactions
WHERE restaurant_id = '7c0c76e3-e770-401b-a2a9-c1edd407efed'
  AND transaction_type = 'usage';
```

Expected: `rpc_rows` = `client_rows` and `rpc_sum` = `client_sum`. On 2026-08-30 both pairs were 16,682 and 2358.4342411081413782117284675. New usage rows after that date can raise the numbers; the pairs must still match exactly. If they differ, stop and report the four values.

- [ ] **Step 3: Report**

State the check results. The development workflow then continues with the UI review, code-simplify, review, and PR phases.

---

## Out of scope for this plan

- The bodies of `src/hooks/useUnifiedCOGS.tsx`, `src/services/cogsFetch.ts`, `src/services/cogsCalculations.ts` (peer sessions own them).
- The accuracy fixes from the assessment (held for the peer sessions; a second PR if the peers do not take them).
- Removal of the now-unused `get_inventory_usage_by_month` RPC (follow-up).
- Links for the duplicate pending outflows at Wetzel's (needs user approval).
