# Labor Sales Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `/labor` page sales aggregation into one SQL RPC, so the page fetches one aggregate object instead of ~23,700 raw rows per load.

**Architecture:** A new `plpgsql` RPC `get_labor_sales_analytics` returns the daily totals, the (dow, hour) grid, the by-weekday totals, and an `has_hourly` flag as one JSONB object. Two pure mappers turn that JSONB into the existing `SplhPoint[]` and `SplhGridCell[]` shapes, so the downstream transforms and UI do not change. The punch → session → labor-cost math stays client-side and unchanged. The Day view keeps a small lazy single-day client fetch that reuses `buildIntradayFinancialSeries`.

**Tech Stack:** React 18 + TypeScript + Vite, React Query, Supabase (Postgres + RLS), Vitest (unit), pgTAP (SQL).

## Global Constraints

- Multi-tenant: every query filters by `restaurant_id`; RLS and the RPC access check enforce isolation.
- Authoritative revenue predicate (design §3): `parent_sale_id IS NULL AND adjustment_type IS NULL AND item_type = 'sale'`. The RPC MUST use all three.
- The SQL function is authoritative; TypeScript mirrors it for shape only.
- No manual caching. Server state uses React Query with `staleTime: 60000` and `refetchOnWindowFocus: true`.
- No direct colors; use semantic tokens. (No UI color code changes in this plan.)
- Write all prose in ASD-STE100 Simplified Technical English (STE-aligned; do not claim certification).
- Git: never commit to `main`; stage explicit paths only (never `git add -A`/`.`/`-a`); `progress.md` is gitignored and must never be committed.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run all commands from the worktree root `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/perf+labor-sales-aggregation`. Do not `cd` to the original repo root.
- Money is cent-precise; `round2(n) = Math.round(n * 100) / 100` matches `buildSplhTimeseries` and `buildSplhGrid`. Mappers MUST match this to the cent.

## File Structure

New files:
- `src/lib/localDateWindow.ts` — shared restaurant-local window helper (Task 1).
- `supabase/migrations/20260809120000_get_labor_sales_analytics.sql` — the RPC (Task 2).
- `supabase/tests/63_get_labor_sales_analytics.sql` — pgTAP for the RPC (Task 2).
- `src/hooks/useLaborSalesAnalytics.ts` — React Query hook over the RPC (Task 4).
- `src/hooks/useLaborIntradaySeries.ts` — lazy single-day intraday hook (Task 5).
- `tests/unit/localDateWindow.test.ts`, `tests/unit/laborPnlAnalytics.mappers.test.ts`, `tests/unit/useLaborSalesAnalytics.test.ts`, `tests/unit/useLaborIntradaySeries.test.ts` — new unit tests.

Modified files:
- `src/hooks/useSplhData.ts` — import the shared window helper (Task 1).
- `src/lib/splhAnalytics.ts` — export `FALLBACK_OPEN_HOUR`/`FALLBACK_CLOSE_HOUR` (Task 3).
- `src/lib/laborPnlAnalytics.ts` — add the two mappers (Task 3).
- `src/integrations/supabase/types.ts` — hand-add the RPC to `Functions` (Task 2).
- `src/hooks/useLaborPnlCore.ts` + `src/hooks/useLaborPnlAnalytics.ts` + both test files — atomic rewire (Task 6).

---

### Task 1: Shared restaurant-local window helper

**Files:**
- Create: `src/lib/localDateWindow.ts`
- Create: `tests/unit/localDateWindow.test.ts`
- Modify: `src/hooks/useSplhData.ts` (remove the local `localWindow`, import the shared one)

**Interfaces:**
- Consumes: nothing.
- Produces: `localWindow(tz: string, weeks: number): { startStr: string; endStr: string }` — `endStr` is today's date in `tz` (YYYY-MM-DD); `startStr` is `weeks * 7` days earlier.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/localDateWindow.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { localWindow } from '@/lib/localDateWindow';

describe('localWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today-in-tz as endStr and weeks*7 days earlier as startStr (UTC)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
    expect(localWindow('UTC', 18)).toEqual({ startStr: '2026-03-10', endStr: '2026-07-14' });
  });

  it('CRITICAL: uses the restaurant-local calendar day, not the host/UTC day', () => {
    // 2026-07-14T05:00:00Z is already July 14 in UTC, but still July 13 in
    // Honolulu (UTC-10, no DST). A host-date implementation returns the wrong
    // endStr for any non-UTC restaurant.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    expect(localWindow('Pacific/Honolulu', 4)).toEqual({ startStr: '2026-06-15', endStr: '2026-07-13' });
  });

  it('spans exactly weeks*7 days back for an 18-week window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const { startStr, endStr } = localWindow('UTC', 18);
    expect(endStr).toBe('2026-01-01');
    expect(startStr).toBe('2025-08-27'); // 126 days before 2026-01-01
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/localDateWindow.test.ts`
Expected: FAIL — cannot resolve `@/lib/localDateWindow`.

- [ ] **Step 3: Create the shared helper**

Create `src/lib/localDateWindow.ts`:

```ts
/**
 * Window boundaries derived from the restaurant-local "today", not host/UTC
 * `new Date()`. `endStr` is today's date in `tz`; `startStr` is `weeks` weeks
 * earlier. Dates are plain YYYY-MM-DD (no time component), matching
 * `unified_sales.sale_date`'s column type.
 *
 * Shared by `useSplhData` (scheduling SPLH) and `useLaborSalesAnalytics`
 * (Labor P&L). Both must resolve the exact same window, so this helper is the
 * single source of truth. Do not inline a second copy.
 */
export function localWindow(tz: string, weeks: number): { startStr: string; endStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endStr = fmt.format(now); // YYYY-MM-DD in tz (en-CA locale formats this way)
  const [y, m, d] = endStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  return { startStr: start.toISOString().slice(0, 10), endStr };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/localDateWindow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire `useSplhData` to import the shared helper**

In `src/hooks/useSplhData.ts`, add the import after line 7 (`import type { TimePunch } ...`):

```ts
import { localWindow } from '@/lib/localDateWindow';
```

Then delete the local `localWindow` function and its doc comment — the whole block from line 86 (`/**`) through line 105 (the closing `}`), which is:

```ts
/**
 * Window boundaries derived from the restaurant-local "today", not host/UTC
 * `new Date()` (§5 S-min1). `endStr` is today's date in `tz`; `startStr` is
 * `weeks` weeks earlier. Dates are formatted as plain YYYY-MM-DD (no time
 * component), matching `unified_sales.sale_date`'s column type.
 */
function localWindow(tz: string, weeks: number): { startStr: string; endStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endStr = fmt.format(now); // YYYY-MM-DD in tz (en-CA locale formats this way)
  const [y, m, d] = endStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  return { startStr: start.toISOString().slice(0, 10), endStr };
}
```

Leave the `useSplhData` body call `const { startStr, endStr } = localWindow(tz, weeks);` unchanged — it now calls the imported helper.

- [ ] **Step 6: Verify typecheck, lint, and existing SPLH tests pass**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors.

Run: `npm run test -- tests/unit/localDateWindow.test.ts src/hooks/useSplhData`
Expected: PASS. (If no `useSplhData` test file exists, only the helper test runs — still PASS.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/localDateWindow.ts tests/unit/localDateWindow.test.ts src/hooks/useSplhData.ts
git commit -m "$(cat <<'EOF'
refactor(labor): extract shared localWindow helper

Move the restaurant-local window math out of useSplhData into
src/lib/localDateWindow.ts so useLaborSalesAnalytics can reuse the exact
same window. No behavior change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The `get_labor_sales_analytics` RPC + pgTAP + types

**Files:**
- Create: `supabase/migrations/20260809120000_get_labor_sales_analytics.sql`
- Create: `supabase/tests/63_get_labor_sales_analytics.sql`
- Modify: `src/integrations/supabase/types.ts` (add the RPC to `Functions`)

**Interfaces:**
- Consumes: `unified_sales` (columns `restaurant_id, sale_date, sale_time, sold_at, total_price, parent_sale_id, adjustment_type, item_type`), `user_restaurants (restaurant_id, user_id)`, `restaurants`.
- Produces: `get_labor_sales_analytics(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_time_zone TEXT DEFAULT 'America/Chicago') RETURNS JSONB`. Return shape:
  `{ daily: [{sale_date, revenue}], grid: [{dow, hour, revenue}], by_weekday: [{dow, revenue}], has_hourly: boolean }`.
  `dow` is 0=Sun..6=Sat. `hour` is 0..23 in `p_time_zone`. Revenue is rounded to 2 decimals.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/63_get_labor_sales_analytics.sql`:

```sql
BEGIN;
SELECT plan(16);

-- Fixed identities for this test.
-- member:     00000000-0000-0000-0000-000000000000
-- restaurant: 00000000-0000-0000-0000-000000000099
-- non-member: 99999999-9999-9999-9999-999999999999

-- Seed a restaurant and a member.
INSERT INTO restaurants (id, name)
VALUES ('00000000-0000-0000-0000-000000000099', 'Labor RPC Test Diner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000099', 'owner')
ON CONFLICT DO NOTHING;

-- Included revenue rows.
-- S1: 2024-06-15 (Saturday = dow 6), sold_at 14:00Z wins over sale_time 09:00 -> hour 14, $100.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099',
        '2024-06-15', '09:00:00', '2024-06-15T14:00:00Z', 100, 'sale', NULL, NULL);
-- S2: 2024-06-15, no sold_at, sale_time 11:00 -> hour 11, $50.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099',
        '2024-06-15', '11:00:00', NULL, 50, 'sale', NULL, NULL);
-- S3: 2024-06-16 (Sunday = dow 0), no hour at all, $30.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099',
        '2024-06-16', NULL, NULL, 30, 'sale', NULL, NULL);

