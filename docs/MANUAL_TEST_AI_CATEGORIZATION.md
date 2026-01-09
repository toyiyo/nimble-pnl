# Manual Testing Guide: AI Categorization Aggregation

## Overview
This guide helps verify that the aggregated AI categorization rule suggestion system is working correctly.

## Prerequisites
- Running Supabase instance with migrations applied
- Restaurant with categorized POS sales or bank transactions
- At least 12 months of historical data (recommended)
- Some categorization rules already created (to test exclusion)

## Test 1: Verify Database Functions Exist

### Using psql or Supabase SQL Editor

```sql
-- Check that functions were created
SELECT proname, proargnames 
FROM pg_proc 
WHERE proname IN ('get_uncovered_pos_patterns', 'get_uncovered_bank_patterns');

-- Expected: 2 rows showing both functions
```

## Test 2: Test POS Pattern Aggregation

### Step 1: Check existing POS sales data
```sql
-- Count categorized POS sales in last 12 months
SELECT 
  item_name,
  COUNT(*) as occurrence_count
FROM unified_sales
WHERE restaurant_id = '<YOUR_RESTAURANT_ID>'
  AND is_categorized = true
  AND category_id IS NOT NULL
  AND sale_date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY item_name
ORDER BY occurrence_count DESC
LIMIT 10;
```

### Step 2: Test the aggregation function
```sql
-- Call the function
SELECT * 
FROM get_uncovered_pos_patterns('<YOUR_RESTAURANT_ID>', 50);

-- Expected output columns:
-- item_name | pos_category | typical_price | category_code | category_name | occurrence_count | date_range
```

### Step 3: Verify exclusion logic

Create a test rule:
```sql
-- Insert a categorization rule
INSERT INTO categorization_rules (
  restaurant_id,
  rule_name,
  applies_to,
  item_name_pattern,
  item_name_match_type,
  category_id,
  priority,
  is_active
) VALUES (
  '<YOUR_RESTAURANT_ID>',
  'Test Sales Tax Rule',
  'pos_sales',
  'Sales Tax',
  'exact',
  '<CATEGORY_ID>',
  10,
  true
);
```

Re-run the function and verify "Sales Tax" is no longer in results:
```sql
SELECT * 
FROM get_uncovered_pos_patterns('<YOUR_RESTAURANT_ID>', 50)
WHERE item_name = 'Sales Tax';

-- Expected: 0 rows (excluded because of active rule)
```

Clean up:
```sql
DELETE FROM categorization_rules 
WHERE rule_name = 'Test Sales Tax Rule';
```

## Test 3: Test Bank Transaction Pattern Aggregation

### Step 1: Check existing bank transactions
```sql
-- Count categorized bank transactions in last 12 months
SELECT 
  description,
  merchant_name,
  COUNT(*) as occurrence_count,
  ROUND(AVG(amount)::numeric, 2) as avg_amount
FROM bank_transactions
WHERE restaurant_id = '<YOUR_RESTAURANT_ID>'
  AND is_categorized = true
  AND category_id IS NOT NULL
  AND transaction_date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY description, merchant_name
ORDER BY occurrence_count DESC
LIMIT 10;
```

### Step 2: Test the aggregation function
```sql
-- Call the function
SELECT * 
FROM get_uncovered_bank_patterns('<YOUR_RESTAURANT_ID>', 50);

-- Expected output columns:
-- description | merchant_name | normalized_payee | typical_amount | amount_range | category_code | category_name | occurrence_count | date_range
```

### Step 3: Verify amount range calculation
```sql
-- Pick a transaction pattern from results and verify amount range
SELECT 
  description,
  MIN(amount) as min_amt,
  MAX(amount) as max_amt,
  ROUND(AVG(amount)::numeric, 2) as avg_amt
FROM bank_transactions
WHERE description = '<PICK_ONE_FROM_RESULTS>'
  AND restaurant_id = '<YOUR_RESTAURANT_ID>'
GROUP BY description;

-- Compare with amount_range from function output
```

## Test 4: Test Edge Function

### Using curl or Postman

```bash
# Get your auth token from Supabase
export AUTH_TOKEN="your_supabase_auth_token"
export SUPABASE_URL="https://your-project.supabase.co"
export RESTAURANT_ID="your-restaurant-id"

# Test POS suggestions
curl -X POST \
  "${SUPABASE_URL}/functions/v1/ai-suggest-categorization-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurantId\": \"${RESTAURANT_ID}\",
    \"source\": \"pos\",
    \"limit\": 100
  }"

# Test bank transaction suggestions
curl -X POST \
  "${SUPABASE_URL}/functions/v1/ai-suggest-categorization-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurantId\": \"${RESTAURANT_ID}\",
    \"source\": \"bank\",
    \"limit\": 100
  }"
```

