# Batch Functionality Audit Report

> **Critical Issues Found**: The prep batch functionality does NOT use the same underlying conversion and costing logic as recipes, leading to incorrect inventory deductions and pricing.

**Date**: January 17, 2026  
**Status**: 🚨 **CRITICAL ISSUES IDENTIFIED**

---

## Executive Summary

The prep batch system (`complete_production_run`) and the recipe system (`process_unified_inventory_deduction` + `calculateRecipeCost`) use **completely different** conversion and costing logic, which violates the DRY principle and causes inconsistent behavior.

### Key Problems Identified

1. **Different Unit Conversion Functions**
   - Batch uses: `calculate_inventory_impact_for_product()` (SQL only, in migration `20251229130000`)
   - Recipe uses: `process_unified_inventory_deduction()` (SQL, in migration `20260114023133`)
   - Recipe cost preview uses: `calculateInventoryImpact()` (TypeScript, in `enhancedUnitConversion.ts`)

2. **Inconsistent Conversion Constants**
   - Batch function and recipe SQL function may have different conversion rates
   - No cross-validation between batch and recipe conversion logic

3. **Different Cost Calculation Approaches**
   - Batch: Calculates costs in TypeScript (`calculateIngredientCostTotal` in `useProductionRuns.tsx`)
   - Recipe: Uses shared TypeScript helper (`calculateInventoryImpact` in `enhancedUnitConversion.ts`)
   - Batch does NOT use `enhancedUnitConversion.ts` at all

4. **Different Pricing Logic for Output Products**
   - Batch: Custom logic in `updateExistingOutputProduct()` with variance adjustment
   - Recipe: Uses standard cost accumulation from `calculateInventoryImpact()`

---

## Detailed Analysis

### 1. Inventory Deduction - Unit Conversion

#### Recipe System (Correct)
**SQL Function**: `process_unified_inventory_deduction()` (migration `20260114023133`)
- ✅ Handles count-to-container conversion (e.g., 1 tortilla → 0.02 bags)
- ✅ Handles volume-to-volume conversion with proper ml standardization
- ✅ Handles weight-to-weight conversion with proper g standardization
- ✅ Supports density conversions (rice, flour, sugar, butter)
- ✅ Handles container units (bottle, jar, can, bag, box)
- ✅ Uses `size_value` and `size_unit` correctly

**TypeScript Preview**: `calculateInventoryImpact()` (`enhancedUnitConversion.ts`)
- ✅ Aligned with SQL function constants
- ✅ Uses same conversion logic
- ✅ Cross-validated in `tests/unit/crossValidation.test.ts`

#### Batch System (Problematic)
**SQL Function**: `calculate_inventory_impact_for_product()` (migration `20251229130000`)
```sql
-- Lines 1-187 in 20251229130000_refactor_complete_production_runs.sql
CREATE OR REPLACE FUNCTION public.calculate_inventory_impact_for_product(
  p_product_id UUID,
  p_recipe_quantity NUMERIC,
  p_recipe_unit TEXT,
  p_restaurant_id UUID
) RETURNS NUMERIC
```

**Issues Identified**:
- ❌ **Different function** than recipe system
- ❌ **No count-to-container conversion** (missing from batch logic)
- ❌ **May have different constants** than `process_unified_inventory_deduction`
- ❌ **No cross-validation** with recipe system
- ❌ **No TypeScript equivalent** for preview/validation

**Conversion Logic Comparison**:

| Feature | Recipe (`process_unified_inventory_deduction`) | Batch (`calculate_inventory_impact_for_product`) |
|---------|-----------------------------------------------|--------------------------------------------------|
| Count-to-Container | ✅ Yes (e.g., 1 tortilla → 0.02 bags) | ❌ No - **MISSING** |
| Volume-to-Volume | ✅ Yes (fl oz, ml, L, cup, etc.) | ✅ Yes |
| Weight-to-Weight | ✅ Yes (oz, lb, kg, g) | ✅ Yes |
| Density (rice, flour, etc.) | ✅ Yes | ✅ Yes |
| Container Units | ✅ Yes (bottle, bag, box, etc.) | ✅ Yes |
| fl oz constant | 29.5735 ml | 29.5735 ml |
| cup constant | 236.588 ml | 236.588 ml |
| oz (weight) constant | 28.3495 g | 28.3495 g |
| lb constant | 453.592 g | 453.592 g |