-- Excluded rows (must never appear in totals).
-- X1: adjustment_type set (a tip/adjustment), $1000.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099',
        '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 1000, 'sale', NULL, 'tip');
-- X2: child of S1 (parent_sale_id set), $2000.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099',
        '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 2000, 'sale',
        'aaaaaaaa-0000-0000-0000-000000000001', NULL);
-- X3: item_type not 'sale', $4000.
INSERT INTO unified_sales (id, restaurant_id, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099',
        '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 4000, 'tip', NULL, NULL);

-- Act as the member.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
SET LOCAL role = authenticated;

-- Main call: UTC so sold_at hour buckets are stable.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2024-06-01'::date, '2024-06-30'::date, 'UTC'
) AS r \gset

-- daily: 15th = 150, 16th = 30.
SELECT is(
  (SELECT jsonb_agg(elem ORDER BY (elem->>'sale_date'))
   FROM jsonb_array_elements(:'r'::jsonb->'daily') elem),
  '[{"sale_date": "2024-06-15", "revenue": 150}, {"sale_date": "2024-06-16", "revenue": 30}]'::jsonb,
  'daily sums per date, excludes tip/child/non-sale rows'
);

-- grid length 2 (only hour-bearing rows: S1, S2).
SELECT is(
  jsonb_array_length(:'r'::jsonb->'grid'), 2,
  'grid has one cell per hour-bearing sale bucket'
);
-- grid cell (dow 6, hour 14) = 100.
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 6 AND (elem->>'hour')::int = 14),
  100::numeric, 'grid cell Saturday 14:00 = 100 (sold_at wins)'
);
-- grid cell (dow 6, hour 11) = 50.
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 6 AND (elem->>'hour')::int = 11),
  50::numeric, 'grid cell Saturday 11:00 = 50 (sale_time)'
);
-- No grid cell at hour 9 (sold_at overrode sale_time for S1).
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'hour')::int = 9),
  0, 'sold_at overrides sale_time: no cell at hour 9'
);
-- The hourless row S3 is not in the grid.
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 0),
  0, 'hourless sale is excluded from the grid'
);

-- by_weekday: dow 0 = 30, dow 6 = 150 (all revenue, incl. hourless).
SELECT is(
  (SELECT jsonb_agg(elem ORDER BY (elem->>'dow')::int)
   FROM jsonb_array_elements(:'r'::jsonb->'by_weekday') elem),
  '[{"dow": 0, "revenue": 30}, {"dow": 6, "revenue": 150}]'::jsonb,
  'by_weekday sums all revenue per weekday, including hourless'
);

-- has_hourly true (S1/S2 carry hours).
SELECT is(:'r'::jsonb->'has_hourly', 'true'::jsonb, 'has_hourly true when any row has an hour');

-- Single-day 2024-06-16: only the hourless S3 -> has_hourly false, grid empty.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2024-06-16'::date, '2024-06-16'::date, 'UTC'
) AS r2 \gset
SELECT is(:'r2'::jsonb->'has_hourly', 'false'::jsonb, 'has_hourly false for a day with no hour-bearing rows');
SELECT is(jsonb_array_length(:'r2'::jsonb->'grid'), 0, 'grid empty for a day with no hour-bearing rows');
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r2'::jsonb->'daily') elem),
  30::numeric, 'single-day daily still totals the hourless revenue'
);

-- Empty range: daily empty array, has_hourly false.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2020-01-01'::date, '2020-01-31'::date, 'UTC'
) AS r3 \gset
SELECT is(:'r3'::jsonb->'daily', '[]'::jsonb, 'empty range returns an empty daily array');
SELECT is(:'r3'::jsonb->'has_hourly', 'false'::jsonb, 'empty range returns has_hourly false');

-- Access control: a non-member is denied.
SET LOCAL request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT get_labor_sales_analytics('00000000-0000-0000-0000-000000000099', '2024-06-01'::date, '2024-06-30'::date, 'UTC') $$,
  'Access denied to restaurant',
  'non-member is denied'
);

