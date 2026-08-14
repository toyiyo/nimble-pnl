# AI Financial Tools Row-Cap + Break-Even + Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every AI-tool financial sum into SQL, fix the variable-cost math, and label budget data and percent units.

**Architecture:** Nine new `SECURITY INVOKER` aggregate RPCs plus one modified RPC replace every raw-fetch-then-`.reduce()` sum in `supabase/functions/ai-execute-tool/index.ts`. A new shared helper (`financialAggregates.ts`) gives every tool one net-sales definition. Fix 2 corrects the operating-costs variable math. Fix 3 labels budget data, renames percent fields, and adds prompt guidance.

**Tech Stack:** PostgreSQL (SQL RPCs + pgTAP), Deno edge functions (TypeScript), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-ai-financial-tools-row-cap-design.md` (read §5, §6, §13 before any task).

## Global Constraints

- Write all prose (comments, commit messages, PR body) in STE-aligned English per `CLAUDE.md`.
- Every new SQL function: `SECURITY INVOKER`, `SET search_path TO 'public'`, `COALESCE(SUM(...), 0)`, then `REVOKE EXECUTE ... FROM PUBLIC; REVOKE ... FROM anon; GRANT EXECUTE ... TO authenticated;` and a `COMMENT ON FUNCTION`.
- Migration timestamps: use the exact filenames given per task. All are later than `20260814120000` (the merged tenancy hotfix).
- pgTAP files: fixtures insert as the session role (`postgres`, `BYPASSRLS`), RLS stays enabled. Tenancy assertions run under `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`. Follow `supabase/tests/37_monthly_sales_metrics_tenancy.sql`.
- Never run `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Test commands: `npm run db:reset` applies migrations locally; `npm run test:db` runs pgTAP; `npx vitest run <file>` runs one unit file; `npm run typecheck` must stay clean.
- The branch is `fix/ai-financial-tools-row-cap`, worktree `.claude/worktrees/ai-financial-tools-row-cap`, already rebased on `main`.
- Do not edit `supabase/migrations/20260814120000_secure_monthly_sales_metrics_tenancy.sql`. Build on top of it.

---

### Task 1: Baseline check

**Files:** none (verification only)

- [ ] **Step 1: Confirm the branch state**

Run: `git log --oneline -3`
Expected: `a417b8f9` and `cbfc2ed2` (the two design commits) on top of current `main`.

- [ ] **Step 2: Reset the local DB and run the baseline suites**

Run: `npm run db:reset` then `npm run test:db` then `npm run typecheck`
Expected: migrations apply clean; pgTAP all green (including `36_` and `37_`); typecheck clean. If `db:reset` fails, stop and report — do not patch migrations.

---

### Task 2: `get_monthly_sales_metrics` — add the `refunds` column (spec §5.1 Change B, §13.1)

**Files:**
- Create: `supabase/migrations/20260814130000_monthly_sales_metrics_refunds.sql`
- Modify: `supabase/tests/36_monthly_sales_metrics_revenue_filter.sql`

**Interfaces:**
- Produces: `get_monthly_sales_metrics(p_restaurant_id UUID, p_date_from DATE, p_date_to DATE)` → `TABLE(period TEXT, gross_revenue DECIMAL, sales_tax DECIMAL, tips DECIMAL, other_liabilities DECIMAL, discounts DECIMAL, refunds DECIMAL)`. Net sales = `gross_revenue - discounts - refunds`. Task 3 and every cluster-1 site consume this.

- [ ] **Step 1: Write the failing pgTAP assertions**

In `36_monthly_sales_metrics_revenue_filter.sql`, change `plan(5)` to `plan(7)`. Before the cross-restaurant-child section, add a refund fixture and two assertions:

```sql
-- A $20 refund row must land in the refunds column, not in gross_revenue.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000704', :'restaurant_id', 'test', 'ord-rf-1', 'item-rf-1',
    'Refunded Burger', 1, -20, -20, '2026-04-16', 'refund', false,
    NULL, NULL, NULL);

SELECT is(
  (SELECT refunds::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  20.00::numeric,
  'a refund row lands in the refunds column as a positive amount'
);

SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  150.00::numeric,
  'a refund row does not change gross_revenue'
);
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/36_monthly_sales_metrics_revenue_filter.sql`
Expected: FAIL — `column "refunds" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260814130000_monthly_sales_metrics_refunds.sql`. The return type changes, so `CREATE OR REPLACE` is not allowed — `DROP` first. Reproduce the FULL body of `20260814120000_secure_monthly_sales_metrics_tenancy.sql` (the membership guard, the `child.restaurant_id` filters, `SECURITY INVOKER`, `SET search_path TO 'public'`), with three additions marked `-- NEW` below:

