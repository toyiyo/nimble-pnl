# Design: `get_daily_sales_totals` RPC

**Date**: 2026-02-15
**Problem**: `fetchDailySales` in `useBreakEvenAnalysis.tsx` hits Supabase's 1000-row default limit. A 14-day window can have ~2000 rows in `unified_sales`, causing later dates to be truncated from the break-even chart.

## Approach

Create a new PostgreSQL RPC function that aggregates sales server-side, following the established pattern used by `get_revenue_by_account`, `get_pass_through_totals`, `get_monthly_sales_metrics`, and `get_pos_tips_by_date`.

## SQL Function

```sql
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

GRANT EXECUTE ON FUNCTION public.get_daily_sales_totals TO authenticated;
```

### Filters (matching existing RPC conventions)

- `adjustment_type IS NULL` — excludes pass-throughs (tax, tips, discounts)
- `item_type = 'sale'` — only actual sales
- `NOT EXISTS (parent_sale_id)` — excludes parent sales with split children (avoids double-counting)
- `SECURITY INVOKER` — uses caller's RLS context

## Hook Changes

### `DailySalesData` interface

Add `transactionCount` field:

```typescript
interface DailySalesData {
  date: string;
  netRevenue: number;
  transactionCount: number;
}
```

### `fetchDailySales` function

Replace client-side query + aggregation with RPC call:

```typescript
const { data, error } = await supabase.rpc('get_daily_sales_totals', {
  p_restaurant_id: restaurantId,
  p_date_from: format(startDate, 'yyyy-MM-dd'),
  p_date_to: format(endDate, 'yyyy-MM-dd'),
});
```

Date-filling logic remains (for days with zero sales).

## Scope

- **Changes**: 1 migration, `fetchDailySales` in `useBreakEvenAnalysis.tsx`, `DailySalesData` interface
- **No changes**: `useBreakEvenAnalysis` hook signature, `BreakEvenData` return type, `SalesVsBreakEvenChart` component
- **Types**: Regenerate via `npx supabase gen types` after migration