-- Signature exists.
SELECT has_function(
  'public', 'get_labor_sales_analytics',
  ARRAY['uuid', 'date', 'date', 'text'],
  'get_labor_sales_analytics(uuid, date, date, text) exists'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run db:reset && npm run test:db`
Expected: `63_get_labor_sales_analytics.sql` FAILS — `function get_labor_sales_analytics(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260809120000_get_labor_sales_analytics.sql`:

```sql
-- get_labor_sales_analytics: one-round-trip sales aggregate for the /labor page.
-- Replaces the client-side aggregation of ~23,700 raw unified_sales rows per
-- load (18-week window) with a single JSONB result. Authoritative revenue
-- predicate (design §3): parent_sale_id IS NULL AND adjustment_type IS NULL
-- AND item_type = 'sale'. Hour buckets use sold_at (timezone-aware) when
-- present, else sale_time (a TIME column), else NULL (excluded from the grid).

CREATE OR REPLACE FUNCTION public.get_labor_sales_analytics(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'America/Chicago'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_time_zone TEXT := COALESCE(p_time_zone, 'America/Chicago');
  v_result JSONB;
BEGIN
  -- Access check: the caller must be a member of the restaurant. SECURITY
  -- DEFINER bypasses RLS, so this gate is the tenant isolation boundary.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  WITH revenue_rows AS (
    SELECT
      us.sale_date,
      us.total_price,
      CASE
        WHEN us.sold_at IS NOT NULL
          THEN EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE v_time_zone))::int
        WHEN us.sale_time IS NOT NULL
          THEN EXTRACT(HOUR FROM us.sale_time)::int
        ELSE NULL
      END AS hour_bucket
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.parent_sale_id IS NULL
      AND us.adjustment_type IS NULL
      AND us.item_type = 'sale'
      AND us.sale_date >= p_start_date
      AND us.sale_date <= p_end_date
  )
  SELECT jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d.sale_date), '[]'::jsonb)
      FROM (
        SELECT sale_date, ROUND(SUM(total_price), 2) AS revenue
        FROM revenue_rows
        GROUP BY sale_date
      ) d
    ),
    'grid', (
      SELECT COALESCE(jsonb_agg(g ORDER BY g.dow, g.hour), '[]'::jsonb)
      FROM (
        SELECT
          EXTRACT(DOW FROM sale_date)::int AS dow,
          hour_bucket AS hour,
          ROUND(SUM(total_price), 2) AS revenue
        FROM revenue_rows
        WHERE hour_bucket IS NOT NULL
        GROUP BY EXTRACT(DOW FROM sale_date)::int, hour_bucket
      ) g
    ),
    'by_weekday', (
      SELECT COALESCE(jsonb_agg(w ORDER BY w.dow), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(DOW FROM sale_date)::int AS dow, ROUND(SUM(total_price), 2) AS revenue
        FROM revenue_rows
        GROUP BY EXTRACT(DOW FROM sale_date)::int
      ) w
    ),
    'has_hourly', (
      SELECT COALESCE(bool_or(hour_bucket IS NOT NULL), false) FROM revenue_rows
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_labor_sales_analytics(UUID, DATE, DATE, TEXT) TO authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: `63_get_labor_sales_analytics.sql` PASSES (16 tests). (If the local Supabase stack is not running, first run `npm run db:start`.)

- [ ] **Step 5: Hand-add the RPC to `types.ts`**

The repo has no gen-types npm script, so add the entry by hand. In `src/integrations/supabase/types.ts`, find the `Functions` entry `get_monthly_sales_metrics:` (it follows `get_employee_punch_status`). Insert the new entry immediately BEFORE it (alphabetical: `get_labor` < `get_monthly`):

```ts
      get_labor_sales_analytics: {
        Args: {
          p_end_date: string
          p_restaurant_id: string
          p_start_date: string
          p_time_zone?: string
        }
        Returns: Json
      }
```

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260809120000_get_labor_sales_analytics.sql supabase/tests/63_get_labor_sales_analytics.sql src/integrations/supabase/types.ts
git commit -m "$(cat <<'EOF'
feat(labor): add get_labor_sales_analytics RPC

Aggregate /labor page sales in SQL: daily totals, (dow, hour) grid,
by-weekday totals, and an has_hourly flag as one JSONB object. Uses the
authoritative revenue predicate (parent_sale_id IS NULL AND
adjustment_type IS NULL AND item_type = 'sale') and a member access
check. Add pgTAP coverage and the hand-written types.ts entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Pure mappers (RPC JSONB → SplhPoint[] / SplhGridCell[])

**Files:**
- Modify: `src/lib/splhAnalytics.ts` (export `FALLBACK_OPEN_HOUR`, `FALLBACK_CLOSE_HOUR`)
- Modify: `src/lib/laborPnlAnalytics.ts` (add `dailySalesFromRpc`, `salesGridCellsFromRpc`)
- Create: `tests/unit/laborPnlAnalytics.mappers.test.ts`

**Interfaces:**
- Consumes: `SplhPoint`, `SplhGridCell` from `./splhAnalytics`; `round2` (private, already in `laborPnlAnalytics.ts`); `FALLBACK_OPEN_HOUR = 9`, `FALLBACK_CLOSE_HOUR = 22` from `./splhAnalytics`.
- Produces:
  - `dailySalesFromRpc(daily: { sale_date: string; revenue: number }[]): SplhPoint[]`
  - `salesGridCellsFromRpc(grid: { dow: number; hour: number; revenue: number }[], byWeekday: { dow: number; revenue: number }[], hasHourly: boolean): SplhGridCell[]` — a full 7×24 array; the daily-spread fallback (`!hasHourly`) mirrors `buildSplhGrid` to the cent (weekday total spread across hours 9..21).

- [ ] **Step 1: Export the fallback hour constants**

In `src/lib/splhAnalytics.ts`, change lines 56-57 from:

```ts
const FALLBACK_OPEN_HOUR = 9;
const FALLBACK_CLOSE_HOUR = 22; // 10pm
```

to:

```ts
export const FALLBACK_OPEN_HOUR = 9;
export const FALLBACK_CLOSE_HOUR = 22; // 10pm
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/laborPnlAnalytics.mappers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dailySalesFromRpc, salesGridCellsFromRpc } from '@/lib/laborPnlAnalytics';
import { buildSplhGrid } from '@/lib/splhAnalytics';
import type { SplhSaleRow } from '@/lib/splhAnalytics';

describe('dailySalesFromRpc', () => {
  it('maps each daily row to an SplhPoint with zero hours and null splh', () => {
    expect(dailySalesFromRpc([
      { sale_date: '2026-07-06', revenue: 400 },
      { sale_date: '2026-07-07', revenue: 200.5 },
    ])).toEqual([
      { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 400, totalHours: 0, splh: null },
      { bucketStart: '2026-07-07', label: '2026-07-07', totalSales: 200.5, totalHours: 0, splh: null },
    ]);
  });

  it('returns [] for an empty array', () => {
    expect(dailySalesFromRpc([])).toEqual([]);
  });
});

describe('salesGridCellsFromRpc', () => {
  it('returns a full 7x24 grid, hourly path fills the reported cells', () => {
    const cells = salesGridCellsFromRpc(
      [{ dow: 1, hour: 17, revenue: 400 }, { dow: 2, hour: 12, revenue: 200 }],
      [{ dow: 1, revenue: 400 }, { dow: 2, revenue: 200 }],
      true,
    );
    expect(cells).toHaveLength(7 * 24);
    expect(cells.find((c) => c.dow === 1 && c.hour === 17)?.totalSales).toBe(400);
    expect(cells.find((c) => c.dow === 2 && c.hour === 12)?.totalSales).toBe(200);
    expect(cells.find((c) => c.dow === 0 && c.hour === 0)?.totalSales).toBe(0);
    for (const c of cells) {
      expect(c.totalHours).toBe(0);
      expect(c.splh).toBeNull();
    }
  });

  it('CRITICAL: fallback path matches buildSplhGrid to the cent (weekday total / 13, hours 9..21)', () => {
    // Two hourless sales on the same Monday (2026-07-06 = Monday = dow 1).
    const sales: SplhSaleRow[] = [
      { sale_date: '2026-07-06', sale_time: null as unknown as string, total_price: 100 },
      { sale_date: '2026-07-06', sale_time: null as unknown as string, total_price: 30 },
    ];
    const expected = buildSplhGrid(sales, [], 'UTC', 0); // fallback branch (no hours)
    const mapped = salesGridCellsFromRpc([], [{ dow: 1, revenue: 130 }], false);

    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const e = expected.find((c) => c.dow === dow && c.hour === hour)!;
        const m = mapped.find((c) => c.dow === dow && c.hour === hour)!;
        expect(m.totalSales).toBe(e.totalSales);
      }
    }
    // Spot-check: 130 / 13 = 10 per hour across 9..21; 0 outside.
    expect(mapped.find((c) => c.dow === 1 && c.hour === 9)?.totalSales).toBe(10);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 21)?.totalSales).toBe(10);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 22)?.totalSales).toBe(0);
    expect(mapped.find((c) => c.dow === 1 && c.hour === 8)?.totalSales).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- tests/unit/laborPnlAnalytics.mappers.test.ts`
Expected: FAIL — `dailySalesFromRpc`/`salesGridCellsFromRpc` are not exported.

- [ ] **Step 4: Add the mappers**

In `src/lib/laborPnlAnalytics.ts`, update the imports on lines 12-13 to add the two constants:

```ts
import { mondayOf, hourOfSale, distributeWorkedHours, FALLBACK_OPEN_HOUR, FALLBACK_CLOSE_HOUR } from './splhAnalytics';
import type { SplhPoint, SplhGridCell, SplhSaleRow } from './splhAnalytics';
```

Then append the two mappers at the end of the file:

```ts
/**
 * Maps the RPC `daily` array to the `SplhPoint[]` shape the labor daily series
 * consumes. `totalHours`/`splh` are unused by the financial series (it reads
 * only `bucketStart` + `totalSales`), so they are zero/null. Mirrors the
 * `buildSplhTimeseries(..., 'day')` output this replaces.
 */
export function dailySalesFromRpc(daily: { sale_date: string; revenue: number }[]): SplhPoint[] {
  return daily.map((d) => ({
    bucketStart: d.sale_date,
    label: d.sale_date,
    totalSales: d.revenue,
    totalHours: 0,
    splh: null,
  }));
}

/**
 * Maps the RPC grid/by_weekday arrays to a full 7x24 `SplhGridCell[]`, matching
 * `buildSplhGrid`'s sales output to the cent. When `hasHourly` is true, real
 * (dow, hour) revenue fills the reported cells. When false (no sale carries an
 * hour), each weekday's total is spread evenly across business hours 9..21 —
 * the same daily-spread fallback `buildSplhGrid` performs. Labor hours are not
 * part of this map (the caller supplies labor separately); `totalHours` is 0
 * and `splh` is null, and every cell is `state: 'closed'` — the busy-hours grid
 * (`buildSalesVolumeGrid`) reads only `totalSales`/`dow`/`hour`.
 */
export function salesGridCellsFromRpc(
  grid: { dow: number; hour: number; revenue: number }[],
  byWeekday: { dow: number; revenue: number }[],
  hasHourly: boolean,
): SplhGridCell[] {
  const key = (dow: number, hour: number) => dow * 24 + hour;
  const salesMap = new Map<number, number>();
  if (hasHourly) {
    for (const cell of grid) salesMap.set(key(cell.dow, cell.hour), cell.revenue);
  } else {
    const businessHours = FALLBACK_CLOSE_HOUR - FALLBACK_OPEN_HOUR;
    for (const w of byWeekday) {
      const perHour = w.revenue / businessHours;
      for (let hour = FALLBACK_OPEN_HOUR; hour < FALLBACK_CLOSE_HOUR; hour++) {
        salesMap.set(key(w.dow, hour), perHour);
      }
    }
  }
  const cells: SplhGridCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({
        dow,
        hour,
        totalSales: round2(salesMap.get(key(dow, hour)) ?? 0),
        totalHours: 0,
        splh: null,
        state: 'closed',
      });
    }
  }
  return cells;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/unit/laborPnlAnalytics.mappers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify typecheck, lint, and existing splh tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors.

Run: `npm run test -- tests/unit/laborPnlAnalytics tests/unit/splhAnalytics`
Expected: PASS (mappers + any existing lib tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/splhAnalytics.ts src/lib/laborPnlAnalytics.ts tests/unit/laborPnlAnalytics.mappers.test.ts
git commit -m "$(cat <<'EOF'
feat(labor): add RPC-to-analytics mappers

dailySalesFromRpc and salesGridCellsFromRpc turn the RPC JSONB into the
existing SplhPoint[] / SplhGridCell[] shapes. The daily-spread fallback
matches buildSplhGrid to the cent. Export the fallback hour constants.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `useLaborSalesAnalytics` hook

**Files:**
- Create: `src/hooks/useLaborSalesAnalytics.ts`
- Create: `tests/unit/useLaborSalesAnalytics.test.ts`

**Interfaces:**
- Consumes: `localWindow` (Task 1); `supabase` client; RPC `get_labor_sales_analytics` (Task 2).
- Produces: `useLaborSalesAnalytics(restaurantId: string | null, tz: string, weeks: number)` — a React Query result whose `data` is
  `LaborSalesAnalytics { daily: {sale_date;revenue}[]; grid: {dow;hour;revenue}[]; by_weekday: {dow;revenue}[]; has_hourly: boolean }`.
  queryKey `['labor-sales-analytics', restaurantId, tz, weeks]`, `staleTime: 60000`, `refetchOnWindowFocus: true`, `enabled: !!restaurantId`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useLaborSalesAnalytics.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: rpcMock } }));

import { useLaborSalesAnalytics } from '@/hooks/useLaborSalesAnalytics';

const RPC = {
  daily: [{ sale_date: '2026-07-06', revenue: 400 }],
  grid: [{ dow: 1, hour: 17, revenue: 400 }],
  by_weekday: [{ dow: 1, revenue: 400 }],
  has_hourly: true,
};

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborSalesAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the RPC with the restaurant-local window and returns the aggregate', async () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(() => useLaborSalesAnalytics('rest-1', 'UTC', 18), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('get_labor_sales_analytics', {
      p_restaurant_id: 'rest-1',
      p_start_date: '2026-03-10',
      p_end_date: '2026-07-14',
      p_time_zone: 'UTC',
    });
    expect(result.current.data).toEqual(RPC);
  });

  it('does not fetch when restaurantId is null', () => {
    rpcMock.mockResolvedValue({ data: RPC, error: null });
    const { result } = renderHook(() => useLaborSalesAnalytics(null, 'UTC', 18), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc failed') });
    const { result } = renderHook(() => useLaborSalesAnalytics('rest-1', 'UTC', 18), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('rpc failed'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/useLaborSalesAnalytics.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useLaborSalesAnalytics`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useLaborSalesAnalytics.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { localWindow } from '@/lib/localDateWindow';

/** The RPC's JSONB return shape (design §5.3). */
export interface LaborSalesAnalytics {
  daily: { sale_date: string; revenue: number }[];
  grid: { dow: number; hour: number; revenue: number }[];
  by_weekday: { dow: number; revenue: number }[];
  has_hourly: boolean;
}

/**
 * One-round-trip sales aggregate for the /labor page. Calls the
 * `get_labor_sales_analytics` RPC over the restaurant-local `weeks` window
 * (same window as `useSplhData` via the shared `localWindow` helper). Replaces
 * the client-side aggregation of ~23,700 raw rows per load. Callers are
 * expected to have already validated `tz` (e.g. via `safeTz`).
 */
export function useLaborSalesAnalytics(restaurantId: string | null, tz: string, weeks: number) {
  return useQuery({
    queryKey: ['labor-sales-analytics', restaurantId, tz, weeks],
    queryFn: async (): Promise<LaborSalesAnalytics> => {
      const { startStr, endStr } = localWindow(tz, weeks);
      const { data, error } = await supabase.rpc('get_labor_sales_analytics', {
        p_restaurant_id: restaurantId!,
        p_start_date: startStr,
        p_end_date: endStr,
        p_time_zone: tz,
      });
      if (error) throw error;
      return data as unknown as LaborSalesAnalytics;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/useLaborSalesAnalytics.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useLaborSalesAnalytics.ts tests/unit/useLaborSalesAnalytics.test.ts
git commit -m "$(cat <<'EOF'
feat(labor): add useLaborSalesAnalytics hook

React Query hook over get_labor_sales_analytics. Resolves the same
restaurant-local window as useSplhData via the shared helper and returns
the JSONB aggregate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `useLaborIntradaySeries` hook (lazy single-day)

**Files:**
- Create: `src/hooks/useLaborIntradaySeries.ts`
- Create: `tests/unit/useLaborIntradaySeries.test.ts`

**Interfaces:**
- Consumes: `supabase`; `useEmployees` (`{ status: 'all' }`); `computeAvgHourlyRateCents` from `@/lib/staffingCalculator`; `buildIntradayFinancialSeries` (Task-3-adjacent, already exists) from `@/lib/laborPnlAnalytics`; `normalizePunches`, `identifyWorkSessions` from `@/utils/timePunchProcessing`; `appendOpenShiftClockOuts`; `getTodayInTimezone` from `@/lib/timezone`; `lookaheadPunchFetchRange`; `fromZonedTime` from `date-fns-tz`; types `SplhSaleRow`, `TimePunch`, `FinancialPoint`.
- Produces: `useLaborIntradaySeries(restaurantId: string | null, tz: string, dateStr: string, targetPct: number, enabled: boolean): { series: FinancialPoint[]; isLoading: boolean }`.

Import paths (confirmed in the current tree):
- `appendOpenShiftClockOuts` → `@/utils/openShiftPunches`
- `lookaheadPunchFetchRange` → `@/utils/punchWindow`
- `normalizePunches`, `identifyWorkSessions` → `@/utils/timePunchProcessing`
- `computeAvgHourlyRateCents` → `@/lib/staffingCalculator`
- `getTodayInTimezone` → `@/lib/timezone`
- `buildIntradayFinancialSeries`, `FinancialPoint` → `@/lib/laborPnlAnalytics`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useLaborIntradaySeries.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { buildIntradayFinancialSeries } from '@/lib/laborPnlAnalytics';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

const { mockUseEmployees, mockGetToday, fromMock } = vi.hoisted(() => ({
  mockUseEmployees: vi.fn(),
  mockGetToday: vi.fn(() => '2026-07-14'),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: fromMock } }));
vi.mock('@/hooks/useEmployees', () => ({ useEmployees: mockUseEmployees }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useLaborIntradaySeries } from '@/hooks/useLaborIntradaySeries';

const SALES: SplhSaleRow[] = [
  { sale_date: '2026-07-06', sale_time: '12:00:00', sold_at: '2026-07-06T12:00:00Z', total_price: 200 },
  { sale_date: '2026-07-06', sale_time: '13:00:00', sold_at: '2026-07-06T13:00:00Z', total_price: 100 },
];
const PUNCHES: TimePunch[] = [
  { id: 'p1', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_in', punch_time: '2026-07-06T12:00:00Z' } as TimePunch,
  { id: 'p2', restaurant_id: 'rest-1', employee_id: 'emp-1', punch_type: 'clock_out', punch_time: '2026-07-06T14:00:00Z' } as TimePunch,
];
const EMPLOYEES = [{ id: 'emp-1', hourly_rate: 20 }];

// A thenable fake query-builder: every chained filter returns `this`; awaiting
// it resolves to { data, error } keyed by the table passed to `.from()`.
function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'order']) builder[m] = vi.fn(chain);
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return builder;
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborIntradaySeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-14'); // dateStr below is a PAST day -> no cap
    mockUseEmployees.mockReturnValue({ employees: EMPLOYEES, loading: false, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'unified_sales' ? makeBuilder(SALES) : makeBuilder(PUNCHES));
  });

  it('builds the intraday series from the single-day fetch (real transforms)', async () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries('rest-1', 'UTC', '2026-07-06', 22, true),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const avg = computeAvgHourlyRateCents(EMPLOYEES as never);
    const sessions = identifyWorkSessions(normalizePunches(appendOpenShiftClockOuts(PUNCHES, new Date())));
    const expected = buildIntradayFinancialSeries(SALES, sessions, 'UTC', '2026-07-06', avg, 22, undefined);
    expect(result.current.series).toEqual(expected);
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries('rest-1', 'UTC', '2026-07-06', 22, false),
      { wrapper: createWrapper() },
    );
    expect(result.current.series).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('does not fetch when restaurantId is null', () => {
    const { result } = renderHook(
      () => useLaborIntradaySeries(null, 'UTC', '2026-07-06', 22, true),
      { wrapper: createWrapper() },
    );
    expect(result.current.series).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/useLaborIntradaySeries.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useLaborIntradaySeries`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useLaborIntradaySeries.ts`:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from '@/hooks/useEmployees';
import { buildIntradayFinancialSeries } from '@/lib/laborPnlAnalytics';
import type { FinancialPoint } from '@/lib/laborPnlAnalytics';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { lookaheadPunchFetchRange } from '@/utils/punchWindow';
import { getTodayInTimezone } from '@/lib/timezone';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

/** Current hour (0..23) in `tz`. Used only to cap "today" at the current hour. */
function currentHourInTz(tz: string): number {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    .formatToParts(new Date())
    .find((p) => p.type === 'hour')?.value;
  return value ? Number(value) % 24 : 23;
}

interface IntradayData {
  sales: SplhSaleRow[];
  punches: TimePunch[];
}

/**
 * Lazy single-day fetch for the /labor Day view's intraday chart (design §9).
 * Fetches one restaurant-local day of sales + punches only when `enabled`
 * (the range is a single day) and returns the hour-of-day financial series via
 * `buildIntradayFinancialSeries` — an average-rate SHAPE estimate, not
 * payroll-grade (the KPI row still uses the day's payroll-grade total). One day
 * is ~200 rows, so no pagination is needed.
 */
export function useLaborIntradaySeries(
  restaurantId: string | null,
  tz: string,
  dateStr: string,
  targetPct: number,
  enabled: boolean,
): { series: FinancialPoint[]; isLoading: boolean } {
  const { employees } = useEmployees(restaurantId, { status: 'all' });
  const avgHourlyRateCents = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading } = useQuery({
    queryKey: ['labor-intraday', restaurantId, tz, dateStr],
    queryFn: async (): Promise<IntradayData> => {
      const dayStart = fromZonedTime(`${dateStr}T00:00:00`, tz);
      const dayEnd = fromZonedTime(`${dateStr}T23:59:59.999`, tz);
      const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dayStart, dayEnd);

      const [salesRes, punchesRes] = await Promise.all([
        supabase
          .from('unified_sales')
          .select('sale_date, sale_time, sold_at, total_price')
          .eq('restaurant_id', restaurantId!)
          .eq('item_type', 'sale')
          .is('parent_sale_id', null)
          .is('adjustment_type', null)
          .eq('sale_date', dateStr),
        supabase
          .from('time_punches')
          .select('id, restaurant_id, employee_id, punch_type, punch_time')
          .eq('restaurant_id', restaurantId!)
          .gte('punch_time', fetchStart.toISOString())
          .lte('punch_time', fetchEnd.toISOString())
          .order('employee_id')
          .order('punch_time'),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (punchesRes.error) throw punchesRes.error;
      return {
        sales: (salesRes.data ?? []) as unknown as SplhSaleRow[],
        punches: (punchesRes.data ?? []) as unknown as TimePunch[],
      };
    },
    enabled: enabled && !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const series = useMemo(() => {
    if (!data) return [];
    const sessions = identifyWorkSessions(normalizePunches(appendOpenShiftClockOuts(data.punches, new Date())));
    const capHour = dateStr === getTodayInTimezone(tz) ? currentHourInTz(tz) : undefined;
    return buildIntradayFinancialSeries(data.sales, sessions, tz, dateStr, avgHourlyRateCents, targetPct, capHour);
  }, [data, dateStr, tz, avgHourlyRateCents, targetPct]);

  return { series, isLoading: enabled ? isLoading : false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/useLaborIntradaySeries.test.ts`
Expected: PASS (3 tests).

Note: the hook and test import `appendOpenShiftClockOuts` from `@/utils/openShiftPunches` and `lookaheadPunchFetchRange` from `@/utils/punchWindow` (confirmed paths). If a future refactor moves either, fix both imports to match, then re-run.

- [ ] **Step 5: Verify typecheck and lint**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useLaborIntradaySeries.ts tests/unit/useLaborIntradaySeries.test.ts
git commit -m "$(cat <<'EOF'
feat(labor): add useLaborIntradaySeries lazy day-view hook

Fetches one restaurant-local day of sales + punches only when the range
is a single day, and returns the hour-of-day financial series via
buildIntradayFinancialSeries.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Atomic rewire of `useLaborPnlCore` + `useLaborPnlAnalytics`

This task is atomic: the page reads `sales`/`sessions` from the core, which the core cannot supply after switching to the RPC. Rewire both hooks and both test files in one commit.

**Files:**
- Modify (replace): `src/hooks/useLaborPnlCore.ts`
- Modify (replace): `src/hooks/useLaborPnlAnalytics.ts`
- Modify (replace): `tests/unit/useLaborPnlCore.test.ts`
- Modify (replace): `tests/unit/useLaborPnlAnalytics.test.ts`

**Interfaces:**
- Consumes: `useLaborSalesAnalytics` (Task 4); `dailySalesFromRpc`, `salesGridCellsFromRpc` (Task 3); `useLaborIntradaySeries` (Task 5); the existing `useLaborCostsFromTimeTracking`, `useStaffingSettings`, `useRestaurantContext`, `useTodayInTimezone`, `safeTz`.
- Produces:
  - `useLaborPnlCore(restaurantId, weeks)` returns `{ tz, targetPct, todayStr, windowStart, windowEnd, dailySales: SplhPoint[], dailyLabor: LaborCostData[], grid, byWeekday, hasHourly, capped, hasData, isLoading, isError, error, refetch, updateSettings, isSavingTarget }`. It no longer returns `sales` or `sessions`.
  - `useLaborPnlAnalytics(restaurantId, selection)` keeps its existing public return shape: `{ series, granularity, seriesIsShapeEstimate, range, todayStr, grid, summary, overWindows, underWindows, targetPct, capped, hasData, isLoading, isError, error, refetch, updateTarget, isSavingTarget }`.

- [ ] **Step 1: Replace the core test with the RPC-shaped test**

Overwrite `tests/unit/useLaborPnlCore.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';

const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseLaborSalesAnalytics,
  mockUseLaborCostsFromTimeTracking,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseLaborSalesAnalytics: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({ useRestaurantContext: mockUseRestaurantContext }));
vi.mock('@/hooks/useStaffingSettings', () => ({ useStaffingSettings: mockUseStaffingSettings }));
vi.mock('@/hooks/useLaborSalesAnalytics', () => ({ useLaborSalesAnalytics: mockUseLaborSalesAnalytics }));
vi.mock('@/hooks/useLaborCostsFromTimeTracking', () => ({ useLaborCostsFromTimeTracking: mockUseLaborCostsFromTimeTracking }));

import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

const RPC = {
  daily: [
    { sale_date: '2026-07-06', revenue: 400 },
    { sale_date: '2026-07-07', revenue: 200 },
  ],
  grid: [
    { dow: 1, hour: 17, revenue: 400 },
    { dow: 2, hour: 12, revenue: 200 },
  ],
  by_weekday: [
    { dow: 1, revenue: 400 },
    { dow: 2, revenue: 200 },
  ],
  has_hourly: true,
};

const DAILY_LABOR = [
  { date: '2026-07-06', total_labor_cost: 50, hourly_wages: 50, salary_wages: 0, contractor_payments: 0, total_hours: 1 },
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: typeof RPC;
  dailyCosts?: typeof DAILY_LABOR;
  noData?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  salesError?: Error | null;
  laborLoading?: boolean;
  laborError?: Error | null;
  laborCapped?: boolean;
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
    updateSettings: vi.fn(),
    isSaving: false,
  });
  mockUseLaborSalesAnalytics.mockReturnValue({
    data: overrides.noData ? undefined : (overrides.data ?? RPC),
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: overrides.salesError ?? null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.noData ? [] : (overrides.dailyCosts ?? DAILY_LABOR),
    totalCost: 50,
    isLoading: overrides.laborLoading ?? false,
    error: overrides.laborError ?? null,
    refetch: vi.fn(),
    capped: overrides.laborCapped ?? false,
  });
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useLaborPnlCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives dailySales via dailySalesFromRpc and passes through tz/targetPct/dailyLabor', async () => {
    setup();
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tz).toBe('UTC');
    expect(result.current.targetPct).toBe(22);
    expect(result.current.dailySales).toEqual([
      { bucketStart: '2026-07-06', label: '2026-07-06', totalSales: 400, totalHours: 0, splh: null },
      { bucketStart: '2026-07-07', label: '2026-07-07', totalSales: 200, totalHours: 0, splh: null },
    ]);
    expect(result.current.dailyLabor).toEqual(DAILY_LABOR);
    expect(result.current.hasData).toBe(true);
  });

  it('exposes the RPC grid, by_weekday, and has_hourly for the busy-hours heatmap', () => {
    setup();
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.grid).toEqual(RPC.grid);
    expect(result.current.byWeekday).toEqual(RPC.by_weekday);
    expect(result.current.hasHourly).toBe(true);
  });

  it('passes restaurantId, validated tz, and the given `weeks` window to useLaborSalesAnalytics', () => {
    setup({ timezone: 'Not/AValidZone' });
    renderHook(() => useLaborPnlCore('rest-1', 12), { wrapper: createWrapper() });
    // safeTz falls back to the restaurant default (America/Chicago), not UTC.
    expect(mockUseLaborSalesAnalytics).toHaveBeenCalledWith('rest-1', 'America/Chicago', 12);
  });

  it('derives the labor-cost window from the restaurant-local date, not the host/UTC date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    setup({ timezone: 'Pacific/Honolulu' });
    renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    expect(mockUseLaborCostsFromTimeTracking).toHaveBeenCalledTimes(1);
    const [restaurantIdArg, dateFromArg, dateToArg] = mockUseLaborCostsFromTimeTracking.mock.calls[0];
    expect(restaurantIdArg).toBe('rest-1');
    expect(format(dateToArg as Date, 'yyyy-MM-dd')).toBe('2026-07-13');
    expect(format(dateFromArg as Date, 'yyyy-MM-dd')).toBe('2026-06-15');
  });

  it('CRITICAL: windowEnd is end-of-day so today\'s evening punches are not silently excluded', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T05:00:00Z'));
    setup({ timezone: 'UTC' });
    renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });

    const [, , dateToArg] = mockUseLaborCostsFromTimeTracking.mock.calls[0];
    const windowEnd = dateToArg as Date;
    expect(format(windowEnd, 'yyyy-MM-dd')).toBe('2026-07-14');
    expect(windowEnd.getHours()).toBe(23);
    expect(windowEnd.getMinutes()).toBe(59);
    expect(windowEnd.getSeconds()).toBe(59);
  });

  it('returns empty dailySales/dailyLabor and hasData:false when the RPC data is undefined (loading)', () => {
    setup({ noData: true, isLoading: true });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.dailySales).toEqual([]);
    expect(result.current.dailyLabor).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('CRITICAL: hasData is false when sales exist but zero labor days were recorded (time tracking not set up)', () => {
    setup({ data: RPC, dailyCosts: [] });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.hasData).toBe(false);
  });

  it('capped reflects the labor-cost fetch (the SQL sales aggregate never truncates)', () => {
    setup({ laborCapped: true });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.capped).toBe(true);
  });

  it('combines isLoading/isError/error from both source hooks', () => {
    setup({ isLoading: false, laborLoading: true, laborError: new Error('boom') });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(new Error('boom'));
  });

  it('surfaces refetch that calls both source hooks', () => {
    const refetchSales = vi.fn();
    const refetchLabor = vi.fn();
    setup();
    mockUseLaborSalesAnalytics.mockReturnValue({
      data: RPC, isLoading: false, isError: false, error: null, refetch: refetchSales,
    });
    mockUseLaborCostsFromTimeTracking.mockReturnValue({
      dailyCosts: DAILY_LABOR, totalCost: 50, isLoading: false, error: null, refetch: refetchLabor, capped: false,
    });
    const { result } = renderHook(() => useLaborPnlCore('rest-1', 4), { wrapper: createWrapper() });
    result.current.refetch();
    expect(refetchSales).toHaveBeenCalledTimes(1);
    expect(refetchLabor).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the core test to verify it fails**

Run: `npm run test -- tests/unit/useLaborPnlCore.test.ts`
Expected: FAIL — the core still imports `useSplhData`/`buildSplhTimeseries` and returns `sales`/`sessions`; the new assertions (grid/byWeekday/hasHourly, `useLaborSalesAnalytics` call) do not hold yet.

- [ ] **Step 3: Rewrite `useLaborPnlCore`**

Overwrite `src/hooks/useLaborPnlCore.ts`:

```ts
import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useLaborSalesAnalytics } from '@/hooks/useLaborSalesAnalytics';
import { useLaborCostsFromTimeTracking } from '@/hooks/useLaborCostsFromTimeTracking';
import { dailySalesFromRpc } from '@/lib/laborPnlAnalytics';
import { safeTz } from '@/lib/restaurantClock';
import { useTodayInTimezone } from '@/hooks/useTodayInTimezone';

/**
 * The labor-cost fetch window, derived from the restaurant-local "today"
 * (`todayStr`), not host/UTC `new Date()`. `windowEnd` is anchored at
 * end-of-day (23:59:59.999) so today's evening punches are not cut off:
 * `useLaborCostsFromTimeTracking` feeds `windowEnd` into
 * `lookaheadPunchFetchRange`, which widens only the END of the punch fetch. A
 * midnight-start anchor would drop every punch after 00:00 today, undercounting
 * today's labor against sales (which have no such cutoff).
 */
function laborCostWindow(tz: string, weeks: number, todayStr: string): { windowStart: Date; windowEnd: Date } {
  const [y, m, d] = todayStr.split('-').map(Number);
  const windowEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const windowStart = new Date(y, m - 1, d - weeks * 7);
  return { windowStart, windowEnd };
}

/**
 * Shared data core for the Labor P&L feature (dashboard card + `/labor` page).
 * Fetches the SQL sales aggregate (`useLaborSalesAnalytics`) and the
 * payroll-grade daily labor costs (`useLaborCostsFromTimeTracking`), then joins
 * them by restaurant-local date. The sales aggregate replaces the old
 * client-side aggregation of ~23,700 raw rows. Punch → session math stays in
 * the labor-cost hook. `tz` is validated here via `safeTz`.
 */
export function useLaborPnlCore(restaurantId: string | null, weeks: number) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings, updateSettings, isSaving: isSavingTarget } = useStaffingSettings(restaurantId);
  const targetPct = effectiveSettings.target_labor_pct;

  const todayStr = useTodayInTimezone(tz);
  const { windowStart, windowEnd } = useMemo(
    () => laborCostWindow(tz, weeks, todayStr),
    [tz, weeks, todayStr],
  );

  const {
    data,
    isLoading: salesLoading,
    isError: salesIsError,
    error: salesError,
    refetch: refetchSales,
  } = useLaborSalesAnalytics(restaurantId, tz, weeks);

  const {
    dailyCosts,
    isLoading: laborLoading,
    error: laborError,
    refetch: refetchLabor,
    capped: laborCapped,
  } = useLaborCostsFromTimeTracking(restaurantId, windowStart, windowEnd, { throughNow: true });

  const dailySales = useMemo(() => (data ? dailySalesFromRpc(data.daily) : []), [data]);

  return {
    tz,
    targetPct,
    todayStr,
    windowStart,
    windowEnd,
    dailySales,
    dailyLabor: dailyCosts,
    grid: data?.grid ?? [],
    byWeekday: data?.by_weekday ?? [],
    hasHourly: data?.has_hourly ?? false,
    // The SQL aggregate never truncates; `capped` reflects only the labor fetch.
    capped: laborCapped,
    // Sales present + zero labor days = time-tracking-not-set-up invite state,
    // not a silent all-zero labor read (design §6).
    hasData: dailySales.some((p) => p.totalSales !== 0) && dailyCosts.length > 0,
    isLoading: salesLoading || laborLoading,
    isError: salesIsError || !!laborError,
    error: salesError ?? laborError ?? null,
    refetch: () => {
      refetchSales();
      refetchLabor();
    },
    updateSettings,
    isSavingTarget,
  };
}
```

- [ ] **Step 4: Run the core test to verify it passes**

Run: `npm run test -- tests/unit/useLaborPnlCore.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Replace the analytics test**

Overwrite `tests/unit/useLaborPnlAnalytics.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockUseRestaurantContext,
  mockUseStaffingSettings,
  mockUseLaborSalesAnalytics,
  mockUseLaborCostsFromTimeTracking,
  mockUseLaborIntradaySeries,
  mockGetToday,
} = vi.hoisted(() => ({
  mockUseRestaurantContext: vi.fn(),
  mockUseStaffingSettings: vi.fn(),
  mockUseLaborSalesAnalytics: vi.fn(),
  mockUseLaborCostsFromTimeTracking: vi.fn(),
  mockUseLaborIntradaySeries: vi.fn(),
  mockGetToday: vi.fn(() => '2026-07-10'),
}));

vi.mock('@/contexts/RestaurantContext', () => ({ useRestaurantContext: mockUseRestaurantContext }));
vi.mock('@/hooks/useStaffingSettings', () => ({ useStaffingSettings: mockUseStaffingSettings }));
vi.mock('@/hooks/useLaborSalesAnalytics', () => ({ useLaborSalesAnalytics: mockUseLaborSalesAnalytics }));
vi.mock('@/hooks/useLaborCostsFromTimeTracking', () => ({ useLaborCostsFromTimeTracking: mockUseLaborCostsFromTimeTracking }));
vi.mock('@/hooks/useLaborIntradaySeries', () => ({ useLaborIntradaySeries: mockUseLaborIntradaySeries }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  getTodayInTimezone: mockGetToday,
}));

