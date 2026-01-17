# Prep Recipe Conversion UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make prep recipe costs accurate and understandable by using unit conversion logic, showing inline costs + warnings, and providing a quick product fix flow, while aligning final output pricing with server-side batch completion.

**Architecture:** Centralize prep cost calculation in a helper that uses `calculateInventoryImpact` + `getProductUnitInfo`. UI renders inline cost + warnings per ingredient and a summary estimate. Quick Fix dialog updates product cost/unit/size fields and refreshes prep recipes. Server function updates output product cost_per_unit on completion to ensure final accuracy.

**Tech Stack:** React, TypeScript, react-hook-form, zod, shadcn/ui, Supabase (SQL migrations + pgTAP tests).

---

## Task 1: Add prep cost helper + unit tests

**Files:**
- Create: `src/lib/prepRecipeCosting.ts`
- Test: `tests/unit/prepRecipeCosting.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { calculatePrepIngredientCost, summarizePrepRecipeCosts } from '@/lib/prepRecipeCosting';

const baseProduct = {
  id: 'p1',
  name: 'Onion White',
  cost_per_unit: 6.46,
  uom_purchase: 'lb',
  size_value: null,
  size_unit: null,
};

const containerProduct = {
  id: 'p2',
  name: 'Spice Jar',
  cost_per_unit: 4.00,
  uom_purchase: 'jar',
  size_value: null,
  size_unit: null,
};

describe('prepRecipeCosting', () => {
  it('computes cost with conversion', () => {
    const result = calculatePrepIngredientCost({
      product: baseProduct,
      quantity: 3,
      unit: 'oz',
    });

    expect(result.status).toBe('ok');
    expect(result.cost).toBeCloseTo(1.21, 2); // 3 oz = 0.1875 lb * 6.46
  });

  it('flags missing cost', () => {
    const result = calculatePrepIngredientCost({
      product: { ...baseProduct, cost_per_unit: null },
      quantity: 3,
      unit: 'oz',
    });

    expect(result.status).toBe('missing_cost');
    expect(result.cost).toBeNull();
  });

  it('flags missing size for container units', () => {
    const result = calculatePrepIngredientCost({
      product: containerProduct,
      quantity: 1,
      unit: 'oz',
    });

    expect(result.status).toBe('missing_size');
  });

  it('summarizes missing ingredients', () => {
    const summary = summarizePrepRecipeCosts([
      { product_id: 'p1', quantity: 3, unit: 'oz' },
      { product_id: 'p2', quantity: 1, unit: 'oz' },
    ], new Map([
      ['p1', baseProduct],
      ['p2', containerProduct],
    ]));

    expect(summary.missingCount).toBe(1);
    expect(summary.estimatedTotal).toBeCloseTo(1.21, 2);
  });
});
```

**Step 2: Run tests to confirm failure**

Run: `npx vitest run tests/unit/prepRecipeCosting.test.ts`
Expected: FAIL (module missing)

**Step 3: Implement helper**

