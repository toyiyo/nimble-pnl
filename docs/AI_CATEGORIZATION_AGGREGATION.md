# AI Categorization Rule Suggestion - Aggregation Pattern

## Overview

The AI categorization rule suggestion system now uses **aggregated patterns** instead of individual records to improve efficiency and effectiveness.

## Problem Solved

**Previous Approach:**
- Sent 100 individual transactions/sales to AI
- Result: Many duplicates (e.g., "Sales Tax" appearing 142+ times at $0.60)
- No exclusion of items already covered by existing rules
- Limited to recent data only
- High token usage
- No frequency/impact context

**New Approach:**
- Aggregates similar patterns with occurrence counts
- Excludes items already covered by active rules
- Analyzes 12 months of data
- Orders by occurrence count (highest impact first)
- Reduced token usage (~50-100 unique patterns vs 100 individual records)

## Database Functions

### `get_uncovered_pos_patterns(restaurant_id, limit)`

Returns aggregated POS sales patterns not covered by existing rules.

**Aggregation Keys:**
- `item_name`
- `pos_category`
- `typical_price` (rounded to 2 decimals)
- `category_code` and `category_name`

**Returns:**
- `item_name`: Name of the item
- `pos_category`: POS category
- `typical_price`: Rounded price point
- `category_code`: Category account code
- `category_name`: Category name
- `occurrence_count`: Number of times this pattern appears
- `date_range`: First to last occurrence date

**Filtering:**
- Only categorized sales (`is_categorized = true`)
- Only items with assigned category
- Last 12 months only
- Excludes items matching active rules (exact, contains, starts_with, ends_with)
- Ordered by occurrence count DESC

**Example Result:**
```
item_name     | pos_category | typical_price | category_code | category_name     | occurrence_count | date_range
--------------|--------------|---------------|---------------|-------------------|------------------|------------------
Sales Tax     | Tax          | 0.60          | 2200          | Sales Tax Payable | 142              | 2025-01-09 to ...
Burger        | Food         | 12.99         | 4000          | Food Sales        | 87               | 2025-01-15 to ...
Soda          | Beverage     | 2.50          | 4010          | Beverage Sales    | 65               | 2025-01-20 to ...
```

### `get_uncovered_bank_patterns(restaurant_id, limit)`

Returns aggregated bank transaction patterns not covered by existing rules.

**Aggregation Keys:**
- `description`
- `merchant_name`
- `normalized_payee`
- `category_code` and `category_name`

**Returns:**
- `description`: Transaction description
- `merchant_name`: Merchant name
- `normalized_payee`: Normalized payee
- `typical_amount`: Average amount
- `amount_range`: Min to max amount range (e.g., "$490.00 - $525.00")
- `category_code`: Category account code
- `category_name`: Category name
- `occurrence_count`: Number of matching transactions
- `date_range`: First to last transaction date

**Filtering:**
- Only categorized transactions (`is_categorized = true`)
- Only transactions with assigned category
- Last 12 months only
- Excludes transactions matching active rules (exact, contains, starts_with, ends_with, amount_range)
- Ordered by occurrence count DESC

**Example Result:**
```
description          | merchant_name | typical_amount | amount_range       | category_code | occurrence_count | date_range
---------------------|---------------|----------------|--------------------|--------------|--------------------|------------------
SYSCO FOOD SERVICES  | Sysco         | 506.25         | $490.00 - $525.00  | 5000         | 52                 | 2025-01-05 to ...
PG&E PAYMENT         | PG&E          | 152.50         | $150.00 - $155.00  | 5100         | 12                 | 2025-01-10 to ...
```

## Edge Function Changes

### Updated Data Fetching

**Before:**
```typescript
const { data: sales } = await supabaseClient
  .from('unified_sales')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .eq('is_categorized', true)
  .limit(100);
```

**After:**
```typescript
const { data: patterns } = await supabaseClient
  .rpc('get_uncovered_pos_patterns', { 
    p_restaurant_id: restaurantId, 
    p_limit: 200  // More patterns since they're aggregated
  });
```

### Updated Prompt Format

**POS Sales Format:**
```
1. Item Name: Sales Tax
   POS Category: Tax
   Typical Price: $0.60
   Category: 2200 - Sales Tax Payable
   Occurrences: 142 sales (2025-01-09 to 2025-12-31)

2. Item Name: Burger
   POS Category: Food
   Typical Price: $12.99
   Category: 4000 - Food Sales
   Occurrences: 87 sales (2025-01-15 to 2025-12-31)
```

**Bank Transactions Format:**
```
1. Description: SYSCO FOOD SERVICES
   Merchant/Payee: Sysco
   Typical Amount: $506.25
   Amount Range: $490.00 - $525.00
   Category: 5000 - Food Costs
   Occurrences: 52 transactions (2025-01-05 to 2025-12-31)
```

## Benefits

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Records sent | 100 individual | ~50-100 patterns | -50% duplicates |
| Time range | Recent only | 12 months | +1100% data |
| Token usage | High (duplicates) | Lower (unique) | -40-60% |
| Rule overlap | Suggests existing | Excludes covered | 100% relevance |
| Impact context | None | Occurrence count | Prioritization |
| Ordering | Recent first | Impact first | Better rules |

## Testing

Database tests are located in `supabase/tests/17_ai_categorization_aggregation.sql` with 14 test cases covering:

1. **Pattern Aggregation** (6 tests)
   - Correct number of patterns returned
   - Ordering by occurrence count
   - Occurrence count accuracy
   - Price rounding
   - Category information inclusion
   - Date range formatting

2. **Rule Exclusion** (3 tests)
   - Active rules exclude matching patterns
   - Inactive rules don't exclude patterns
   - Different match types (exact, contains, etc.)

3. **Bank Transaction Patterns** (5 tests)
   - Pattern aggregation
   - Ordering by occurrence
   - Occurrence count accuracy
   - Amount range formatting
   - Typical amount calculation

### Running Tests

```bash
# Run all database tests (requires running Supabase instance)
cd supabase/tests && ./run_tests.sh

# Run specific test file
cd supabase/tests && ./run_tests.sh 17_ai_categorization_aggregation.sql
```

## Migration

The migration is automatically applied when deploying:
- File: `supabase/migrations/20260109000000_ai_categorization_aggregation_functions.sql`
- Creates two new RPC functions
- Grants execute permission to authenticated users
- No breaking changes to existing functionality

## Future Enhancements

Possible improvements:
1. Add caching layer for frequently requested patterns
2. Support for regex pattern matching in exclusions
3. Configurable time range (6 months, 24 months, etc.)
4. Pattern similarity scoring
5. Multi-restaurant pattern analysis for franchise operations
