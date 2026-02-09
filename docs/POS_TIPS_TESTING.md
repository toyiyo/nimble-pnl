# Test Scenario: POS Tips Integration

## Overview
This document provides step-by-step instructions to manually test the POS tips integration with tip pooling.

## Prerequisites
- Local Supabase instance running
- Restaurant with POS integration (Square, Toast, Clover, or Shift4)
- At least one POS sale imported with tip amounts
- Access to categorization UI
- At least one active employee

## Test Scenario 1: Basic POS Tip Display

### Setup
1. Start local environment:
   ```bash
   npm run db:start
   npm run dev
   ```

2. Navigate to the restaurant dashboard
3. Ensure you have POS data imported (check Sales > Unified Sales)

### Test Steps

#### Step 1: Categorize a POS Sale as Tips
1. Go to Categorization page
2. Find a POS transaction (e.g., from Square, Toast)
3. Create or select a category with "tip" in the name:
   - Example: "Tips Revenue"
   - Or: "Tip Income"
4. Assign the transaction to this category
5. Save the categorization

**Expected Result:**
- Transaction is saved in `unified_sales_splits` table
- Category has "tip" in `account_name` field

#### Step 2: Verify Data in Database
Run these SQL queries:

```sql
-- Check if POS sale exists
SELECT id, sale_date, item_name, total_price, pos_system
FROM unified_sales
WHERE restaurant_id = 'YOUR_RESTAURANT_ID'
AND sale_date >= CURRENT_DATE - INTERVAL '7 days'
LIMIT 10;

-- Check if categorized as tip
SELECT 
  us.sale_date,
  us.item_name,
  coa.account_name,
  uss.amount
FROM unified_sales us
INNER JOIN unified_sales_splits uss ON us.id = uss.sale_id
INNER JOIN chart_of_accounts coa ON uss.category_id = coa.id
WHERE us.restaurant_id = 'YOUR_RESTAURANT_ID'
AND LOWER(coa.account_name) LIKE '%tip%';

-- Test the aggregation function
SELECT * FROM get_pos_tips_by_date(
  'YOUR_RESTAURANT_ID',
  CURRENT_DATE - INTERVAL '7 days',
  CURRENT_DATE
);
```

**Expected Results:**
- First query shows POS sales exist
- Second query shows at least one sale categorized with tip category
- Third query returns aggregated tip data by date

#### Step 3: Configure Tip Pooling to Use POS
1. Navigate to `/tips` page
2. Click Settings (gear icon)
3. Set "Tip source" to "POS import"
4. Save settings

**Expected Result:**
- Settings saved successfully
- `tip_pool_settings.tip_source = 'pos'`

#### Step 4: View Tips in Daily Entry
1. Stay on `/tips` page
2. Click "Daily Entry" tab
3. Select the date where you categorized tips

**Expected Result:**
- POSTipImporter component is displayed
- Shows total tip amount from categorized POS sales
- Shows transaction count
- Shows POS source badge (SQUARE, TOAST, etc.)
- "Use this amount" button is present

#### Step 5: Use POS Tips for Pooling
1. Click "Use this amount" button
2. Verify amount matches categorized tips
3. Proceed through tip split workflow
4. Approve the split

**Expected Result:**
- Tip amount pre-filled from POS data
- Can distribute to employees
- Split saves successfully

## Test Scenario 2: Mixed Tips (Employee + POS)

### Setup
Same as Scenario 1, plus:
- Have an employee manually declare tips via employee_tips table

### Test Steps

#### Step 1: Add Employee-Declared Tips
Insert test data:
```sql
INSERT INTO employee_tips (
  restaurant_id,
  employee_id,
  tip_amount,
  tip_source,
  recorded_at,
  tip_date
) VALUES (
  'YOUR_RESTAURANT_ID',
  'YOUR_EMPLOYEE_ID',
  5000, -- $50.00
  'cash',
  CURRENT_TIMESTAMP,
  CURRENT_DATE
);
```

#### Step 2: Verify Combined Display
1. Navigate to `/tips` page
2. Click "Daily Entry"
3. Select current date

**Expected Result:**
- Total tips = POS tips + Employee tips
- Transaction count = POS count + 1
- Both sources combined in display

## Test Scenario 3: No POS Tips

### Setup
- Have no POS sales categorized as tips for today

### Test Steps

#### Step 1: View Tips Page
1. Navigate to `/tips`
2. Select "Daily Entry"
3. Choose today's date

**Expected Result:**
- POSTipImporter NOT shown
- Alert message: "No POS tips found for today. You can enter them manually or wait for POS sync."
- Manual entry form is displayed

## Test Scenario 4: Multiple POS Systems

### Setup
- Restaurant uses both Square and Toast
- Have tips categorized from both systems on same date

### Test Steps

#### Step 1: Categorize Tips from Both Systems
1. Find Square transaction, categorize as tip
2. Find Toast transaction, categorize as tip
3. Both on the same date

#### Step 2: Verify Aggregation
```sql
SELECT * FROM get_pos_tips_by_date(
  'YOUR_RESTAURANT_ID',
  CURRENT_DATE,
  CURRENT_DATE
);
```

**Expected Result:**
- Function returns ONE row per POS system per date
- OR combines both systems (depending on grouping)
- Total amount is sum of both

## Test Scenario 5: Error Handling

### Test Error: Invalid Category
1. Categorize sale with NON-tip category
2. Check tips page

**Expected Result:**
- Sale does not appear in tips
- No errors displayed

### Test Error: Database Connection
1. Stop Supabase
2. Navigate to tips page

**Expected Result:**
- Error logged to console
- Graceful fallback (empty tips array)
- UI still functional

## Verification Checklist

After completing tests, verify:

- [ ] POS tips appear when categorized correctly
- [ ] Employee tips and POS tips merge correctly
- [ ] Transaction counts are accurate
- [ ] Source badges display correct POS system
- [ ] Amount conversions are correct (cents)
- [ ] No duplicate tips
- [ ] Settings persist correctly
- [ ] No TypeScript errors in console
- [ ] No React errors in console
- [ ] Performance is acceptable (< 2 sec load)

## Common Issues and Solutions

### Issue: Tips show $0
**Solution:**
- Check category name contains "tip"
- Verify `unified_sales_splits` has entries
- Run SQL aggregation function manually

### Issue: "No POS tips found"
**Solution:**
- Confirm POS data is imported
- Check date matches categorized sales
- Verify RLS policies allow access

### Issue: Duplicate tips
**Solution:**
- Check if same sale categorized multiple times
- Verify employee tips aren't duplicating POS tips
- Review aggregation logic

### Issue: Wrong amounts
**Solution:**
- Check cents conversion (multiply by 100)
- Verify SUM in SQL function
- Check for rounding errors

## Success Criteria

The integration is successful if:

1. ✅ Categorized POS sales appear as tips
2. ✅ Tips display in POSTipImporter component
3. ✅ Amounts are accurate
4. ✅ Can complete tip pooling workflow
5. ✅ No errors in console
6. ✅ Performance is good

## Rollback Plan

If issues occur:

1. Remove migration:
   ```sql
   DROP FUNCTION IF EXISTS get_pos_tips_by_date;
   ```

2. Revert hook changes:
   ```bash
   git revert HEAD~1
   ```

3. Restaurant can still use manual tip entry

## Support

For issues during testing:
- Check console for errors
- Review SQL query results
- Check Supabase logs
- Refer to `docs/POS_TIPS_INTEGRATION.md`