```ts
import { calculateInventoryImpact, COUNT_UNITS, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
import type { IngredientUnit } from '@/lib/recipeUnits';

export type PrepCostStatus =
  | 'ok'
  | 'missing_product'
  | 'missing_cost'
  | 'missing_size'
  | 'incompatible_units'
  | 'fallback';

export type PrepCostResult = {
  status: PrepCostStatus;
  cost: number | null;
  message?: string;
  conversionDetails?: ReturnType<typeof calculateInventoryImpact>['conversionDetails'];
  inventoryDeduction?: number;
  inventoryDeductionUnit?: string;
};

export type PrepCostProduct = {
  id?: string;
  name?: string | null;
  cost_per_unit?: number | null;
  uom_purchase?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
};

export function calculatePrepIngredientCost(params: {
  product?: PrepCostProduct | null;
  quantity: number;
  unit: IngredientUnit;
}): PrepCostResult {
  const { product, quantity, unit } = params;

  if (!product) {
    return { status: 'missing_product', cost: null };
  }

  if (!product.cost_per_unit) {
    return { status: 'missing_cost', cost: null };
  }

  const purchaseUnit = (product.uom_purchase || 'unit').toLowerCase();
  const isContainerUnit = COUNT_UNITS.includes(purchaseUnit);

  if (isContainerUnit && (!product.size_value || !product.size_unit)) {
    return { status: 'missing_size', cost: null };
  }

  try {
    const { purchaseUnit: normalizedPurchase, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
    const impact = calculateInventoryImpact(
      quantity,
      unit,
      quantityPerPurchaseUnit,
      normalizedPurchase,
      product.name || '',
      product.cost_per_unit || 0,
      sizeValue,
      sizeUnit
    );

    return {
      status: 'ok',
      cost: impact.costImpact,
      conversionDetails: impact.conversionDetails,
      inventoryDeduction: impact.inventoryDeduction,
      inventoryDeductionUnit: impact.inventoryDeductionUnit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversion failed';
    if (message.includes('size information') || message.includes('size_value and size_unit')) {
      return { status: 'missing_size', cost: null, message };
    }
    if (message.includes('not compatible')) {
      return { status: 'incompatible_units', cost: null, message };
    }
    return { status: 'fallback', cost: null, message };
  }
}

export function summarizePrepRecipeCosts(
  ingredients: Array<{ product_id: string; quantity: number; unit: IngredientUnit }>,
  productMap: Map<string, PrepCostProduct>
) {
  let estimatedTotal = 0;
  let missingCount = 0;

  ingredients.forEach((ing) => {
    const product = productMap.get(ing.product_id);
    const result = calculatePrepIngredientCost({
      product,
      quantity: ing.quantity,
      unit: ing.unit,
    });

    if (result.status === 'ok' && result.cost != null) {
      estimatedTotal += result.cost;
    } else if (result.status !== 'missing_product') {
      missingCount += 1;
    }
  });

  return { estimatedTotal, missingCount };
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/unit/prepRecipeCosting.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/prepRecipeCosting.ts tests/unit/prepRecipeCosting.test.ts
git commit -m "feat: add prep recipe cost helper"
```

---

## Task 2: Use helper in prep recipe data + cards

**Files:**
- Modify: `src/hooks/usePrepRecipes.tsx`
- Modify: `src/components/prep/PrepRecipeCard.tsx`
- Modify: `src/pages/PrepRecipes.tsx`

**Step 1: Implement changes**

- Add size fields to product selects:

```ts
product:products(id, name, cost_per_unit, current_stock, uom_purchase, category, size_value, size_unit)
```

- Update `PrepRecipeIngredient.product` type to include `size_value` and `size_unit`.
- Update `calculateIngredientCostTotal` to fetch size fields and use `calculatePrepIngredientCost`.
- Update `createOutputProduct` and `updateExistingOutputProduct` to use per-unit cost:

```ts
const outputUnitCost = input.default_yield > 0 ? ingredientCostTotal / input.default_yield : ingredientCostTotal;
```

- Update `recipeStats` to use `summarizePrepRecipeCosts` and include `missingCount`.
- Extend `PrepRecipeCardProps` to accept `missingCount` and render:
  - “Estimated $X / batch” and “Estimated $Y / unit” when `missingCount > 0`.
  - Add a small badge “Missing N” for clarity.
- Update `PrepRecipes` to pass `missingCount` from stats to card.

**Step 2: Run targeted tests**

Run: `npx vitest run tests/unit/prepRecipeCosting.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hooks/usePrepRecipes.tsx src/components/prep/PrepRecipeCard.tsx src/pages/PrepRecipes.tsx
git commit -m "feat: estimate prep recipe costs with conversions"
```

---

## Task 3: Add Quick Product Fix dialog

**Files:**
- Create: `src/components/prep/QuickProductFixDialog.tsx`
- Test: `tests/unit/QuickProductFixDialog.test.tsx`

**Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QuickProductFixDialog } from '@/components/prep/QuickProductFixDialog';

const product = {
  id: 'p1',
  name: 'Onion White',
  cost_per_unit: 6.46,
  uom_purchase: 'lb',
  size_value: 1,
  size_unit: 'lb',
};

