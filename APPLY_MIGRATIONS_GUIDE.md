# Apply All Pending Split Rule Migrations

This guide will help you apply all the migrations we created to fix the split rules feature.

## Migrations to Apply (in order)

1. **20251121150000_fix_split_constraint.sql** - Fixes constraint issues
2. **20251121160000_debug_split_rules_application.sql** - Adds debug logging
3. **20251121170000_fix_apply_split_rules_conversion.sql** - Fixes percentage to amount conversion ⭐ (MOST IMPORTANT)

## Option 1: Apply via Supabase CLI (Recommended)

```bash
# Navigate to project directory
cd /Users/josedelgado/Documents/GitHub/nimble-pnl

# Apply all pending migrations
supabase db push

# Or reset the database (development only)
supabase db reset
```

## Option 2: Apply Manually via Supabase Dashboard

If the CLI doesn't work, apply each migration manually:

### Step 1: Fix Constraints
Go to SQL Editor and run the content of:
`supabase/migrations/20251121150000_fix_split_constraint.sql`

### Step 2: Add Debug Logging (Optional)
Run the content of:
`supabase/migrations/20251121160000_debug_split_rules_application.sql`

### Step 3: Fix Percentage Conversion (CRITICAL)
Run the content of:
`supabase/migrations/20251121170000_fix_apply_split_rules_conversion.sql`

## Option 3: Quick Fix - Just Apply the Critical Function

If you just want to fix the immediate issue, run this SQL in Supabase SQL Editor:

```sql
-- This is the complete fix from 20251121170000_fix_apply_split_rules_conversion.sql
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_rule RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_sale_json JSONB;
  v_batch_count INTEGER := 0;
  v_split_result RECORD;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- Get uncategorized POS sales (limited to prevent timeout)
  FOR v_sale IN
    SELECT id, item_name, total_price, pos_category
    FROM unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
      AND is_split = false
    ORDER BY sale_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;
    v_batch_count := v_batch_count + 1;
    
    v_sale_json := jsonb_build_object(
      'item_name', v_sale.item_name,
      'total_price', v_sale.total_price,
      'pos_category', v_sale.pos_category
    );
    
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(p_restaurant_id, v_sale_json)
    LIMIT 1;
    
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        IF v_rule.is_split_rule AND v_rule.split_categories IS NOT NULL THEN
          -- Convert percentage splits to amount splits
          v_splits_array := ARRAY[]::JSONB[];
          
          FOR v_split IN SELECT * FROM jsonb_array_elements(v_rule.split_categories)
          LOOP
            IF v_split->>'percentage' IS NOT NULL THEN
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2),
                'description', COALESCE(v_split->>'description', '')
              );
            ELSE
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', (v_split->>'amount')::NUMERIC,
                'description', COALESCE(v_split->>'description', '')
              );
            END IF;
          END LOOP;
          
          v_splits_with_amounts := to_jsonb(v_splits_array);
          
          SELECT * INTO v_split_result
          FROM split_pos_sale(v_sale.id, v_splits_with_amounts);
          
          IF v_split_result.success THEN
            v_applied_count := v_applied_count + 1;
          ELSE
            RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
          END IF;
        ELSE
          UPDATE unified_sales
          SET 
            category_id = v_rule.category_id,
            is_categorized = true,
            updated_at = now()
          WHERE id = v_sale.id;
          v_applied_count := v_applied_count + 1;
        END IF;
        
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;
```

## Verify It Worked

After applying, run this test:

```sql
SELECT * FROM apply_rules_to_pos_sales(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5
);
```

**Expected output**: `applied_count` should be > 0 if there are matching sales.

## Then Test via Edge Function

Call the endpoint again:
```
POST https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/apply-categorization-rules
```

With payload:
```json
{
  "restaurantId": "b80c60f4-76f9-49e6-9e63-7594d708d31a",
  "applyTo": "pos_sales",
  "batchLimit": 100
}
```

Should now see: `"Applied rules to X of 99 POS sales"` where X > 0.
