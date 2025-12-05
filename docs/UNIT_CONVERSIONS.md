# Unit Conversion System

> Critical documentation for the inventory deduction unit conversion system.

This document describes the unit conversion system used for recipe-based inventory deductions. **Both TypeScript (client-side preview) and SQL (server-side execution) must use identical conversion constants** to ensure consistency.

---

## 📍 Overview

When a POS sale occurs, the system deducts ingredients from inventory based on recipes. This requires converting between:
- **Recipe units** (how ingredients are measured in recipes, e.g., `fl oz`, `cup`, `tbsp`)
- **Purchase units** (how products are bought and tracked, e.g., `bottle`, `bag`, `box`)

### Key Files

| File | Purpose | Authority |
|------|---------|-----------|
| `src/lib/enhancedUnitConversion.ts` | Client-side preview calculations | Preview only |
| `supabase/migrations/*_inventory_*.sql` | Server-side actual deductions | **Authoritative** |
| `tests/unit/crossValidation.test.ts` | Ensures TS ↔ SQL alignment | Validation |
| `supabase/tests/08_inventory_deduction_conversions.sql` | SQL function tests | Validation |

> ⚠️ **The SQL function is authoritative** - it's the only code that actually modifies inventory. TypeScript is for preview only.

---

## 🔢 Conversion Constants

### Volume Units (to milliliters)

| Unit | Abbreviation | ml Equivalent | Notes |
|------|--------------|---------------|-------|
| Fluid Ounce | `fl oz` | 29.5735 | Volume measurement |
| Cup | `cup` | 236.588 | US cup |
| Tablespoon | `tbsp` | 14.7868 | US tablespoon |
| Teaspoon | `tsp` | 4.92892 | US teaspoon |
| Liter | `L` | 1000 | Metric |
| Milliliter | `ml` | 1 | Base unit |
| Gallon | `gal` | 3785.41 | US gallon |
| Quart | `qt` | 946.353 | US quart |

### Weight Units (to grams)

| Unit | Abbreviation | g Equivalent | Notes |
|------|--------------|--------------|-------|
| Weight Ounce | `oz` | 28.3495 | **Weight, not volume** |
| Pound | `lb` | 453.592 | US pound |
| Kilogram | `kg` | 1000 | Metric |
| Gram | `g` | 1 | Base unit |

### ⚠️ Critical: `oz` vs `fl oz`

```
'oz'    = Weight ounce = 28.3495 grams   (for solids like pasta, cheese)
'fl oz' = Fluid ounce  = 29.5735 ml      (for liquids like vodka, juice)
```

**Always use the correct abbreviation!** Using `oz` for liquids will cause incorrect deductions.

### Product-Specific Densities (grams per cup)

| Product | g/cup | Use Case |
|---------|-------|----------|
| Rice | 185 | Uncooked rice |
| Flour | 120 | All-purpose flour |
| Sugar | 200 | Granulated sugar |
| Butter | 227 | Solid butter |

These densities are detected by product name (e.g., product name contains "rice" → uses 185g/cup).

---

## 🔄 Conversion Logic Flow

### 1. Direct Unit Match (No Conversion)
```
Recipe unit = Purchase unit → Use 1:1 ratio
Example: Recipe uses 0.5 kg, product is in kg → Deduct 0.5 kg
```

### 2. Volume-to-Volume Conversion
```
Recipe: 1.5 fl oz of vodka
Product: 750ml bottle
→ Convert to common base (ml): 1.5 × 29.5735 = 44.36 ml
→ Divide by package size: 44.36 / 750 = 0.0591 bottles
```

### 3. Weight-to-Weight Conversion
```
Recipe: 4 oz of pasta
Product: 1 lb box
→ Convert to common base (g): 4 × 28.3495 = 113.4 g
→ Convert package to g: 1 × 453.592 = 453.592 g
→ Divide: 113.4 / 453.592 = 0.25 boxes
```

### 4. Density Conversion (Volume → Weight)
```
Recipe: 2 cups of rice
Product: 10 kg bag
→ Apply density: 2 × 185 = 370 g
→ Convert to kg: 370 / 1000 = 0.37 kg
→ Divide by package: 0.37 / 10 = 0.037 bags
```