import { useLaborPnlAnalytics } from '@/hooks/useLaborPnlAnalytics';

const RPC = {
  daily: [
    { sale_date: '2026-07-06', revenue: 400 },
    { sale_date: '2026-07-07', revenue: 200 },
  ],
  grid: [
    { dow: 1, hour: 17, revenue: 400 },
    { dow: 2, hour: 12, revenue: 200 },
  ],
  by_weekday: [
    { dow: 1, revenue: 400 },
    { dow: 2, revenue: 200 },
  ],
  has_hourly: true,
};

const DAILY_LABOR = [
  { date: '2026-07-06', total_labor_cost: 50, hourly_wages: 50, salary_wages: 0, contractor_payments: 0, total_hours: 1 },
  { date: '2026-07-07', total_labor_cost: 30, hourly_wages: 30, salary_wages: 0, contractor_payments: 0, total_hours: 0.5 },
];

const INTRADAY_SERIES = [
  { bucketStart: '2026-07-07T12', label: '12 PM', sales: 200, laborCost: 20, laborHours: 1, laborPct: 10, balanceState: 'under' as const },
];

function setup(overrides: {
  timezone?: string;
  target_labor_pct?: number;
  data?: typeof RPC;
  dailyCosts?: typeof DAILY_LABOR;
  laborCapped?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  updateSettings?: ReturnType<typeof vi.fn>;
  intraday?: { series: typeof INTRADAY_SERIES; isLoading: boolean };
} = {}) {
  mockUseRestaurantContext.mockReturnValue({
    selectedRestaurant: { restaurant: { timezone: overrides.timezone ?? 'UTC' } },
  });
  mockUseStaffingSettings.mockReturnValue({
    effectiveSettings: { target_labor_pct: overrides.target_labor_pct ?? 22 },
    updateSettings: overrides.updateSettings ?? vi.fn().mockResolvedValue(undefined),
    isSaving: false,
  });
  mockUseLaborSalesAnalytics.mockReturnValue({
    data: overrides.data ?? RPC,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLaborCostsFromTimeTracking.mockReturnValue({
    dailyCosts: overrides.dailyCosts ?? DAILY_LABOR,
    totalCost: 80,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    capped: overrides.laborCapped ?? false,
  });
  mockUseLaborIntradaySeries.mockReturnValue(
    overrides.intraday ?? { series: INTRADAY_SERIES, isLoading: false },
  );
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

const CUSTOM = (start: string, end: string) => ({ preset: 'custom' as const, customStart: start, customEnd: end });

describe('useLaborPnlAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToday.mockReturnValue('2026-07-10');
  });

  it('single-day range → intraday series (from useLaborIntradaySeries) + a full 7x24 grid', async () => {
    setup();
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.granularity).toBe('intraday');
    expect(result.current.series).toEqual(INTRADAY_SERIES);
    expect(result.current.seriesIsShapeEstimate).toBe(true);
    expect(mockUseLaborIntradaySeries).toHaveBeenCalledWith('rest-1', 'UTC', '2026-07-07', 22, true);

    expect(result.current.grid).toHaveLength(7 * 24);
    const hour17 = result.current.grid.find((c) => c.dow === 1 && c.hour === 17);
    expect(hour17?.totalSales).toBe(400);
    expect(hour17?.estimated).toBe(false);
    expect(result.current.targetPct).toBe(22);
  });

  it('CRITICAL: the range selects the PERIOD — KPI summary differs by range', async () => {
    setup();
    const { result: day } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(day.current.isLoading).toBe(false));
    expect(day.current.summary.sales).toBe(200);
    expect(day.current.summary.laborCost).toBe(30);

    const { result: month } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'this_month' }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(month.current.isLoading).toBe(false));
    expect(month.current.summary.sales).toBe(600);
    expect(month.current.summary.laborCost).toBe(80);
  });

  it('CRITICAL: range span picks the chart granularity (intraday / day / week)', async () => {
    setup();
    const { result: dayResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-07', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(dayResult.current.isLoading).toBe(false));
    expect(dayResult.current.granularity).toBe('intraday');
    expect(dayResult.current.series).toEqual(INTRADAY_SERIES);

    const { result: weekResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-06', '2026-07-07')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(weekResult.current.isLoading).toBe(false));
    expect(weekResult.current.granularity).toBe('day');
    expect(weekResult.current.series.map((p) => p.bucketStart)).toEqual(['2026-07-06', '2026-07-07']);
    expect(weekResult.current.seriesIsShapeEstimate).toBe(false);

    const { result: monthResult } = renderHook(() => useLaborPnlAnalytics('rest-1', CUSTOM('2026-07-06', '2026-07-25')), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(monthResult.current.isLoading).toBe(false));
    expect(monthResult.current.granularity).toBe('week');
    expect(monthResult.current.series).toHaveLength(1);
    expect(monthResult.current.series[0].bucketStart).toBe('2026-07-06');
  });

  it('MIDNIGHT ROLLOVER: refreshes "Today" when the restaurant-tz date advances', async () => {
    vi.useFakeTimers();
    try {
      mockGetToday.mockReturnValue('2026-07-07');
      setup();
      const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), {
        wrapper: createWrapper(),
      });
      expect(result.current.summary.sales).toBe(200);

      mockGetToday.mockReturnValue('2026-07-08');
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current.summary.sales).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('grid is NOT flagged estimated when the RPC reports hourly data (has_hourly true)', async () => {
    setup({ data: { ...RPC, has_hourly: true } });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.grid.every((c) => c.estimated === false)).toBe(true);
  });

  it('flags grid cells estimated:true when the RPC reports no hourly data (daily-spread fallback)', async () => {
    setup({
      data: {
        daily: [{ sale_date: '2026-07-06', revenue: 100 }],
        grid: [],
        by_weekday: [{ dow: 1, revenue: 100 }],
        has_hourly: false,
      },
    });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.grid.every((c) => c.estimated === true)).toBe(true);
  });

  it('CRITICAL: updateTarget calls updateSettings only when the value actually changed', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    setup({ target_labor_pct: 22, updateSettings });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });

    await act(async () => { await result.current.updateTarget(22); });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => { await result.current.updateTarget(25); });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ target_labor_pct: 25 });
  });

  it('propagates capped (from labor fetch), hasData, isError, and refetch from the core hook', () => {
    setup({ laborCapped: true, isError: true });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    expect(result.current.capped).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.isError).toBe(true);
    expect(typeof result.current.refetch).toBe('function');
  });

  it('ORs the intraday hook loading state into isLoading for a single-day range', () => {
    setup({ intraday: { series: [], isLoading: true } });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    // today = 2026-07-10 → single day → intraday; its loading must surface.
    expect(result.current.isLoading).toBe(true);
  });

  it('returns an empty series and an all-zero grid when there is no data (loading)', () => {
    setup({
      data: { daily: [], grid: [], by_weekday: [], has_hourly: false },
      dailyCosts: [],
      isLoading: true,
      intraday: { series: [], isLoading: true },
    });
    const { result } = renderHook(() => useLaborPnlAnalytics('rest-1', { preset: 'today' }), { wrapper: createWrapper() });
    expect(result.current.series).toEqual([]);
    expect(result.current.grid).toHaveLength(7 * 24);
    expect(result.current.grid.every((c) => c.totalSales === 0)).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });
});
```

- [ ] **Step 6: Run the analytics test to verify it fails**

Run: `npm run test -- tests/unit/useLaborPnlAnalytics.test.ts`
Expected: FAIL — the analytics hook still reads `sales`/`sessions` from the core and builds the grid/intraday client-side.

- [ ] **Step 7: Rewrite `useLaborPnlAnalytics`**

Overwrite `src/hooks/useLaborPnlAnalytics.ts`:

```ts
import { useCallback, useMemo } from 'react';