```sql
-- Migration: add a refunds column to get_monthly_sales_metrics
--
-- Net sales = gross_revenue - discounts - refunds (spec §5.1 Change B).
-- The return type changes, so DROP then CREATE. Keep every security property
-- from migration 20260814120000: SECURITY INVOKER, the membership guard, the
-- child restaurant_id filters, and the grants.

DROP FUNCTION IF EXISTS public.get_monthly_sales_metrics(UUID, DATE, DATE);

CREATE FUNCTION public.get_monthly_sales_metrics(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  period TEXT,
  gross_revenue DECIMAL,
  sales_tax DECIMAL,
  tips DECIMAL,
  other_liabilities DECIMAL,
  discounts DECIMAL,
  refunds DECIMAL          -- NEW
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization check: the caller must be a member of the restaurant.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: User does not have access to restaurant %', p_restaurant_id;
  END IF;

  RETURN QUERY
  WITH monthly_revenue AS (
    -- copy VERBATIM from 20260814120000 (filters, comments, child filter)
    SELECT TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    LEFT JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
      AND (coa.account_type IS NULL OR coa.account_type = 'revenue')
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_refunds AS (   -- NEW
    SELECT TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      COALESCE(SUM(ABS(us.total_price)), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND LOWER(COALESCE(us.item_type, '')) = 'refund'
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM')
  ),
  monthly_adjustments AS (
    -- copy VERBATIM from 20260814120000
    SELECT TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      us.adjustment_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NOT NULL
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'), us.adjustment_type
  ),
  monthly_categorized_liabilities AS (
    -- copy VERBATIM from 20260814120000, including the child filter
    SELECT TO_CHAR(us.sale_date, 'YYYY-MM') as month_period,
      CASE
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%' THEN 'tip'
        ELSE 'other_liability'
      END as liability_type,
      COALESCE(SUM(us.total_price), 0)::DECIMAL as amount
    FROM unified_sales us
    INNER JOIN chart_of_accounts coa ON us.category_id = coa.id
    WHERE us.restaurant_id = p_restaurant_id
      AND us.sale_date >= p_date_from AND us.sale_date <= p_date_to
      AND us.adjustment_type IS NULL
      AND us.is_categorized = TRUE
      AND coa.account_type = 'liability'
      AND NOT EXISTS (
        SELECT 1 FROM unified_sales child
        WHERE child.parent_sale_id = us.id
          AND child.restaurant_id = p_restaurant_id
      )
    GROUP BY TO_CHAR(us.sale_date, 'YYYY-MM'),
      CASE
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tax%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tax%' THEN 'tax'
        WHEN LOWER(COALESCE(coa.account_subtype::TEXT, '')) LIKE '%tip%'
          OR LOWER(COALESCE(coa.account_name, '')) LIKE '%tip%' THEN 'tip'
        ELSE 'other_liability'
      END
  ),
  all_periods AS (
    SELECT DISTINCT month_period FROM monthly_revenue
    UNION SELECT DISTINCT month_period FROM monthly_adjustments
    UNION SELECT DISTINCT month_period FROM monthly_categorized_liabilities
    UNION SELECT DISTINCT month_period FROM monthly_refunds   -- NEW
  )
  SELECT
    p.month_period as period,
    COALESCE(r.amount, 0) as gross_revenue,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tax'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tax'), 0) as sales_tax,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'tip'), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'tip'), 0) as tips,
    COALESCE((SELECT SUM(a.amount) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type IN ('service_charge', 'fee')), 0) +
    COALESCE((SELECT SUM(l.amount) FROM monthly_categorized_liabilities l WHERE l.month_period = p.month_period AND l.liability_type = 'other_liability'), 0) as other_liabilities,
    COALESCE((SELECT SUM(ABS(a.amount)) FROM monthly_adjustments a WHERE a.month_period = p.month_period AND a.adjustment_type = 'discount'), 0) as discounts,
    COALESCE(rf.amount, 0) as refunds   -- NEW
  FROM all_periods p
  LEFT JOIN monthly_revenue r ON r.month_period = p.month_period
  LEFT JOIN monthly_refunds rf ON rf.month_period = p.month_period   -- NEW
  ORDER BY p.month_period DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_sales_metrics(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_monthly_sales_metrics IS
'Monthly sales metrics from unified_sales: gross_revenue, sales_tax, tips,
other_liabilities, discounts, refunds. Net sales = gross_revenue - discounts -
refunds. Runs as SECURITY INVOKER with a user_restaurants membership guard.
EXECUTE is granted to authenticated only.';
```

- [ ] **Step 4: Apply and run the tests**

Run: `npm run db:reset` then the two pgTAP files:
`PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/36_monthly_sales_metrics_revenue_filter.sql` and the same for `37_monthly_sales_metrics_tenancy.sql`.
Expected: `36_` 7/7, `37_` 4/4. `37_` must stay green with no edits — it pins `prosecdef = false` and `anon EXECUTE = false` through the DROP/CREATE.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260814130000_monthly_sales_metrics_refunds.sql supabase/tests/36_monthly_sales_metrics_revenue_filter.sql
git commit -m "feat(rpc): add a refunds column to get_monthly_sales_metrics"
```

---

### Task 3: Shared helper `financialAggregates.ts` + unit tests

**Files:**
- Create: `supabase/functions/_shared/financialAggregates.ts`
- Test: `tests/unit/financialAggregates.test.ts`

**Interfaces:**
- Consumes: the Task 2 RPC row shape.
- Produces (every rewiring task consumes these):

```typescript
export interface NetSalesTotals {
  gross: number; discounts: number; refunds: number;
  salesTax: number; tips: number; otherLiabilities: number;
  net: number;  // gross - discounts - refunds
}
export function sumMonthlyMetrics(rows: MonthlyMetricsRow[] | null): NetSalesTotals;
export async function fetchNetSales(
  supabase: SupabaseClient, restaurantId: string,
  startDate: string, endDate: string        // 'YYYY-MM-DD'
): Promise<NetSalesTotals>;                  // throws on RPC error
export function sumMonthlyFoodCost(rows: { period: string; food_cost: number }[] | null): number;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/financialAggregates.test.ts`. Model the RPC mock on `tests/unit/periodMetrics.test.ts` (mock the builder chain, not a bare promise — lesson L1846):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sumMonthlyMetrics, fetchNetSales, sumMonthlyFoodCost } from '../../supabase/functions/_shared/financialAggregates';

const row = (over = {}) => ({
  period: '2026-07', gross_revenue: 100, sales_tax: 8, tips: 5,
  other_liabilities: 0, discounts: 3, refunds: 2, ...over,
});

describe('sumMonthlyMetrics', () => {
  it('sums across months and computes net = gross - discounts - refunds', () => {
    const t = sumMonthlyMetrics([row(), row({ period: '2026-06', gross_revenue: 50 })]);
    expect(t.gross).toBe(150);
    expect(t.net).toBe(150 - 6 - 4);
  });
  it('returns zeros for null and for an empty array', () => {
    expect(sumMonthlyMetrics(null).net).toBe(0);
    expect(sumMonthlyMetrics([]).gross).toBe(0);
  });
  it('treats a null numeric field as 0', () => {
    expect(sumMonthlyMetrics([row({ refunds: null as unknown as number })]).net).toBe(97);
  });
});

describe('fetchNetSales', () => {
  it('calls the RPC with the exact arguments and sums the rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const t = await fetchNetSales({ rpc } as never, 'rid', '2026-07-01', '2026-07-31');
    expect(rpc).toHaveBeenCalledWith('get_monthly_sales_metrics', {
      p_restaurant_id: 'rid', p_date_from: '2026-07-01', p_date_to: '2026-07-31',
    });
    expect(t.net).toBe(95);
  });
  it('throws on an RPC error instead of a silent zero', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchNetSales({ rpc } as never, 'rid', 'a', 'b')).rejects.toThrow('boom');
  });
});

describe('sumMonthlyFoodCost', () => {
  it('sums month rows and returns 0 for null', () => {
    expect(sumMonthlyFoodCost([{ period: '2026-07', food_cost: 10.5 }, { period: '2026-06', food_cost: 2 }])).toBe(12.5);
    expect(sumMonthlyFoodCost(null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/unit/financialAggregates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```typescript
