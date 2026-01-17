# Prep Recipe Conversion and Pricing Design

## Goal
Provide accurate, understandable prep recipe cost estimates by applying the same unit conversion logic used elsewhere, surface conversion issues clearly, and add a quick fix flow for missing product cost/size data. Align final output item pricing with server-side production run costing.

## Context
Prep recipe estimates are currently computed as cost_per_unit * quantity with no unit conversion in `src/hooks/usePrepRecipes.tsx`. This inflates costs when recipe units differ from purchase units or when container sizing is missing. The recipe feature already has conversion warnings and detailed conversion info via `src/components/RecipeIngredientItem.tsx` and `src/components/RecipeConversionInfo.tsx`, and conversion logic in `src/lib/enhancedUnitConversion.ts`.

## Decisions
- UX pattern: Option A (inline per-ingredient info + details disclosure).
- Inline per-ingredient cost is shown when possible.
- Warn only (allow save). Do not block recipe save on missing conversion data.
- Total cost summary shows "Estimated $X (Missing N ingredients)" if partial.
- Quick Fix dialog for product cost/size/unit fields (with link to full edit if needed).
- Data flow: server-side `complete_production_run` is the source of truth for output product cost_per_unit; client only shows estimates.

## UX and UI Behavior

### Ingredient row
- Inline cost on the right (for example, "$2.14").
- If missing data, show "--" and a compact warning pill with short copy:
  - Missing cost: "Add unit cost"
  - Missing size info: "Add size info"
  - Incompatible units: "Unit mismatch"
- The warning includes a single "Edit product" action that opens the Quick Fix dialog.
- Each row includes a "Details" disclosure to expand conversion details.

### Conversion details
- Reuse conversion details logic (same calculations as recipes) but in a compact card.
- Show conversion path, percentage of package used, and cost impact when available.

### Summary
- If all ingredients are computable: show "Estimated $X".
- If missing any: show "Estimated $X (Missing N ingredients)".

## Data Flow and Cost Correctness

### Prep recipe estimates
- Use `calculateInventoryImpact` + `getProductUnitInfo` from `src/lib/enhancedUnitConversion.ts` to compute per-ingredient cost.
- Missing data or conversion errors become warnings and excluded from total.

### Production run output pricing
- Update `complete_production_run` to set `products.cost_per_unit` based on final `v_total_cost_snapshot / v_output_inventory_impact`.
- Remove or reduce client-side product cost updates on completion to avoid drift.

## Components and Files

### New or updated components
- Add a lightweight prep ingredient row (in `src/components/prep/` or inline in `src/components/prep/PrepRecipeDialog.tsx`) with:
  - Inline cost display
  - Warning pill + action
  - Details disclosure
- Add `QuickProductFixDialog` (new) that edits:
  - cost_per_unit
  - uom_purchase
  - size_value
  - size_unit
  - and calls `useProducts.updateProduct`

### Hook updates
- Update `src/hooks/usePrepRecipes.tsx` cost estimation to use `calculateInventoryImpact` and return missing counts.
- Avoid updating output product cost_per_unit from client on completion when the server sets it.

### UI wiring
- `src/pages/PrepRecipes.tsx` should provide products and an `onProductUpdated` callback to refresh products + recipes after quick fix.

## Error Handling
- Conversion errors are surfaced as warnings; saving a recipe is still allowed.
- Quick Fix dialog shows inline errors if save fails, and does not affect recipe form state.

## Testing
- Unit test for prep recipe cost estimation with conversion and missing data.
- Verify warning states (missing cost, missing size, incompatible units).
- Verify estimated total format when partial.

## Out of Scope
- Blocking recipe save on missing data.
- Full redesign of product edit flow.

## Risks and Mitigations
- Risk: drift between client estimates and server final cost. Mitigation: set output product cost_per_unit in `complete_production_run`.
- Risk: user confusion if cost is partial. Mitigation: explicit "Estimated" and missing count.