import {
  buildFinancialSeries,
  buildSalesVolumeGrid,
  extractBalanceWindows,
  resolveDateRange,
  salesGridCellsFromRpc,
  seriesGranularityForRange,
  summarizeLaborPnl,
} from '@/lib/laborPnlAnalytics';
import type { LaborRangeSelection } from '@/lib/laborPnlAnalytics';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';
import { useLaborIntradaySeries } from '@/hooks/useLaborIntradaySeries';

/** Fixed lookback for the daily/grid aggregate (design §5.1). */
const WEEKS = 18;

/**
 * Read model for the `/labor` page. Selects a date range from the 18-week
 * daily aggregate for the KPI row and the day/week chart, and delegates the
 * single-day (intraday) chart to `useLaborIntradaySeries`. The busy-hours grid
 * comes from the SQL (dow, hour) aggregate via `salesGridCellsFromRpc`.
 */
export function useLaborPnlAnalytics(restaurantId: string | null, selection: LaborRangeSelection) {
  const {
    tz,
    targetPct,
    todayStr,
    dailySales,
    dailyLabor,
    grid: coreGrid,
    byWeekday,
    hasHourly,
    capped,
    hasData,
    isLoading,
    isError,
    error,
    refetch,
    updateSettings,
    isSavingTarget,
  } = useLaborPnlCore(restaurantId, WEEKS);

  const range = useMemo(() => resolveDateRange(selection, todayStr), [selection, todayStr]);
  const granularity = useMemo(
    () => seriesGranularityForRange(range.startStr, range.endStr),
    [range],
  );

  // Intraday (Day view) series comes from its own lazy single-day fetch (design
  // §9). The hook always runs (React rules) but fetches only when enabled.
  const intraday = useLaborIntradaySeries(
    restaurantId,
    tz,
    range.endStr,
    targetPct,
    granularity === 'intraday',
  );

  const periodSales = useMemo(
    () => dailySales.filter((p) => p.bucketStart >= range.startStr && p.bucketStart <= range.endStr),
    [dailySales, range],
  );
  const periodLabor = useMemo(
    () => dailyLabor.filter((d) => d.date >= range.startStr && d.date <= range.endStr),
    [dailyLabor, range],
  );

  const periodDaily = useMemo(
    () => buildFinancialSeries(periodSales, periodLabor, 'day', targetPct),
    [periodSales, periodLabor, targetPct],
  );
  const summary = useMemo(() => summarizeLaborPnl(periodDaily, targetPct), [periodDaily, targetPct]);

  const series = useMemo(() => {
    if (granularity === 'intraday') return intraday.series;
    if (granularity === 'day') return periodDaily;
    return buildFinancialSeries(periodSales, periodLabor, 'week', targetPct);
  }, [granularity, intraday.series, periodDaily, periodSales, periodLabor, targetPct]);

  const overWindows = useMemo(() => extractBalanceWindows(series, 'over'), [series]);
  const underWindows = useMemo(() => extractBalanceWindows(series, 'under'), [series]);

  const grid = useMemo(
    () => buildSalesVolumeGrid(salesGridCellsFromRpc(coreGrid, byWeekday, hasHourly), !hasHourly),
    [coreGrid, byWeekday, hasHourly],
  );

  const updateTarget = useCallback(
    async (newTargetPct: number) => {
      if (newTargetPct === targetPct) return;
      await updateSettings({ target_labor_pct: newTargetPct });
    },
    [targetPct, updateSettings],
  );

  return {
    series,
    granularity,
    seriesIsShapeEstimate: granularity === 'intraday',
    range,
    todayStr,
    grid,
    summary,
    overWindows,
    underWindows,
    targetPct,
    capped,
    hasData,
    isLoading: isLoading || (granularity === 'intraday' && intraday.isLoading),
    isError,
    error,
    refetch,
    updateTarget,
    isSavingTarget,
  };
}
```

- [ ] **Step 8: Run the analytics test to verify it passes**

Run: `npm run test -- tests/unit/useLaborPnlAnalytics.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 9: Verify the page compiles and nothing else consumed the dropped fields**