### 5. Fallback (1:1)
When no conversion path exists, the system uses a 1:1 ratio and logs a warning.

---

## 📦 Container Units

These units represent containers, not measurements:

```typescript
COUNT_UNITS = ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 
               'box', 'bag', 'case', 'container', 'package', 'dozen', 'jar']
```

For container units, the system uses `size_value` and `size_unit` to determine the actual content amount:

```
Product: Vodka Bottle (bottle)
  size_value: 750
  size_unit: ml
→ 1 bottle = 750 ml
```

---

## 🧪 Testing

### TypeScript Tests
```bash
npm run test -- tests/unit/crossValidation.test.ts
```

### SQL Tests
```bash
npm run test:db
```

### What Tests Validate
1. **Constant alignment** - Same values in TS and SQL
2. **Conversion accuracy** - Correct math for all unit combinations
3. **Edge cases** - Zero quantities, large quantities, precision
4. **Product detection** - Rice/flour/sugar density detection

---

## 🛠️ Adding New Conversions

### Step 1: Add to TypeScript
```typescript
// In src/lib/enhancedUnitConversion.ts
const STANDARD_CONVERSIONS = {
  'new_unit': { 'ml': 123.456, 'L': 0.123456 },
  // ... add to existing conversions
};
```

### Step 2: Add to SQL
```sql
-- In a new migration
IF v_recipe_unit_lower = 'new_unit' THEN
    v_recipe_in_ml := v_deduction_amount * 123.456;
END IF;

-- Also add to package size handling
IF v_size_unit_lower = 'new_unit' THEN
    v_package_size_ml := v_package_size_ml * 123.456;
END IF;
```

### Step 3: Add Tests
```typescript
// In tests/unit/crossValidation.test.ts
it('new_unit to ml uses 123.456 (matches SQL)', () => {
  // ... test conversion
});
```

```sql
-- In supabase/tests/08_inventory_deduction_conversions.sql
-- Test: new_unit conversion
INSERT INTO products (...) VALUES (...);
SELECT ok(
  (SELECT current_stock FROM products WHERE id = '...') BETWEEN x AND y,
  'new_unit conversion test'
);
```

---

## 🚨 Common Issues

### Issue: Incorrect deductions for liquids
**Cause**: Using `oz` instead of `fl oz` for volume  
**Fix**: Always use `fl oz` for fluid ounces (liquids)

### Issue: Cup-to-tbsp conversion wrong
**Cause**: Missing `tbsp`/`tsp` in SQL package size handling  
**Fix**: Migration `20251205085616_fix_volume_unit_conversions.sql` added these

### Issue: Preview doesn't match actual
**Cause**: Constants differ between TypeScript and SQL  
**Fix**: Run `crossValidation.test.ts` to detect drift

### Issue: Product density not applied
**Cause**: Product name doesn't contain keyword (rice, flour, etc.)  
**Fix**: Ensure product names include the ingredient type

---

## 📊 Quick Reference

### TypeScript Constants Location
```typescript
// src/lib/enhancedUnitConversion.ts
const STANDARD_CONVERSIONS = { ... };
export const PRODUCT_CONVERSIONS = { ... };
```

### SQL Constants Location
```sql
-- process_unified_inventory_deduction function
v_volume_units text[] := ARRAY['fl oz', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'gal', 'qt'];
v_weight_units text[] := ARRAY['g', 'kg', 'lb', 'oz'];
```

### Conversion Formulas
```
Volume to ml:
  fl oz → ml: value × 29.5735
  cup → ml:   value × 236.588
  tbsp → ml:  value × 14.7868
  tsp → ml:   value × 4.92892
  L → ml:     value × 1000
  gal → ml:   value × 3785.41

Weight to g:
  oz → g:  value × 28.3495
  lb → g:  value × 453.592
  kg → g:  value × 1000

Density (cup to g):
  rice:   value × 185
  flour:  value × 120
  sugar:  value × 200
  butter: value × 227
```

---

## 🔗 Related Documentation

- [Architecture](ARCHITECTURE.md) - Overall system design
- [Integrations](INTEGRATIONS.md) - POS and data flow
- [Cross-Validation Tests](../tests/unit/crossValidation.test.ts) - Test source
- [SQL Tests](../supabase/tests/08_inventory_deduction_conversions.sql) - SQL test source