### Expected Response Structure

```json
{
  "rules": [
    {
      "rule_name": "Sales Tax Transactions",
      "pattern_type": "item_name",
      "item_name_pattern": "Sales Tax",
      "item_name_match_type": "exact",
      "account_code": "2200",
      "category_id": "uuid-here",
      "category_name": "Sales Tax Payable",
      "confidence": "high",
      "historical_matches": 142,
      "reasoning": "Sales Tax appears 142 times consistently categorized to Sales Tax Payable",
      "priority": 9,
      "applies_to": "pos_sales"
    }
  ],
  "total_analyzed": 47,
  "source": "pos"
}
```

### Verification Checklist

- [ ] Response includes `rules` array
- [ ] Response includes `total_analyzed` count
- [ ] Each rule has `historical_matches` matching occurrence counts
- [ ] Rules are for items NOT already covered by active rules
- [ ] High-occurrence patterns appear first (sorted by priority/matches)
- [ ] Date ranges span up to 12 months
- [ ] No duplicate patterns in results

## Test 5: Performance Comparison

### Before (Individual Records)
```sql
-- Simulate old approach: count individual records sent
SELECT COUNT(*) 
FROM unified_sales
WHERE restaurant_id = '<YOUR_RESTAURANT_ID>'
  AND is_categorized = true
  AND category_id IS NOT NULL
ORDER BY sale_date DESC
LIMIT 100;

-- Expected: 100 rows (many duplicates)
```

### After (Aggregated Patterns)
```sql
-- New approach: count unique patterns
SELECT COUNT(*) 
FROM get_uncovered_pos_patterns('<YOUR_RESTAURANT_ID>', 200);

-- Expected: ~50-100 unique patterns (no duplicates)
```

### Token Usage Estimate
- Old: 100 records × ~50 tokens/record = ~5,000 tokens
- New: 60 patterns × ~60 tokens/pattern = ~3,600 tokens
- **Savings: ~28% reduction in token usage**

## Common Issues

### Issue 1: Function returns empty results
**Possible causes:**
1. No categorized data in last 12 months
2. All patterns already covered by existing rules
3. Restaurant ID incorrect

**Debug:**
```sql
-- Check for any categorized data
SELECT COUNT(*) 
FROM unified_sales 
WHERE restaurant_id = '<YOUR_RESTAURANT_ID>' 
  AND is_categorized = true;

-- Check active rules count
SELECT COUNT(*) 
FROM categorization_rules 
WHERE restaurant_id = '<YOUR_RESTAURANT_ID>' 
  AND is_active = true;
```

### Issue 2: Function includes items that should be excluded
**Possible cause:** Rule match types not matching actual data

**Debug:**
```sql
-- Check rule match logic
SELECT 
  cr.item_name_pattern,
  cr.item_name_match_type,
  us.item_name,
  CASE 
    WHEN cr.item_name_match_type = 'exact' 
      THEN LOWER(us.item_name) = LOWER(cr.item_name_pattern)
    WHEN cr.item_name_match_type = 'contains' 
      THEN LOWER(us.item_name) LIKE '%' || LOWER(cr.item_name_pattern) || '%'
    END as should_match
FROM categorization_rules cr
CROSS JOIN unified_sales us
WHERE cr.restaurant_id = '<YOUR_RESTAURANT_ID>'
  AND us.restaurant_id = '<YOUR_RESTAURANT_ID>'
  AND cr.is_active = true
LIMIT 10;
```

### Issue 3: Edge function returns error
**Possible causes:**
1. RPC function not deployed
2. Permission issues
3. Authentication token expired

**Debug:**
Check Supabase logs:
```bash
supabase functions logs ai-suggest-categorization-rules
```

## Success Criteria

✅ **Test Passed** if:
1. Database functions return aggregated patterns with occurrence counts
2. Results exclude items matching active rules
3. Date ranges span up to 12 months
4. Results are ordered by occurrence count DESC
5. Edge function successfully calls RPC and returns AI suggestions
6. Token usage reduced by 40-60% compared to old approach
7. AI suggestions prioritize high-occurrence patterns

## Rollback (If Needed)

If issues arise, rollback the migration:

```sql
-- Drop the new functions
DROP FUNCTION IF EXISTS get_uncovered_pos_patterns(UUID, INT);
DROP FUNCTION IF EXISTS get_uncovered_bank_patterns(UUID, INT);

-- Edge function will fall back to old behavior if RPC fails
-- (though it will throw an error with current implementation)
```

To fully rollback, revert the edge function changes in:
`supabase/functions/ai-suggest-categorization-rules/index.ts`