**Critical Missing Feature**: Count-to-container conversion in batch system means if a prep recipe uses "1 each tortilla" and the product is stored as "50-per-bag", the batch system will incorrectly deduct 1 bag instead of 0.02 bags (1/50).

---

### 2. Cost Calculation

#### Recipe System (Correct)
**Location**: `calculateRecipeCost()` in `useRecipes.tsx` (lines 352-432)
```typescript
const result = calculateInventoryImpact(
  ingredient.quantity,
  ingredient.unit,
  quantityPerPurchaseUnit,
  purchaseUnit,
  product.name || '',
  costPerUnit,
  sizeValue,
  sizeUnit
);

totalCost += result.costImpact;
```

**Uses**:
- ✅ Shared helper: `getProductUnitInfo()` (validates container units)
- ✅ Shared helper: `calculateInventoryImpact()` (does conversion + cost)
- ✅ Returns `costImpact` which accounts for unit conversion
- ✅ Handles container units correctly

#### Batch System (Problematic)
**Location**: `calculateIngredientCostTotal()` in `useProductionRuns.tsx` (lines 295-308)
```typescript
const calculateIngredientCostTotal = useCallback((run: ProductionRun | undefined, payload: CompleteRunPayload) => {
  if (!run?.ingredients || run.ingredients.length === 0) return 0;

  const payloadLookup = new Map(
    (payload.ingredients || []).map(ing => [ing.product_id, ing])
  );

  return run.ingredients.reduce((sum, ing) => {
    const payloadIng = payloadLookup.get(ing.product_id);
    const rawQty = payloadIng?.actual_quantity ?? payloadIng?.expected_quantity ?? ing.actual_quantity ?? ing.expected_quantity ?? 0;
    const actualQty = Number(rawQty) || 0;
    const costPerUnit = ing.product?.cost_per_unit || 0;
    return sum + costPerUnit * actualQty; // ❌ WRONG: No unit conversion!
  }, 0);
}, []);
```

**Issues**:
- ❌ **No unit conversion** - multiplies `actual_quantity * cost_per_unit` directly
- ❌ **Assumes 1:1 ratio** between recipe unit and purchase unit
- ❌ **Does NOT use** `calculateInventoryImpact()` or `getProductUnitInfo()`
- ❌ **Does NOT account** for container units (bottle, bag, box)
- ❌ **Does NOT account** for size_value/size_unit

**Example of Wrong Calculation**:
```
Product: Vodka
- Purchase Unit: bottle (750ml)
- Cost Per Unit: $20 per bottle

Recipe Ingredient:
- Quantity: 1.5 fl oz
- Unit: fl oz

❌ Batch Calculates: 1.5 × $20 = $30 (WRONG!)
✅ Recipe Calculates: (1.5 fl oz = 44.36ml) / 750ml = 0.059 bottles × $20 = $1.18 (CORRECT!)
```

This explains why **batch sets the wrong prices** when creating inventory items.

---

### 3. Output Product Pricing

#### Recipe System
Recipes don't create output products - they just calculate costs correctly using `calculateInventoryImpact()`.

#### Batch System (Problematic)
**Location**: `updateExistingOutputProduct()` in `useProductionRuns.tsx` (lines 399-426)
```typescript
const updates: Record<string, number | string | null> = {};
if (ingredientCostTotal > 0) {
  const varianceAdjustment = variance ? (1 - (variance / 100)) : 1;
  const adjustedCostPerUnit = (ingredientCostTotal / Math.max(actualYield, 1)) * varianceAdjustment;
  updates.cost_per_unit = Math.max(0, adjustedCostPerUnit);
}
```

