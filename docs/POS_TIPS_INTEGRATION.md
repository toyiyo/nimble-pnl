# POS Tips Integration with Tip Pooling

## Overview

This feature enables tip pooling to work with tips imported from POS systems (Square, Toast, Clover, Shift4). Previously, only employee-declared tips were visible in the tip pooling interface. Now, categorized POS sales are automatically included.

## How It Works

### 1. POS Sales Import
- POS sales are imported into the `unified_sales` table
- Each sale can be categorized using the categorization UI
- Sales categorized as tips are stored in `unified_sales_splits` with a tip category

### 2. Tip Categorization
To categorize a sale as a tip:
1. Go to the Categorization page
2. Select POS transactions
3. Assign them to a category with "tip" in the account name (e.g., "Tips Revenue", "Tip Income")
4. The category's account_subtype can also contain "tip"

### 3. Tip Pooling Display
When viewing the Tips page (`/tips`):
- The system now queries BOTH:
  - Employee-declared tips (from `employee_tips` table)
  - Categorized POS tips (from `unified_sales_splits`)
- Tips are aggregated by date
- Transaction counts and amounts are combined
- Source information is preserved (e.g., "square", "toast")

## Database Function

### `get_pos_tips_by_date`

Aggregates categorized tips from POS sales.

**Parameters:**
- `p_restaurant_id` (UUID): Restaurant to query
- `p_start_date` (DATE): Start of date range
- `p_end_date` (DATE): End of date range

**Returns:**
- `tip_date` (DATE): Date of tips
- `total_amount_cents` (INTEGER): Total tips in cents
- `transaction_count` (INTEGER): Number of transactions
- `pos_source` (TEXT): POS system (square, toast, etc.)

**Filter Logic:**
```sql
WHERE (
  LOWER(account_name) LIKE '%tip%'
  OR LOWER(account_subtype::TEXT) LIKE '%tip%'
)
```

## Code Changes

### SQL Migration
File: `supabase/migrations/20260209192825_add_aggregate_pos_tips_function.sql`

Creates the `get_pos_tips_by_date` function for aggregating tips.

### Hook Update
File: `src/hooks/usePOSTips.tsx`

The `usePOSTips` hook now:
1. Fetches employee tips from `employee_tips`
2. Fetches POS tips via `get_pos_tips_by_date` RPC
3. Merges both sources by date
4. Returns combined data

### Tests
File: `tests/unit/posTipsAggregation.test.ts`

Validates:
- SQL function behavior
- Merge logic
- Edge cases (null values, zero amounts, multiple POS systems)
- Date handling

## Usage Example

### In React Components

```typescript
import { usePOSTipsForDate } from '@/hooks/usePOSTips';

function TipsPage() {
  const restaurantId = 'xxx-xxx-xxx';
  const today = '2024-01-15';
  
  const { tipData, hasTips } = usePOSTipsForDate(restaurantId, today);
  
  if (hasTips) {
    console.log('Total tips:', tipData.totalTipsCents); // Amount in cents
    console.log('Transactions:', tipData.transactionCount);
    console.log('Source:', tipData.source); // 'square', 'toast', etc.
  }
}
```

### Direct SQL Query

```sql
-- Get POS tips for January 2024
SELECT * FROM get_pos_tips_by_date(
  'your-restaurant-id',
  '2024-01-01',
  '2024-01-31'
);
```

## Troubleshooting

### Tips Not Showing Up?

**Check these:**

1. **Are POS sales imported?**
   ```sql
   SELECT COUNT(*) FROM unified_sales 
   WHERE restaurant_id = 'your-id' 
   AND sale_date >= '2024-01-01';
   ```

2. **Are they categorized as tips?**
   ```sql
   SELECT us.sale_date, us.item_name, coa.account_name
   FROM unified_sales us
   INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
   INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
   WHERE us.restaurant_id = 'your-id'
   AND LOWER(coa.account_name) LIKE '%tip%';
   ```

3. **Is the RPC function working?**
   ```sql
   SELECT * FROM get_pos_tips_by_date(
     'your-restaurant-id',
     CURRENT_DATE - INTERVAL '7 days',
     CURRENT_DATE
   );
   ```

### Common Issues

**Issue:** Tips show $0 even though POS has tips
- **Solution:** Make sure the category name or subtype contains "tip"
- Check: `SELECT account_name, account_subtype FROM chart_of_accounts WHERE restaurant_id = 'your-id'`

**Issue:** RPC function returns empty array
- **Solution:** Verify that `unified_sales_splits` entries exist for tip categories
- Check: `SELECT COUNT(*) FROM unified_sales_splits WHERE category_id IN (SELECT id FROM chart_of_accounts WHERE account_name LIKE '%tip%')`

**Issue:** Employee tips and POS tips are double-counted
- **Solution:** The system merges by date - this is expected behavior
- If you want separate tracking, check the `source` field in the returned data

## Performance Considerations

- The SQL function uses indexes on `unified_sales.restaurant_id` and `unified_sales.sale_date`
- Query is optimized for date ranges (typically weekly or monthly)
- Results are cached for 60 seconds (`staleTime: 60000`)

## Future Enhancements

Potential improvements (not currently implemented):

1. **Auto-Sync to employee_tips**: 
   - Nightly cron job to sync POS tips into `employee_tips` table
   - Would avoid need for RPC call on every page load
   
2. **Category Configuration**:
   - UI to configure which categories are "tip categories"
   - Instead of relying on name matching

3. **Employee Attribution**:
   - Match POS tips to specific employees (if POS supports it)
   - Currently returns aggregate daily totals

## Testing

Run the unit tests:
```bash
npm run test -- posTipsAggregation.test.ts
```

Test with real data:
1. Import POS data for your restaurant
2. Categorize some sales as tips
3. Visit `/tips` page
4. Verify tips appear in the daily view
5. Check that amounts and transaction counts are correct