// supabase/functions/_shared/financialAggregates.ts
// One net-sales definition for every AI financial tool.
// Net sales = gross_revenue - discounts - refunds (see the spec, §5.1).

export interface MonthlyMetricsRow {
  period: string; gross_revenue: number; sales_tax: number; tips: number;
  other_liabilities: number; discounts: number; refunds: number;
}
export interface NetSalesTotals {
  gross: number; discounts: number; refunds: number;
  salesTax: number; tips: number; otherLiabilities: number; net: number;
}
const n = (v: number | null | undefined) => Number(v ?? 0);

export function sumMonthlyMetrics(rows: MonthlyMetricsRow[] | null): NetSalesTotals {
  const t = { gross: 0, discounts: 0, refunds: 0, salesTax: 0, tips: 0, otherLiabilities: 0, net: 0 };
  for (const r of rows ?? []) {
    t.gross += n(r.gross_revenue); t.discounts += n(r.discounts); t.refunds += n(r.refunds);
    t.salesTax += n(r.sales_tax); t.tips += n(r.tips); t.otherLiabilities += n(r.other_liabilities);
  }
  t.net = t.gross - t.discounts - t.refunds;
  return t;
}

export async function fetchNetSales(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  restaurantId: string, startDate: string, endDate: string,
): Promise<NetSalesTotals> {
  const { data, error } = await supabase.rpc('get_monthly_sales_metrics', {
    p_restaurant_id: restaurantId, p_date_from: startDate, p_date_to: endDate,
  });
  if (error) throw new Error(`get_monthly_sales_metrics failed: ${error.message}`);
  return sumMonthlyMetrics(data as MonthlyMetricsRow[] | null);
}

