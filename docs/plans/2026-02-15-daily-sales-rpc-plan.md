# `get_daily_sales_totals` RPC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace client-side sales aggregation in `useBreakEvenAnalysis` with a server-side RPC to fix the Supabase 1000-row limit truncation bug.

**Architecture:** New PostgreSQL function `get_daily_sales_totals` aggregates `unified_sales` by date server-side. The existing `fetchDailySales` function switches from `.from('unified_sales').select()` to `.rpc('get_daily_sales_totals')`. TypeScript types are manually added to match the RPC signature.

**Tech Stack:** PostgreSQL (Supabase migration), React Query, TypeScript

**Design doc:** `docs/plans/2026-02-15-daily-sales-rpc-design.md`

---

### Task 1: Set up worktree and branch

**Step 1: Create worktree from main**

```bash
git worktree add ../nimble-pnl-daily-sales-rpc fix/daily-sales-rpc 2>/dev/null || \
  (git branch fix/daily-sales-rpc main && git worktree add ../nimble-pnl-daily-sales-rpc fix/daily-sales-rpc)
```

**Step 2: Verify worktree**

Run: `cd ../nimble-pnl-daily-sales-rpc && git branch --show-current`
Expected: `fix/daily-sales-rpc`

---

### Task 2: Create the SQL migration

**Files:**
- Create: `supabase/migrations/20260215100000_add_get_daily_sales_totals.sql`

**Step 1: Write the migration**

```sql
-- Server-side daily sales aggregation for break-even analysis.
-- Replaces client-side query that hit Supabase's 1000-row default limit.

CREATE OR REPLACE FUNCTION public.get_daily_sales_totals(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  sale_date DATE,
  total_revenue DECIMAL,
  transaction_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    us.sale_date,
    COALESCE(SUM(us.total_price), 0) AS total_revenue,
    COUNT(*) AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL
    AND us.item_type = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
    )
  GROUP BY us.sale_date
  ORDER BY us.sale_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_sales_totals(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_daily_sales_totals IS
'Aggregates daily sales totals from unified_sales for break-even analysis.
Returns one row per date with total revenue and transaction count.
Excludes adjustments (tax/tips/discounts), non-sale items, and parent sales with splits.';
```

**Step 2: Apply the migration**

Use the Supabase MCP tool `apply_migration` with name `add_get_daily_sales_totals` and the SQL above.

**Step 3: Verify the function exists**

Run SQL: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'get_daily_sales_totals';`
Expected: One row returned.

**Step 4: Test the function with real data**

Run SQL:
```sql
SELECT * FROM get_daily_sales_totals(
  (SELECT id FROM restaurants LIMIT 1),
  CURRENT_DATE - INTERVAL '14 days',
  CURRENT_DATE
);
```
Expected: Up to 14 rows with `sale_date`, `total_revenue`, `transaction_count` columns. Verify totals look reasonable (non-zero for days with sales).

**Step 5: Commit**

```bash
git add supabase/migrations/20260215100000_add_get_daily_sales_totals.sql
git commit -m "feat: add get_daily_sales_totals RPC for break-even analysis

Server-side aggregation replaces client-side query that hit
Supabase's 1000-row default limit on unified_sales."
```

---

### Task 3: Add TypeScript types for the new RPC

**Files:**
- Modify: `src/integrations/supabase/types.ts` (in the `Functions` section, alphabetically between `get_pass_through_totals` and `get_pos_tips_by_date`)

**Step 1: Add the RPC type definition**

Find this block (around line 8223):
```typescript
      }
      get_pos_tips_by_date: {
```

Insert before it:
```typescript
      get_daily_sales_totals: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_restaurant_id: string
        }
        Returns: {
          sale_date: string
          total_revenue: number
          transaction_count: number
        }[]
      }
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "get_daily_sales_totals"` (should return nothing — no errors related to our type)

**Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat: add TypeScript types for get_daily_sales_totals RPC"
```

---

### Task 4: Update `fetchDailySales` to use the RPC

**Files:**
- Modify: `src/hooks/useBreakEvenAnalysis.tsx` (lines 8-11 and 16-50)

**Step 1: Update the `DailySalesData` interface (line 8-11)**

Replace:
```typescript
interface DailySalesData {
  date: string;
  netRevenue: number;
}
```

With:
```typescript
interface DailySalesData {
  date: string;
  netRevenue: number;
  transactionCount: number;
}
```

**Step 2: Replace the `fetchDailySales` function (lines 16-50)**

Replace the entire function with:
```typescript
async function fetchDailySales(
  restaurantId: string,
  startDate: Date,
  endDate: Date
): Promise<DailySalesData[]> {
  const { data, error } = await supabase.rpc('get_daily_sales_totals', {
    p_restaurant_id: restaurantId,
    p_date_from: format(startDate, 'yyyy-MM-dd'),
    p_date_to: format(endDate, 'yyyy-MM-dd'),
  });

  if (error) throw error;

  // Build lookup from RPC results
  const byDate: Record<string, { revenue: number; count: number }> = {};
  for (const row of data || []) {
    byDate[row.sale_date] = {
      revenue: Number(row.total_revenue) || 0,
      count: Number(row.transaction_count) || 0,
    };
  }

  // Fill in missing dates with 0
  const result: DailySalesData[] = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = format(current, 'yyyy-MM-dd');
    const entry = byDate[dateStr];
    result.push({
      date: dateStr,
      netRevenue: entry?.revenue || 0,
      transactionCount: entry?.count || 0,
    });
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  return result;
}
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/hooks/useBreakEvenAnalysis.tsx
git commit -m "fix: use server-side RPC for daily sales to avoid 1000-row limit

fetchDailySales now calls get_daily_sales_totals RPC instead of
querying individual unified_sales rows client-side. Also adds
transactionCount to DailySalesData for future chart use."
```

---

### Task 5: Verify fix with production data

**Step 1: Query the RPC for the problematic date range**

Run SQL:
```sql
SELECT * FROM get_daily_sales_totals(
  (SELECT id FROM restaurants LIMIT 1),
  '2026-02-03'::DATE,
  '2026-02-16'::DATE
);
```

Expected: All dates from Feb 3-16 should appear (14 rows). Feb 13 and Feb 14 should show non-zero revenue (these were the truncated dates).

**Step 2: Compare against raw totals to verify accuracy**

Run SQL:
```sql
SELECT
  sale_date,
  SUM(total_price) AS total_revenue,
  COUNT(*) AS transaction_count
FROM unified_sales
WHERE restaurant_id = (SELECT id FROM restaurants LIMIT 1)
  AND sale_date >= '2026-02-03'
  AND sale_date <= '2026-02-16'
  AND adjustment_type IS NULL
  AND item_type = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM unified_sales child
    WHERE child.parent_sale_id = unified_sales.id
  )
GROUP BY sale_date
ORDER BY sale_date;
```

Expected: Results should match the RPC output exactly.

---

### Task 6: Run security advisors

**Step 1: Check for security issues**

Use the Supabase MCP `get_advisors` tool with type `security`.

Expected: No new warnings related to `get_daily_sales_totals`. The function uses `SECURITY INVOKER` so RLS policies apply automatically.

**Step 2: Check for performance issues**

Use the Supabase MCP `get_advisors` tool with type `performance`.

Expected: No new warnings.