**Issues**:
- ❌ Uses incorrect `ingredientCostTotal` (from `calculateIngredientCostTotal` which doesn't do unit conversion)
- ❌ Variance adjustment is applied AFTER division, which is backwards
- ❌ No validation that the cost makes sense

**Correct Formula Should Be**:
```typescript
// 1. Calculate ingredient cost WITH unit conversion (like recipes do)
const ingredientCostTotal = calculateIngredientCostWithConversion(run, payload);

// 2. Adjust yield for variance FIRST
const effectiveYield = actualYield * (1 + (variance / 100));

// 3. Calculate cost per unit
const costPerUnit = ingredientCostTotal / Math.max(effectiveYield, 1);
```

---

## Root Cause

The batch functionality was developed **independently** from the recipe system and does not reuse the shared conversion logic:

1. **SQL Level**: Two different functions (`calculate_inventory_impact_for_product` vs `process_unified_inventory_deduction`)
2. **TypeScript Level**: Batch doesn't use `enhancedUnitConversion.ts` at all
3. **No Shared Code**: No code reuse between batch and recipe systems
4. **No Tests**: No cross-validation tests to catch differences

---

## Recommendations

### Priority 1: Fix Inventory Deduction (CRITICAL)

**Option A: Use Recipe Function (Recommended)**
1. Update `complete_production_run()` SQL function to call `process_unified_inventory_deduction()` instead of `calculate_inventory_impact_for_product()`
2. Delete `calculate_inventory_impact_for_product()` to prevent future use
3. Benefits:
   - ✅ Guaranteed consistency
   - ✅ Inherits all recipe fixes automatically
   - ✅ Count-to-container conversion works
   - ✅ No duplication

**Option B: Sync Functions (Not Recommended)**
1. Copy logic from `process_unified_inventory_deduction()` to `calculate_inventory_impact_for_product()`
2. Add cross-validation tests
3. Downsides:
   - ❌ Duplication
   - ❌ Must keep in sync forever
   - ❌ Easy to diverge again

### Priority 2: Fix Cost Calculation (CRITICAL)

**Update `calculateIngredientCostTotal()` in `useProductionRuns.tsx`**:
```typescript
const calculateIngredientCostTotal = useCallback(async (run: ProductionRun | undefined, payload: CompleteRunPayload) => {
  if (!run?.ingredients || run.ingredients.length === 0) return 0;

  // Import shared helpers (SAME as recipes use)
  const { calculateInventoryImpact, getProductUnitInfo } = await import('@/lib/enhancedUnitConversion');

  const payloadLookup = new Map(
    (payload.ingredients || []).map(ing => [ing.product_id, ing])
  );

  let totalCost = 0;

  for (const ing of run.ingredients) {
    if (!ing.product?.cost_per_unit) continue;

    const payloadIng = payloadLookup.get(ing.product_id);
    const actualQty = Number(payloadIng?.actual_quantity ?? ing.actual_quantity ?? ing.expected_quantity) || 0;
    
    // Get validated product unit info (SAME as recipes)
    const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(ing.product);
    
    // Calculate cost WITH unit conversion (SAME as recipes)
    const result = calculateInventoryImpact(
      actualQty,
      (ing.unit as string) || 'unit',
      quantityPerPurchaseUnit,
      purchaseUnit,
      ing.product.name || '',
      ing.product.cost_per_unit,
      sizeValue,
      sizeUnit
    );
    
    totalCost += result.costImpact;
  }

  return totalCost;
}, []);
```

### Priority 3: Add Validation Tests

**Create**: `tests/unit/batchRecipeAlignment.test.ts`
```typescript
describe('Batch vs Recipe Alignment', () => {
  it('should calculate same cost for same ingredients', async () => {
    const ingredient = {
      product_id: 'test-id',
      quantity: 1.5,
      unit: 'fl oz',
      product: {
        name: 'Vodka',
        cost_per_unit: 20,
        uom_purchase: 'bottle',
        size_value: 750,
        size_unit: 'ml',
      }
    };

    // Recipe calculation
    const recipeResult = calculateInventoryImpact(
      ingredient.quantity,
      ingredient.unit,
      750,
      'bottle',
      'Vodka',
      20,
      750,
      'ml'
    );

    // Batch should get same result
    const batchResult = calculateIngredientCostTotal(mockRun, mockPayload);

    expect(recipeResult.costImpact).toBeCloseTo(batchResult);
  });
});
```

### Priority 4: Add SQL Tests

**Update**: `supabase/tests/08_inventory_deduction_conversions.sql`
```sql
-- Test: Batch and Recipe use same conversion for fl oz → bottle
INSERT INTO prep_recipes (...) VALUES (...);
INSERT INTO prep_recipe_ingredients (...) VALUES ('vodka-ing', 'prep-1', 'prod-1', 1.5, 'fl oz');

-- Complete batch
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'prod-1') BETWEEN 9.94 AND 9.942,
  'Batch deduction: 1.5 fl oz from 750ml bottle = 0.059 bottles'
);

-- Process recipe sale (same ingredient)
SELECT public.process_unified_inventory_deduction('rest-1', 'Recipe Name', 1, '2026-01-17');

SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'prod-1') BETWEEN 9.88 AND 9.883,
  'Recipe deduction: same 1.5 fl oz deducted identically'
);
```

---

## Implementation Plan

### Phase 1: Immediate Fixes (✅ COMPLETED)
1. ✅ Create this audit document
2. ✅ Create shared cost calculation module (`src/lib/prepCostCalculation.ts`)
3. ✅ Fix `calculateIngredientCostTotal()` to use `calculateIngredientsCost()`
4. ✅ Add unit tests for shared cost calculation
5. ✅ Add unit tests for batch cost calculation
6. ✅ Add alignment tests verifying batch and recipe match
7. ✅ All tests passing (35 tests)

**Result**: Batch cost calculation now uses proper unit conversion! 🎉

### Phase 2: SQL Alignment (NEXT WEEK)
1. ⬜ Update `complete_production_run()` to use `process_unified_inventory_deduction()` logic
2. ⬜ Add SQL tests for batch vs recipe alignment
3. ⬜ Remove `calculate_inventory_impact_for_product()` (or mark deprecated)

### Phase 3: Validation (FOLLOWING WEEK)
1. ⬜ Run E2E tests for batch functionality
2. ⬜ Manual testing of batch creation with various units
3. ⬜ Compare batch output product costs with manual calculations
4. ⬜ Deploy to staging and verify

---

## Files Modified

### Phase 1 - Cost Calculation (✅ COMPLETED)
- [x] `src/lib/prepCostCalculation.ts` - NEW: Shared cost calculation module
- [x] `src/hooks/useProductionRuns.tsx` - Updated `calculateIngredientCostTotal()`
- [x] `tests/unit/prepCostCalculation.test.ts` - NEW: 14 tests for shared module
- [x] `tests/unit/batchCostCalculation.test.ts` - NEW: 6 tests for batch integration
- [x] `tests/unit/batchRecipeAlignment.test.ts` - NEW: 15 tests for alignment

### Phase 2 - Inventory Deduction (TODO)
- [ ] `supabase/migrations/20251229130000_refactor_complete_production_runs.sql` - Update function or add new migration
- [ ] `supabase/tests/08_inventory_deduction_conversions.sql` - Add batch tests

### Documentation
- [x] `BATCH_FUNCTIONALITY_AUDIT.md` - This file

---

## Appendix: Code Snippets

### Current Batch Cost Calculation (WRONG)
```typescript
// File: src/hooks/useProductionRuns.tsx, lines 295-308
return run.ingredients.reduce((sum, ing) => {
  const payloadIng = payloadLookup.get(ing.product_id);
  const rawQty = payloadIng?.actual_quantity ?? payloadIng?.expected_quantity ?? ing.actual_quantity ?? ing.expected_quantity ?? 0;
  const actualQty = Number(rawQty) || 0;
  const costPerUnit = ing.product?.cost_per_unit || 0;
  return sum + costPerUnit * actualQty; // ❌ No conversion!
}, 0);
```

### Current Recipe Cost Calculation (CORRECT)
```typescript
// File: src/hooks/useRecipes.tsx, lines 397-412
const result = calculateInventoryImpact(
  ingredient.quantity,
  ingredient.unit,
  quantityPerPurchaseUnit,
  purchaseUnit,
  product.name || '',
  costPerUnit,
  sizeValue,
  sizeUnit
);

totalCost += result.costImpact; // ✅ Accounts for conversion!
```

### Batch SQL Function (Different from Recipe)
```sql
-- File: supabase/migrations/20251229130000_refactor_complete_production_runs.sql
CREATE OR REPLACE FUNCTION public.calculate_inventory_impact_for_product(
  p_product_id UUID,
  p_recipe_quantity NUMERIC,
  p_recipe_unit TEXT,
  p_restaurant_id UUID
) RETURNS NUMERIC
```

### Recipe SQL Function (Correct)
```sql
-- File: supabase/migrations/20260114023133_add_count_to_container_conversion.sql
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer,
    p_sale_date text,
    ...
) RETURNS jsonb
```

---

## Conclusion

The batch functionality has **two critical bugs**:

1. **Inventory Deduction**: Uses different SQL function that may have inconsistent logic (missing count-to-container)
2. **Cost Calculation**: Does NOT use unit conversion, resulting in wildly incorrect costs

Both issues stem from not reusing the shared logic that recipes use (`calculateInventoryImpact()` and `process_unified_inventory_deduction()`).

**Immediate Action Required**: Update batch cost calculation to use `calculateInventoryImpact()` before deploying any batch features.

---

**Report Prepared By**: GitHub Copilot  
**Date**: January 17, 2026  
**Priority**: 🚨 CRITICAL