export function sumMonthlyFoodCost(rows: { period: string; food_cost: number }[] | null): number {
  return (rows ?? []).reduce((s, r) => s + n(r.food_cost), 0);
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/financialAggregates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/financialAggregates.ts tests/unit/financialAggregates.test.ts
git commit -m "feat(ai-tools): shared net-sales helper over the monthly metrics RPC"
```

---

### Task 4: RPCs `get_sales_by_category` + `get_top_sold_items` (cluster 2)

**Files:**
- Create: `supabase/migrations/20260814131000_get_sales_by_category.sql`
- Create: `supabase/migrations/20260814132000_get_top_sold_items.sql`
- Test: `supabase/tests/38_sales_breakdown_rpcs.sql`

**Interfaces:**
- Produces: `get_sales_by_category(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)` → `TABLE(category_id UUID, category_name TEXT, revenue NUMERIC, item_count BIGINT)`; `get_top_sold_items(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_limit INT DEFAULT 10)` → `TABLE(item_name TEXT, revenue NUMERIC, quantity NUMERIC, sale_count BIGINT)`. Task 11 consumes both.

- [ ] **Step 1: Write the failing pgTAP file**

Create `supabase/tests/38_sales_breakdown_rpcs.sql` with `plan(6)`. Fixtures follow the `36_` idiom (own restaurant `...240`, member user `...241`, second restaurant `...242` for tenancy). Assertions:
1. `get_sales_by_category` groups two categorized sales and one uncategorized sale into the right buckets (`lives_ok` + `is` on revenue per bucket).
2. It excludes an `adjustment_type = 'tax'` row and a split child row.
3. `get_top_sold_items` orders by revenue and honors `p_limit` (insert 3 item names, assert `p_limit => 2` returns 2 rows, top first).
4. Second restaurant's rows never contribute (`is` count with foreign rows present).
5. Tenancy: under `SET LOCAL ROLE authenticated` as a NON-member, `get_sales_by_category` for the foreign restaurant returns zero rows (`is` count 0).
6. `has_function_privilege('anon', 'public.get_sales_by_category(uuid,date,date)', 'EXECUTE')` is false.

- [ ] **Step 2: Run to confirm failure**

Run: `PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/38_sales_breakdown_rpcs.sql`
Expected: FAIL — `function get_sales_by_category(...) does not exist`.

- [ ] **Step 3: Write the two migrations**

`20260814131000_get_sales_by_category.sql`:

```sql
-- Sales revenue grouped by category for one restaurant and date range.
-- SECURITY INVOKER: RLS on unified_sales scopes the caller (spec §8).
CREATE OR REPLACE FUNCTION public.get_sales_by_category(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE(category_id UUID, category_name TEXT, revenue NUMERIC, item_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT us.category_id,
         COALESCE(coa.account_name, 'Uncategorized') AS category_name,
         COALESCE(SUM(us.total_price), 0)::NUMERIC AS revenue,
         COUNT(*)::BIGINT AS item_count
  FROM unified_sales us
  LEFT JOIN chart_of_accounts coa ON coa.id = us.category_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date AND us.sale_date <= p_end_date
    AND us.adjustment_type IS NULL
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
        AND child.restaurant_id = p_restaurant_id)
  GROUP BY us.category_id, coa.account_name
  ORDER BY revenue DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_sales_by_category IS
'Revenue by category from unified_sales. Excludes adjustments, refunds, and
split parents. SECURITY INVOKER; EXECUTE for authenticated only.';
```

`20260814132000_get_top_sold_items.sql` — same shell, body:

```sql
CREATE OR REPLACE FUNCTION public.get_top_sold_items(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_limit INT DEFAULT 10
)
RETURNS TABLE(item_name TEXT, revenue NUMERIC, quantity NUMERIC, sale_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT us.item_name,
         COALESCE(SUM(us.total_price), 0)::NUMERIC AS revenue,
         COALESCE(SUM(us.quantity), 0)::NUMERIC AS quantity,
         COUNT(*)::BIGINT AS sale_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_start_date AND us.sale_date <= p_end_date
    AND us.adjustment_type IS NULL
    AND LOWER(COALESCE(us.item_type, 'sale')) = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
        AND child.restaurant_id = p_restaurant_id)
  GROUP BY us.item_name
  ORDER BY revenue DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_top_sold_items(UUID, DATE, DATE, INT) TO authenticated;

COMMENT ON FUNCTION public.get_top_sold_items IS
'Top items by revenue from unified_sales. Same exclusions as
get_sales_by_category. SECURITY INVOKER; EXECUTE for authenticated only.';
```

- [ ] **Step 4: Apply and run**

Run: `npm run db:reset` then the pgTAP file from Step 2.
Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260814131000_get_sales_by_category.sql supabase/migrations/20260814132000_get_top_sold_items.sql supabase/tests/38_sales_breakdown_rpcs.sql
git commit -m "feat(rpc): sales-by-category and top-items aggregates"
```

---

### Task 5: RPC `get_inventory_usage_by_month` (cluster 3, COGS)

**Files:**
- Create: `supabase/migrations/20260814133000_get_inventory_usage_by_month.sql`
- Test: `supabase/tests/39_inventory_usage_by_month.sql`

**Interfaces:**
- Produces: `get_inventory_usage_by_month(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)` → `TABLE(period TEXT, food_cost NUMERIC)`. `food_cost = ABS(SUM(total_cost))` per month. Tasks 10-11 consume via `sumMonthlyFoodCost`.

- [ ] **Step 1: Write the failing pgTAP file** — `plan(5)`:
1. Two usage rows in one month sum, `ABS(SUM(...))` semantics: a `-10` usage row and a `+2` reversal row give `food_cost = 8` (not 12).
2. A non-usage row (`transaction_type = 'purchase'`) is excluded.
3. **Boundary (spec §1.3):** a usage row with `created_at = (p_end_date || ' 21:00:00+00')::timestamptz` on the END day contributes.
4. An empty month range returns zero rows (not an error) — `lives_ok` + count 0.
5. Tenancy: a non-member under `authenticated` gets zero rows for a foreign restaurant.

- [ ] **Step 2: Run to confirm failure** — expected `function ... does not exist`.

- [ ] **Step 3: Write the migration**

```sql
CREATE OR REPLACE FUNCTION public.get_inventory_usage_by_month(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE(period TEXT, food_cost NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT TO_CHAR(it.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
         ABS(COALESCE(SUM(it.total_cost), 0))::NUMERIC AS food_cost
  FROM inventory_transactions it
  WHERE it.restaurant_id = p_restaurant_id
    AND it.transaction_type = 'usage'
    -- Explicit UTC bounds. Includes the full end day (spec §5.4).
    AND it.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC')
    AND it.created_at < ((p_end_date + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_by_month(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_usage_by_month IS
'Monthly COGS from inventory_transactions usage rows, ABS(SUM(total_cost)) per
month, full end day included, explicit UTC bounds. SECURITY INVOKER.';
```

- [ ] **Step 4: Apply and run** — `npm run db:reset`, run the file, expected 5/5.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260814133000_get_inventory_usage_by_month.sql supabase/tests/39_inventory_usage_by_month.sql
git commit -m "feat(rpc): monthly inventory-usage aggregate with a correct end day"
```

---

### Task 6: RPC `get_journal_expense_total` (cluster 4, OpEx)

**Files:**
- Create: `supabase/migrations/20260814134000_get_journal_expense_total.sql`
- Test: `supabase/tests/40_journal_expense_total.sql`

**Interfaces:**
- Produces: `get_journal_expense_total(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)` → `NUMERIC` (`SUM(debit_amount - credit_amount)` over expense accounts).

- [ ] **Step 1: Failing pgTAP** — `plan(4)`: (1) two expense lines net to `debit - credit`; (2) a revenue-account line is excluded; (3) returns `0`, not NULL, for an empty range (`is(..., 0::numeric, ...)`); (4) tenancy zero for a non-member (the scalar returns 0 because RLS hides the joined rows).

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Migration**

```sql
CREATE OR REPLACE FUNCTION public.get_journal_expense_total(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::NUMERIC
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.restaurant_id = p_restaurant_id
    AND coa.restaurant_id = p_restaurant_id
    AND coa.account_type = 'expense'
    AND je.entry_date >= p_start_date AND je.entry_date <= p_end_date;
$$;

REVOKE EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_journal_expense_total IS
'Net expense debits from journal_entry_lines for one restaurant and range.
Replaces the expense-account id round-trip. SECURITY INVOKER.';
```

- [ ] **Step 4: Apply + run — expected 4/4.**
- [ ] **Step 5: Commit** (`feat(rpc): journal expense total aggregate`, both files).

---

### Task 7: RPC `get_inventory_valuation` (cluster 5)

**Files:**
- Create: `supabase/migrations/20260814135000_get_inventory_valuation.sql`
- Test: `supabase/tests/41_inventory_valuation.sql`

**Interfaces:**
- Produces: `get_inventory_valuation(p_restaurant_id UUID)` → `TABLE(total_value NUMERIC, item_count BIGINT, low_stock_count BIGINT)`.

- [ ] **Step 1: Failing pgTAP** — `plan(4)`: (1) `total_value = SUM(current_stock * cost_per_unit)` over a 2-product fixture; (2) `low_stock_count` uses `current_stock <= COALESCE(par_level_min, 0)` — a product with `par_level_min NULL` and stock 0 counts, stock 5 does not; (3) empty restaurant returns one row of zeros; (4) tenancy zero-row for a non-member.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Migration**

```sql
CREATE OR REPLACE FUNCTION public.get_inventory_valuation(p_restaurant_id UUID)
RETURNS TABLE(total_value NUMERIC, item_count BIGINT, low_stock_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(p.current_stock * p.cost_per_unit), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE p.current_stock <= COALESCE(p.par_level_min, 0))::BIGINT
  FROM products p
  WHERE p.restaurant_id = p_restaurant_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_valuation(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_inventory_valuation IS
'Inventory value, item count, and low-stock count from products. The low-stock
predicate is current_stock <= COALESCE(par_level_min, 0). SECURITY INVOKER.';
```

- [ ] **Step 4: Apply + run — expected 4/4.**
- [ ] **Step 5: Commit** (`feat(rpc): inventory valuation aggregate`, both files).

---

### Task 8: Bank RPCs — summary, spending by category, daily series (cluster 6)

**Files:**
- Create: `supabase/migrations/20260814136000_get_bank_aggregates.sql` (all three functions, one file)
- Test: `supabase/tests/42_bank_aggregates.sql`

**Interfaces:**
- Produces (Task 12 consumes):
  - `get_bank_transaction_summary(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL, p_statuses TEXT[] DEFAULT NULL)` → `TABLE(inflow NUMERIC, outflow NUMERIC, net NUMERIC, tx_count BIGINT, inflow_count BIGINT, outflow_count BIGINT, avg_inflow NUMERIC, max_inflow NUMERIC)`
  - `get_bank_spending_by_category(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_statuses TEXT[] DEFAULT NULL)` → `TABLE(category_id UUID, category_name TEXT, spend NUMERIC, tx_count BIGINT)`
  - `get_bank_transactions_daily(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL)` → `TABLE(day DATE, inflow NUMERIC, outflow NUMERIC, net NUMERIC)`

- [ ] **Step 1: Failing pgTAP** — `plan(8)`: (1) summary splits inflow/outflow/net over a mixed fixture; (2) `p_statuses => ARRAY['posted']` excludes a `pending` row; `NULL` includes it; (3) `p_bank_account_id` filters on `connected_bank_id` (spec §11.1 item 1 — insert two banks, scope to one); (4) spending-by-category groups two negative rows, positive rows excluded; (5) an uncategorized negative row lands in the `Uncategorized` bucket; (6) daily series has one row per day with the right net; (7) summary returns one all-zero row for an empty range (COALESCE guard); (8) tenancy zero for a non-member.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Migration.** All three follow the same shell. Bodies:

```sql
CREATE OR REPLACE FUNCTION public.get_bank_transaction_summary(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE,
  p_bank_account_id UUID DEFAULT NULL, p_statuses TEXT[] DEFAULT NULL
)
RETURNS TABLE(inflow NUMERIC, outflow NUMERIC, net NUMERIC, tx_count BIGINT,
              inflow_count BIGINT, outflow_count BIGINT, avg_inflow NUMERIC, max_inflow NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
         ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
         COALESCE(SUM(bt.amount), 0)::NUMERIC,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE bt.amount > 0)::BIGINT,
         COUNT(*) FILTER (WHERE bt.amount < 0)::BIGINT,
         COALESCE(AVG(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
         COALESCE(MAX(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC
  FROM bank_transactions bt
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
    AND (p_statuses IS NULL OR bt.status::text = ANY(p_statuses));
$$;

CREATE OR REPLACE FUNCTION public.get_bank_spending_by_category(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_statuses TEXT[] DEFAULT NULL
)
RETURNS TABLE(category_id UUID, category_name TEXT, spend NUMERIC, tx_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT bt.category_id,
         COALESCE(coa.account_name, 'Uncategorized'),
         ABS(COALESCE(SUM(bt.amount), 0))::NUMERIC,
         COUNT(*)::BIGINT
  FROM bank_transactions bt
  LEFT JOIN chart_of_accounts coa ON coa.id = bt.category_id
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND bt.amount < 0
    AND (p_statuses IS NULL OR bt.status::text = ANY(p_statuses))
  GROUP BY bt.category_id, coa.account_name
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_transactions_daily(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_bank_account_id UUID DEFAULT NULL
)
RETURNS TABLE(day DATE, inflow NUMERIC, outflow NUMERIC, net NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT bt.transaction_date,
         COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
         ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
         COALESCE(SUM(bt.amount), 0)::NUMERIC
  FROM bank_transactions bt
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id)
  GROUP BY bt.transaction_date
  ORDER BY bt.transaction_date;
$$;
```

Then the six REVOKE/two GRANT lines per function (same pattern as Task 4) and one `COMMENT ON FUNCTION` each.

- [ ] **Step 4: Apply + run — expected 8/8.**
- [ ] **Step 5: Commit** (`feat(rpc): bank transaction aggregates (summary, category, daily)`, both files).

---

### Task 9: RPC `get_expense_health_metrics` + the bank index

**Files:**
- Create: `supabase/migrations/20260814137000_get_expense_health_metrics.sql`
- Create: `supabase/migrations/20260814138000_idx_bank_transactions_restaurant_date.sql`
- Test: `supabase/tests/43_expense_health_metrics.sql`

**Interfaces:**
- Produces: `get_expense_health_metrics(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE, p_fee_patterns TEXT[], p_bank_account_id UUID DEFAULT NULL)` → `TABLE(revenue NUMERIC, food_cost NUMERIC, labor_cost NUMERIC, processing_fees NUMERIC, total_outflows NUMERIC, uncategorized_spend NUMERIC)`. `p_fee_patterns` receives LOWERCASE `LIKE` patterns (`'%stripe%'`); the TypeScript caller maps its `processingFeePatterns` list to `%pattern%` form.

- [ ] **Step 1: Failing pgTAP** — `plan(7)`: one fixture with a positive row, a food-account outflow, a payroll-account outflow, a fee-matching outflow (`description = 'STRIPE FEE'`, pattern `'%stripe%'`), an uncategorized non-split outflow, and a `void`-status row that must be excluded (`status IN ('posted','pending')` filter). Assert each of the six output columns, plus tenancy zero for a non-member.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Migrations.** Function:

```sql
CREATE OR REPLACE FUNCTION public.get_expense_health_metrics(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE,
  p_fee_patterns TEXT[], p_bank_account_id UUID DEFAULT NULL
)
RETURNS TABLE(revenue NUMERIC, food_cost NUMERIC, labor_cost NUMERIC,
              processing_fees NUMERIC, total_outflows NUMERIC, uncategorized_spend NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount > 0), 0)::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND (coa.account_subtype::text = 'cost_of_goods_sold'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%food%'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%inventory%')), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND (coa.account_subtype::text = 'payroll'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%payroll%'
           OR LOWER(COALESCE(coa.account_name, '')) LIKE '%labor%')), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND LOWER(COALESCE(bt.description, '') || ' ' || COALESCE(bt.merchant_name, ''))
          LIKE ANY(p_fee_patterns)), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0), 0))::NUMERIC,
    ABS(COALESCE(SUM(bt.amount) FILTER (WHERE bt.amount < 0
      AND bt.category_id IS NULL AND COALESCE(bt.is_split, false) = false), 0))::NUMERIC
  FROM bank_transactions bt
  LEFT JOIN chart_of_accounts coa ON coa.id = bt.category_id
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.transaction_date >= p_start_date AND bt.transaction_date <= p_end_date
    AND bt.status::text IN ('posted', 'pending')
    AND (p_bank_account_id IS NULL OR bt.connected_bank_id = p_bank_account_id);
$$;
```

Plus the REVOKE/GRANT/COMMENT block. Before Step 4, check the live keyword rules at `index.ts:2818-2853` and align the `LIKE` terms above with what the TypeScript matches today; adjust the SQL if the code uses different words.

Index migration `20260814138000_...` — **no BEGIN wrapper** (spec §5.11):

```sql
-- CONCURRENTLY cannot run inside a transaction. No BEGIN in this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_restaurant_date
  ON bank_transactions(restaurant_id, transaction_date);
```

- [ ] **Step 4: Apply + run — expected 7/7.**
- [ ] **Step 5: Commit** (`feat(rpc): expense-health aggregate and bank date index`, all three files).

---

### Task 10: Rewire cluster 1 (revenue) + KPIs + monthly_trends

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts` — sites at lines 204-218 (KPIs), 933-940 (income_statement), 1236-1292 (sales_summary ×2), 1673-1679 (generate_report), 2612-2622 (operating_costs revenue), 2683-2695 (monthly_trends)
- Modify: `tests/unit/periodMetrics.test.ts` only if its exports change (prefer no change)

**Interfaces:**
- Consumes: `fetchNetSales` (Task 3), `get_monthly_sales_metrics` (Task 2).

- [ ] **Step 1: Import the helper** at the top of `index.ts`:

```typescript
import { fetchNetSales, sumMonthlyFoodCost } from "../_shared/financialAggregates.ts";
```

- [ ] **Step 2: Replace each revenue fetch.** Pattern for every site — delete the `.from('unified_sales').select('total_price')...` block and its `.reduce()`, insert:

```typescript
const salesTotals = await fetchNetSales(supabase, restaurantId, startDateStr, endDateStr);
const revenue = salesTotals.net;
```

Site-specific notes:
- **income_statement (933-940):** `revenue` feeds `gross_profit` at line 976 unchanged. Use the tool's existing `start_date`/`end_date` args.
- **sales_summary (1236-1292):** both the current and the previous period call `fetchNetSales` with their own ranges. Keep the growth math over the two `net` values.
- **generate_report monthly_pnl (1673-1679):** same replacement.
- **operating_costs (2612-2622):** replace only the fetch; Task 13 rewrites the math that consumes `totalRevenue`. Set `const totalRevenue = salesTotals.net;`.
- **KPIs (204-218):** replace the two raw fetches + `calculateRevenueBreakdown` call with one `fetchNetSales`. Map: `grossRevenue = salesTotals.gross`, `discounts`, `refunds`, `salesTax = salesTotals.salesTax`, `tips = salesTotals.tips`, `netRevenue = salesTotals.net`. Keep `filterSplitSales`/`calculateRevenueBreakdown` exported in `periodMetrics.ts` untouched (other callers and tests exist) — KPIs stops calling them.
- **monthly_trends (2683-2695):** keep the per-month rows (it needs the series). Change the net per month to `gross_revenue - discounts - refunds`.

- [ ] **Step 3: Typecheck** — `npm run typecheck`. Expected: clean.

- [ ] **Step 4: Run the existing unit suites** — `npx vitest run tests/unit/periodMetrics.test.ts tests/unit/tools-registry.test.ts tests/unit/financialAggregates.test.ts`. Expected: PASS with no edits to `periodMetrics.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-execute-tool/index.ts
git commit -m "fix(ai-tools): route every revenue sum through the monthly metrics RPC"
```

---

### Task 11: Rewire clusters 2-5 (sales breakdown, COGS, OpEx, inventory value)

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts` — sites: 1748-1762 (sales_by_category), 1236-1256 (top items), 222 area + 943-951 + 1684-1690 + 2698-2708 (COGS), 954-974 (OpEx), 299-306 + 376-408 + 1018-1021 + 1809-1812 (inventory value)

**Interfaces:**
- Consumes: Tasks 4-7 RPCs, `sumMonthlyFoodCost` (Task 3).

- [ ] **Step 1: sales_by_category (generate_report).** Replace the raw fetch + grouping loop:

```typescript
const { data: categoryRows, error: catErr } = await supabase.rpc('get_sales_by_category', {
  p_restaurant_id: restaurantId, p_start_date: startDateStr, p_end_date: endDateStr,
});
if (catErr) throw new Error(`get_sales_by_category failed: ${catErr.message}`);
```

Map `categoryRows` onto the tool's existing response shape.

- [ ] **Step 2: top items (sales_summary).** Replace the client-side top-N loop with `supabase.rpc('get_top_sold_items', { ..., p_limit: 10 })`.

- [ ] **Step 3: COGS sites.** All four call the RPC; scalar sites sum with the helper:

```typescript
const { data: usageRows, error: usageErr } = await supabase.rpc('get_inventory_usage_by_month', {
  p_restaurant_id: restaurantId, p_start_date: startDateStr, p_end_date: endDateStr,
});
if (usageErr) throw new Error(`get_inventory_usage_by_month failed: ${usageErr.message}`);
const totalCogs = sumMonthlyFoodCost(usageRows);
```

`monthly_trends` (2698-2708) reads the month rows directly instead of a client-side group-by.

- [ ] **Step 4: OpEx site (954-974).** Delete the `chart_of_accounts` id fetch AND the `journal_entry_lines` fetch. Insert:

```typescript
const { data: expenseTotal, error: expErr } = await supabase.rpc('get_journal_expense_total', {
  p_restaurant_id: restaurantId, p_start_date: startDateStr, p_end_date: endDateStr,
});
if (expErr) throw new Error(`get_journal_expense_total failed: ${expErr.message}`);
const totalExpenses = Number(expenseTotal ?? 0);
```

- [ ] **Step 5: Inventory value sites.** All four call `get_inventory_valuation` and read `total_value`, `item_count`, `low_stock_count` from the single returned row.

- [ ] **Step 6: Typecheck + unit suites** — same commands as Task 10 Step 3-4. Expected: clean/PASS.

- [ ] **Step 7: Commit** (`fix(ai-tools): SQL aggregates for sales breakdown, COGS, OpEx, inventory value`).

---

### Task 12: Rewire cluster 6 (bank) + batch id clamp

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts` — bank sites at 503-516, 560-577, 613-633, 698-709, 736-748, 840-884, 1066-1072, 1695-1701, 1781-1787, 2793-2852; batch tools at 3302 and 3390

**Interfaces:**
- Consumes: Task 8 + Task 9 RPCs.

- [ ] **Step 1: Scalar bank sites.** Each site calls `get_bank_transaction_summary` with its current date range and, where the site filters them today, `p_statuses` / `p_bank_account_id`. Read each site's current status filter from the code before the change and pass the same values (spec §11.2 item 1). Replace client sums with the returned `inflow`/`outflow`/`net`.
- [ ] **Step 2: Spending breakdown** (613-633) → `get_bank_spending_by_category`.
- [ ] **Step 3: predictions (736-748) and cash_flow variance (503-516, 1781-1787)** → `get_bank_transactions_daily`; keep the forecast/variance math in TypeScript over the daily rows.
- [ ] **Step 4: expense_health (2793-2852)** → one `get_expense_health_metrics` call. Map `processingFeePatterns` to lowercase `LIKE` form: `` patterns.map(p => `%${p.toLowerCase()}%`) ``. Keep the percentage math in TypeScript.
- [ ] **Step 5: get_bank_transactions (840-884).** Keep the paginated list; its summary totals come from `get_bank_transaction_summary`.
- [ ] **Step 6: Batch clamp.** In both batch tools, before the `.in('id', ids)` fetch:

```typescript
if (ids.length > 1000) {
  return { error: `Too many ids (${ids.length}). Send at most 1000 per call.` };
}
```

- [ ] **Step 7: Typecheck + unit suites; commit** (`fix(ai-tools): SQL aggregates for bank metrics; clamp batch id count`).

---

### Task 13: Fix 2 — operating-costs variable math (spec §13.2)

**Files:**
- Create: `supabase/functions/_shared/operatingCostMath.ts`
- Modify: `supabase/functions/ai-execute-tool/index.ts:2585-2662` (`executeGetOperatingCosts`)
- Test: `tests/unit/operatingCostMath.test.ts`

**Interfaces:**
- Consumes: `NetSalesTotals.net` from Task 10's `salesTotals` in the same function.
- Produces:

```typescript
export interface CostRow { cost_type: string; entry_type: string; monthly_value: number; percentage_value: number | null; }
export interface OperatingCostTotals {
  fixedTotal: number; semiVariableTotal: number;
  variableFlatTotal: number; variablePercentTotal: number; variableTotal: number;
  totalMonthlyCosts: number; variableCostPercentage: number;
  contributionMargin: number; breakEvenRevenue: number;
}
export function computeOperatingCostTotals(rows: CostRow[], netSales: number): OperatingCostTotals;
```

- [ ] **Step 1: Write the failing tests** — `tests/unit/operatingCostMath.test.ts`, keyed to the July diagnosis:

```typescript
import { describe, it, expect } from 'vitest';
import { computeOperatingCostTotals } from '../../supabase/functions/_shared/operatingCostMath';

const rows = [
  { cost_type: 'fixed', entry_type: 'value', monthly_value: 4037415, percentage_value: null },
  { cost_type: 'variable', entry_type: 'value', monthly_value: 8200, percentage_value: null },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 27 },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 3 },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 2.5 },
];

describe('computeOperatingCostTotals', () => {
  it('includes percentage items in the variable total (the July $82 bug)', () => {
    const t = computeOperatingCostTotals(rows, 72090.74);
    expect(t.variableFlatTotal).toBeCloseTo(82.0, 2);
    expect(t.variablePercentTotal).toBeCloseTo(72090.74 * 0.325, 2);
    expect(t.variableTotal).toBeGreaterThan(23000);
  });
  it('computes the variable ratio from percent items plus flat/revenue', () => {
    const t = computeOperatingCostTotals(rows, 72090.74);
    expect(t.variableCostPercentage).toBeCloseTo(32.5 + (82.0 / 72090.74) * 100, 4);
    expect(t.breakEvenRevenue).toBeCloseTo(40374.15 / ((100 - t.variableCostPercentage) / 100), 2);
  });
  it('falls back to 25 percent when the restaurant has no variable rows', () => {
    const t = computeOperatingCostTotals(rows.slice(0, 1), 1000);
    expect(t.variableCostPercentage).toBe(25);
  });
  it('does not divide by zero when netSales is 0', () => {
    const t = computeOperatingCostTotals(rows, 0);
    expect(Number.isFinite(t.breakEvenRevenue)).toBe(true);
    expect(t.variableCostPercentage).toBeCloseTo(32.5, 4);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — module not found.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/_shared/operatingCostMath.ts
// Spec §13.2. monthly_value is cents and is 0 for percentage rows;
// percentage rows carry percentage_value instead.
export function computeOperatingCostTotals(rows: CostRow[], netSales: number): OperatingCostTotals {
  const by = (t: string) => rows.filter((r) => r.cost_type === t);
  const flat = (rs: CostRow[]) => rs.filter((r) => r.entry_type !== 'percentage')
    .reduce((s, r) => s + (r.monthly_value ?? 0) / 100, 0);
  const pct = (rs: CostRow[]) => rs.filter((r) => r.entry_type === 'percentage')
    .reduce((s, r) => s + (r.percentage_value ?? 0), 0);

  const fixedTotal = flat(by('fixed'));
  const semiVariableTotal = flat(by('semi_variable'));
  const variableRows = by('variable');
  const variableFlatTotal = flat(variableRows);
  const variablePctSum = pct(variableRows);
  const variablePercentTotal = (variablePctSum / 100) * netSales;
  const variableTotal = variableFlatTotal + variablePercentTotal;

  let variableCostPercentage: number;
  if (variableRows.length === 0) {
    variableCostPercentage = 25; // keep the historical fallback estimate
  } else {
    variableCostPercentage = variablePctSum + (netSales > 0 ? (variableFlatTotal / netSales) * 100 : 0);
  }
  const contributionMargin = 100 - variableCostPercentage;
  const totalFixedCosts = fixedTotal + semiVariableTotal;
  const breakEvenRevenue = contributionMargin > 0 ? totalFixedCosts / (contributionMargin / 100) : 0;

  return {
    fixedTotal, semiVariableTotal, variableFlatTotal, variablePercentTotal, variableTotal,
    totalMonthlyCosts: fixedTotal + semiVariableTotal + variableTotal,
    variableCostPercentage, contributionMargin, breakEvenRevenue,
  };
}
```

(Include the two exported interfaces from the Interfaces block above.)

- [ ] **Step 4: Run tests — PASS.**

- [ ] **Step 5: Rewire `executeGetOperatingCosts`.** Delete the sums at 2605-2607 and the formulas at 2623-2631. Call `computeOperatingCostTotals(costs, salesTotals.net)` (with `salesTotals` from Task 10 Step 2). Each `entry_type === 'percentage'` item in the response gains `computed_monthly_amount: (item.percentage_value / 100) * salesTotals.net`. Wire the break_even_analysis fields from the returned totals.

- [ ] **Step 6: Typecheck + full unit suite; commit** (`fix(ai-tools): include percentage items in the variable-cost and break-even math`).

---

### Task 14: Fix 3 — budget labels, percent units, prompt guidance (spec §13.3)

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts` (operating-costs response ~2633-2662; break-even progress ~3156-3166)
- Modify: `supabase/functions/_shared/tools-registry.ts:506-534`
- Modify: `supabase/functions/ai-chat-stream/index.ts` (system prompt, inside 523-661)
- Test: `tests/unit/tools-registry.test.ts` (extend)

- [ ] **Step 1: Response labels.** In the `executeGetOperatingCosts` return object add:

```typescript
source: 'budget_config',
note: 'These costs are the configured budget, not period actuals. The period parameter scopes only the revenue used for the break-even.',
```

Rename `margin_of_safety` → `margin_of_safety_percent` in BOTH tools and add to the operating-costs break_even_analysis:

```typescript
margin_of_safety_amount: salesTotals.net - totals.breakEvenRevenue,
```

- [ ] **Step 2: Registry description.** Rewrite the `get_operating_costs` description (tools-registry.ts:506-534) to open with: `'Get the CONFIGURED cost budget (not actual period spend). Fixed, semi-variable, and variable items with a break-even analysis against actual net sales for the period. All *_percent fields are percentages.'`

- [ ] **Step 3: Prompt block.** In the `ai-chat-stream` system prompt, after the financial-tools guidance that ends near line 633, add:

```text
FINANCIAL DATA RULES:
- get_operating_costs returns the CONFIGURED BUDGET, not actual spend. For actual spend, use get_financial_statement or get_bank_transactions.
- All tools share one net-sales definition (gross - discounts - refunds). If two results disagree, say that the data sources disagree and stop. Do not invent a reconciliation.
- Fields that end in _percent are percentages. Never show them with a $ sign.
- Percentage-based cost items include computed_monthly_amount. Use it. Do not compute your own.
```

- [ ] **Step 4: Extend `tests/unit/tools-registry.test.ts`** with one test: the `get_operating_costs` description contains the string `CONFIGURED cost budget`.

- [ ] **Step 5: Typecheck + unit suites; commit** (`fix(ai-tools): label budget data and percent units; add prompt rules`).

---

### Task 15: Full verification, production validation, PR

**Files:** none new (PR body).

- [ ] **Step 1: Full local gates**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run db:reset && npm run test:db`
Expected: all green. Fix any failure before Step 2.

- [ ] **Step 2: Production validation (read-only).** For restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`, July 2026, run read-only SELECTs that mirror each new RPC body via `mcp__supabase-prod__execute_sql`. Record in the PR body:
  - Net sales: expected ≈ `$72,090.74` minus July refunds.
  - COGS: expected ≈ `$2,680.51`.
  - The before numbers from the bot convo (`$3,647.22`, `$197.50`, `$5,693.62`, `$82.00`).

- [ ] **Step 3: Push and open the PR** on `fix/ai-financial-tools-row-cap` → `main`. PR body sections: Problem (one paragraph + the July table), Fix (three defect classes), Behavioral changes (spec §7 + §13), Test evidence, Production before/after. End with:

`🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- [ ] **Step 4: CI + review loop.** Watch `gh pr checks --watch`. Answer every CodeRabbit finding with `node dev-tools/pr-triage.js reply ... --verdict ... --commit <sha> --rationale "..."` (never a raw `gh api` reply). Run `node dev-tools/pr-triage.js audit --pr <N>` before the final push.

---

## Self-Review Notes

- Spec coverage: §5.1-§5.11 → Tasks 2, 4-9; §6 rewiring → Tasks 10-12; §13.2 → Task 13; §13.3 → Task 14; §9.3 → Task 15. §5.1 Change A ships already (PR #743) — no task, by design.
- The `37_` tenancy suite guards the Task 2 DROP/CREATE regression risk.
- Type consistency: `fetchNetSales`/`sumMonthlyMetrics`/`sumMonthlyFoodCost` (Task 3) match their uses in Tasks 10-13; `computeOperatingCostTotals` (Task 13) matches its use in Task 13 Step 5 and Task 14 Step 1.
- Known judgment points for the executor: exact response-shape mapping per site (read the surrounding code first), the expense-health keyword terms (Task 9 Step 3 note), and per-site bank status values (Task 12 Step 1).