describe('QuickProductFixDialog', () => {
  it('submits updated fields', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <QuickProductFixDialog
        open
        onOpenChange={() => undefined}
        product={product}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/Unit Cost/i), { target: { value: '7.25' } });
    fireEvent.change(screen.getByLabelText(/Purchase Unit/i), { target: { value: 'lb' } });
    fireEvent.change(screen.getByLabelText(/Size Value/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Size Unit/i), { target: { value: 'lb' } });

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    expect(onSave).toHaveBeenCalledWith('p1', {
      cost_per_unit: 7.25,
      uom_purchase: 'lb',
      size_value: 1,
      size_unit: 'lb',
    });
  });
});
```

**Step 2: Run test to confirm failure**

Run: `npx vitest run tests/unit/QuickProductFixDialog.test.tsx`
Expected: FAIL (component missing)

**Step 3: Implement dialog**

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { Product } from '@/hooks/useProducts';

interface QuickProductFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSave: (productId: string, updates: Partial<Product>) => Promise<boolean> | void;
}

export function QuickProductFixDialog({ open, onOpenChange, product, onSave }: QuickProductFixDialogProps) {
  const [saving, setSaving] = useState(false);
  const [costPerUnit, setCostPerUnit] = useState<string>('');
  const [uomPurchase, setUomPurchase] = useState<string>('');
  const [sizeValue, setSizeValue] = useState<string>('');
  const [sizeUnit, setSizeUnit] = useState<string>('');

  useEffect(() => {
    if (!product) return;
    setCostPerUnit(product.cost_per_unit?.toString() || '');
    setUomPurchase(product.uom_purchase || '');
    setSizeValue(product.size_value?.toString() || '');
    setSizeUnit(product.size_unit || '');
  }, [product, open]);

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    await onSave(product.id, {
      cost_per_unit: costPerUnit ? Number(costPerUnit) : null,
      uom_purchase: uomPurchase || null,
      size_value: sizeValue ? Number(sizeValue) : null,
      size_unit: sizeUnit || null,
    });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Fix: {product?.name || 'Product'}</DialogTitle>
          <DialogDescription>Update the fields needed for accurate prep costing.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="quick-cost">Unit Cost</Label>
            <Input id="quick-cost" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="quick-uom">Purchase Unit</Label>
            <Input id="quick-uom" value={uomPurchase} onChange={(e) => setUomPurchase(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="quick-size-value">Size Value</Label>
              <Input id="quick-size-value" value={sizeValue} onChange={(e) => setSizeValue(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quick-size-unit">Size Unit</Label>
              <Input id="quick-size-unit" value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !product}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/unit/QuickProductFixDialog.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/prep/QuickProductFixDialog.tsx tests/unit/QuickProductFixDialog.test.tsx
git commit -m "feat: add quick product fix dialog"
```

---

## Task 4: Add inline cost + warnings in Prep Recipe dialog

**Files:**
- Create: `src/components/prep/PrepRecipeIngredientRow.tsx`
- Modify: `src/components/prep/PrepRecipeDialog.tsx`
- Modify: `src/pages/PrepRecipes.tsx`

**Step 1: Implement ingredient row**