Run: `grep -rn "useLaborPnlCore\|useLaborPnlAnalytics" src/ | grep -v "hooks/useLaborPnlCore.ts\|hooks/useLaborPnlAnalytics.ts"`
Expected: only `useLaborPnlAnalytics` consumers (the `/labor` page) appear — confirm none read `.sales` or `.sessions` off the analytics return (the public analytics shape is unchanged, so they should not).

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 10: Run the full unit suite for the labor feature**

Run: `npm run test -- tests/unit/localDateWindow.test.ts tests/unit/laborPnlAnalytics.mappers.test.ts tests/unit/useLaborSalesAnalytics.test.ts tests/unit/useLaborIntradaySeries.test.ts tests/unit/useLaborPnlCore.test.ts tests/unit/useLaborPnlAnalytics.test.ts`
Expected: PASS (all files).

- [ ] **Step 11: Commit**

```bash
git add src/hooks/useLaborPnlCore.ts src/hooks/useLaborPnlAnalytics.ts tests/unit/useLaborPnlCore.test.ts tests/unit/useLaborPnlAnalytics.test.ts
git commit -m "$(cat <<'EOF'
feat(labor): move /labor sales aggregation to SQL

Rewire useLaborPnlCore onto useLaborSalesAnalytics (the SQL aggregate)
and drop the raw sales/sessions passthrough. useLaborPnlAnalytics now
builds the busy-hours grid from the RPC aggregate and delegates the Day
view to useLaborIntradaySeries. Removes the 18-week raw-row fetch and the
20,000-row pagination cap. Public read shape unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (whole feature)

- [ ] Run the full unit suite: `npm run test`
- [ ] Run the SQL suite: `npm run db:reset && npm run test:db`
- [ ] Typecheck + lint: `npm run typecheck && npm run lint`
- [ ] Manual: open `/labor`, confirm the network tab shows the single `get_labor_sales_analytics` RPC call in place of the paginated `unified_sales` fetches, and the KPI row, chart (Day/Week/Month), and busy-hours grid render the same numbers as before.

## Notes for the executor

- The `/labor` page reads only the `useLaborPnlAnalytics` return, whose public shape is unchanged. If Step 9 surfaces any consumer of `core.sales`/`core.sessions`, stop and reconcile before finishing Task 6.
- Task 5's util import paths are confirmed in that task's header. `appendOpenShiftClockOuts` is at `@/utils/openShiftPunches` and `lookaheadPunchFetchRange` is at `@/utils/punchWindow` — not under `@/lib`.
- Production writes are out of scope. No prod SQL runs in this plan; the RPC ships as a migration and is verified locally with pgTAP.