```tsx
import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RecipeConversionInfo } from '@/components/RecipeConversionInfo';
import { calculatePrepIngredientCost } from '@/lib/prepRecipeCosting';
import type { IngredientUnit } from '@/lib/recipeUnits';
import type { Product } from '@/hooks/useProducts';

interface PrepRecipeIngredientRowProps {
  ingredient: { product_id: string; quantity: number; unit: IngredientUnit; notes?: string };
  index: number;
  products: Product[];
  onChange: (index: number, field: 'product_id' | 'quantity' | 'unit' | 'notes', value: any) => void;
  onRemove: () => void;
  onQuickFix: (product: Product) => void;
}

export function PrepRecipeIngredientRow({ ingredient, index, products, onChange, onRemove, onQuickFix }: PrepRecipeIngredientRowProps) {
  const [showDetails, setShowDetails] = useState(false);
  const selectedProduct = products.find(p => p.id === ingredient.product_id);

  const costResult = useMemo(() => {
    if (!selectedProduct || !ingredient.quantity || !ingredient.unit) return null;
    return calculatePrepIngredientCost({
      product: selectedProduct,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    });
  }, [selectedProduct, ingredient.quantity, ingredient.unit]);

  const hasWarning = costResult && costResult.status !== 'ok' && costResult.status !== 'missing_product';
  const costLabel = costResult?.cost != null ? `$${costResult.cost.toFixed(2)}` : '--';

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm space-y-3">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-12 sm:col-span-5 space-y-1">
          <Label>Product</Label>
          <Select value={ingredient.product_id} onValueChange={(value) => onChange(index, 'product_id', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-6 sm:col-span-3 space-y-1">
          <Label>Quantity</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={ingredient.quantity}
            onChange={(e) => onChange(index, 'quantity', Number.parseFloat(e.target.value) || 0)}
          />
        </div>

        <div className="col-span-6 sm:col-span-3 space-y-1">
          <Label>Unit</Label>
          <Select value={ingredient.unit} onValueChange={(value) => onChange(index, 'unit', value as IngredientUnit)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Use MEASUREMENT_UNITS in parent */}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-12 sm:col-span-1 flex justify-end">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Estimated cost</span>
        <span className="font-medium text-foreground">{costLabel}</span>
      </div>

      {hasWarning && selectedProduct && (
        <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium">Conversion info needed</span>
            <span className="text-amber-700">
              {costResult?.status === 'missing_cost' && 'Add unit cost'}
              {costResult?.status === 'missing_size' && 'Add size info'}
              {costResult?.status === 'incompatible_units' && 'Unit mismatch'}
              {costResult?.status === 'fallback' && 'Check units'}
            </span>
          </div>
          <Button variant="link" size="sm" className="px-0 text-amber-800" onClick={() => onQuickFix(selectedProduct)}>
            Edit product
          </Button>
        </div>
      )}

      {selectedProduct && ingredient.quantity && ingredient.unit && (
        <Button variant="ghost" size="sm" className="self-start px-0" onClick={() => setShowDetails(!showDetails)}>
          <span className="flex items-center gap-1">
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDetails ? 'Hide details' : 'Details'}
          </span>
        </Button>
      )}

      {showDetails && selectedProduct && (
        <RecipeConversionInfo
          product={selectedProduct}
          recipeQuantity={ingredient.quantity}
          recipeUnit={ingredient.unit}
        />
      )}
    </div>
  );
}
```

**Step 2: Update PrepRecipeDialog**

- Import `PrepRecipeIngredientRow`, `QuickProductFixDialog`, and `summarizePrepRecipeCosts`.
- Add state for quick fix dialog and selected product.
- Render summary above the ingredient list:

```tsx
const { estimatedTotal, missingCount } = summarizePrepRecipeCosts(ingredientRows, productLookup);
```

Render:

```tsx
<div className="flex items-center justify-between text-sm">
  <span className="text-muted-foreground">Estimated cost</span>
  <span className="font-semibold">${estimatedTotal.toFixed(2)}</span>
</div>
{missingCount > 0 && (
  <p className="text-xs text-amber-700">Missing {missingCount} ingredient{missingCount === 1 ? '' : 's'}</p>
)}
```

- Replace the ingredient row markup with `PrepRecipeIngredientRow`.
- Add `QuickProductFixDialog` at the end of the dialog with `onSave` prop.

**Step 3: Update PrepRecipes page**

- Pull `updateProduct` and `fetchPrepRecipes`:

```ts
const { products, updateProduct } = useProducts(...);
const { ..., fetchPrepRecipes } = usePrepRecipes(...);
```

- Pass an `onQuickFixSave` callback into `PrepRecipeDialog`:

```tsx
onQuickFixSave={async (productId, updates) => {
  await updateProduct(productId, updates);
  await fetchPrepRecipes();
}}
```

**Step 4: Commit**

```bash
git add src/components/prep/PrepRecipeIngredientRow.tsx src/components/prep/PrepRecipeDialog.tsx src/pages/PrepRecipes.tsx
git commit -m "feat: show prep ingredient costs and conversion warnings"
```

---

## Task 5: Update production run cost estimates to use conversions

**Files:**
- Modify: `src/hooks/useProductionRuns.tsx`

**Step 1: Implement changes**

- Include `size_value` and `size_unit` in product selects.
- Update `calculateIngredientCostTotal` to use `calculateInventoryImpact` with product size/unit data.
- Update `createOutputProductForRun` to set `cost_per_unit` as `ingredientCostTotal / actualYield`.
- Ensure `syncOutputProductForRun` passes `actualYield` into `createOutputProductForRun`.

**Step 2: Commit**

```bash
git add src/hooks/useProductionRuns.tsx
git commit -m "feat: estimate production run costs with conversions"
```

---

## Task 6: Update server-side output cost on completion

**Files:**
- Create: `supabase/migrations/20260116191500_update_complete_production_run_output_cost.sql`
- Modify: `supabase/tests/20251229130000_refactor_complete_production_runs.sql`

**Step 1: Add migration**

```sql
CREATE OR REPLACE FUNCTION public.complete_production_run(
  p_run_id UUID,
  p_actual_yield NUMERIC,
  p_actual_yield_unit public.measurement_unit,
  p_ingredients JSONB DEFAULT '[]'::jsonb
) RETURNS public.production_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run production_runs%ROWTYPE;
  v_recipe prep_recipes%ROWTYPE;
  v_user UUID := auth.uid();
  v_total_cost NUMERIC := 0;
  v_ing RECORD;
  v_actual NUMERIC;
  v_unit public.measurement_unit;
  v_unit_cost NUMERIC;
  v_current_stock NUMERIC;
  v_reference TEXT;
  v_total_cost_snapshot NUMERIC := 0;
  v_inventory_impact NUMERIC;
  v_output_inventory_impact NUMERIC;
BEGIN
  -- (keep existing function body unchanged) --

  IF v_recipe.output_product_id IS NOT NULL AND p_actual_yield IS NOT NULL THEN
    v_output_inventory_impact := public.calculate_inventory_impact_for_product(
      v_recipe.output_product_id,
      p_actual_yield,
      p_actual_yield_unit::text,
      v_run.restaurant_id
    );

    v_output_inventory_impact := COALESCE(v_output_inventory_impact, p_actual_yield, 0);

    UPDATE products
    SET current_stock = COALESCE(current_stock, 0) + v_output_inventory_impact,
        updated_at = now()
    WHERE id = v_recipe.output_product_id;

    -- NEW: persist final cost per output purchase unit
    UPDATE products
    SET cost_per_unit = CASE
          WHEN v_output_inventory_impact > 0 THEN v_total_cost_snapshot / v_output_inventory_impact
          ELSE cost_per_unit
        END,
        updated_at = now()
    WHERE id = v_recipe.output_product_id;

    INSERT INTO inventory_transactions (...);
  END IF;

  -- (rest of function)
END;
$$;
```

**Step 2: Update SQL test**

Add after Test 6 completion:

```sql
SELECT is(
  (SELECT cost_per_unit::numeric FROM products WHERE id = '00000000-0000-0000-0000-000000000013'),
  2.15::numeric,
  'Output product cost_per_unit is set from batch cost'
);
```

**Step 3: Run tests (if infra available)**

Run: `supabase test db` (or project standard for pgTAP)
Expected: PASS

**Step 4: Commit**

```bash
git add supabase/migrations/20260116191500_update_complete_production_run_output_cost.sql supabase/tests/20251229130000_refactor_complete_production_runs.sql
git commit -m "feat: set output product cost on production completion"
```

---

## Notes / Known Baseline Failure

`npm test` currently fails in this worktree due to `tests/unit/normalizeFilePath.test.ts` calling `process.exit(1)` via `dev-tools/ingest-feedback.js`. Proceeding assumes this is pre-existing.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-16-prep-recipe-conversion-plan.md`.

Two execution options:

1) Subagent-Driven (this session) — I dispatch a fresh subagent per task, review between tasks, fast iteration
2) Parallel Session (separate) — Open new session with executing-plans, batch execution with checkpoints

Which approach?
