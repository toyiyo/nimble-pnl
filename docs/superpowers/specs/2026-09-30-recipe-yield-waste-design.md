# Recipe yield % (waste allowance) — design

Date: 2026-09-30
Branch: `feature/recipe-yield-waste`
Status: Draft for Phase 2.5 review

## 1. Problem

A recipe line costs only the portion that goes to the guest. Real use is
larger. Ice cream mix stays on the batch freezer stone, dough gets trimmed,
and bananas lose the peel. Two errors follow:

1. Recipe cost and food cost % are too low.
2. POS depletion deducts too little. Theoretical stock drifts above the
   physical count, and every count shows the gap as shrink.

## 2. Decision summary

- Each product gets a **usable yield %** (`products.yield_pct`, default 100).
- Each recipe line can **override** it (`recipe_ingredients.yield_pct_override`,
  default NULL = inherit).
- Effective quantity = `portion ÷ (yield_pct / 100)`. This quantity drives
  cost **and** inventory deduction.
- There is **no** recipe-level waste %. Product plus line override covers
  every case, and two levels would count waste two times.
- Operators do **not** inflate the portion. The portion stays the real scoop
  size, so portion displays and training sheets stay correct.
- Range: 50–100. A value under 80 shows a "Low yield — review" flag. The flag
  does not block the save.
- `recipes.estimated_cost` stores the **loaded** cost (with waste). All current
  food cost % consumers then use loaded cost with no other change.
- Prep recipes **inherit** the product yield in cost and deduction. They get no
  override column in this PR.

Out of scope (later PR): a theoretical-vs-actual variance report. No live
report exists now (see §3.6).

## 3. Current state (with citations)

### 3.1 Data model
- `recipe_ingredients` has `product_id`, `quantity`, `unit`, `notes` only
  (`supabase/migrations/20250924235138_fff30200-3cac-4662-845b-5ee4ef343cc0.sql:24-33`).
  No later migration changes the table.
- `products` cost columns: `size_value`, `size_unit`, `uom_purchase`,
  `cost_per_unit` and others
  (`supabase/migrations/20250920123920_6293feda-82b3-4972-839c-63ef0c3903c7.sql:11-17`).
- No `yield`, `waste`, or `trim` column exists on `products`, `recipes`,
  `recipe_ingredients`, or `prep_recipe_ingredients`
  (`src/integrations/supabase/types.ts:4598-4609`, `:5034-5066`, `:5496-5506`).
- `prep_recipes.default_yield` is batch **output**, not trim loss
  (`supabase/migrations/20251229120000_create_prep_production_tables.sql:14-15`).
  This design does not touch it.

### 3.2 Recipe cost (frontend)
- The frontend calculates recipe cost. The SQL cost function was dropped
  (`supabase/migrations/20251010164523_cc311241-01fd-4ca6-99c5-2afaa393d48a.sql:4`).
- `computeIngredientCost` is the per-line helper in the list hook
  (`src/hooks/useRecipes.tsx:123-146`). `buildEnhancedRecipes` sums the lines
  (`src/hooks/useRecipes.tsx:192`) and keeps the display fallback at
  `:199`. It stores the raw sum as `computed_cost` (`:221`), and the cost heal compares it at `:276`.
- `RecipeDialog` has its own copy of the cost loop
  (`src/components/RecipeDialog.tsx:224-264`). On save it calls
  `calculateRecipeCost` and writes `estimated_cost`
  (`src/components/RecipeDialog.tsx:293-297`).
- Prep cost wraps `calculateInventoryImpact` in
  `calculateIngredientCost` (`src/lib/prepCostCalculation.ts:84`).
- `src/utils/inventorySimulation.ts:151` mirrors the SQL deduction in TS
  (`ingredient.quantity * quantitySold`). Unit tests use it for parity.

### 3.3 POS depletion (SQL, authoritative)
- `process_unified_inventory_deduction` latest definition:
  `supabase/migrations/20260705000000_fix_prep_shadow_recipe_costing.sql:24`.
- The ingredient cursor joins `products`
  (`…20260705000000_fix_prep_shadow_recipe_costing.sql:157-161`).
- The multiply is one line: `v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;`
  (`…:163`). All conversion, the stock update (`…:318-320`), the cost total
  (`…:327`), and the `inventory_transactions` insert (`…:348-358`) read
  `v_deduction_amount` after this line.
- `complete_production_run` deducts prep ingredients through the same
  function (`…20260705000000_fix_prep_shadow_recipe_costing.sql:470`). So prep
  inherits the yield with no extra SQL change.

### 3.4 Recipe UI
- Cost summary is one box, "Estimated Cost:"
  (`src/components/RecipeDialog.tsx:534-542`).
- The ingredient row: Product, Qty (`w-24`), Unit (`w-28`), trash button.
  It shows no line cost (`src/components/RecipeIngredientItem.tsx:121-191`).

### 3.5 Product UI
- `ProductUpdateDialog` renders `SizePackagingSection`
  (`src/components/ProductUpdateDialog.tsx:773`, import at `:40`, schema at `:65`, save
  payload at `:347`). The Recipes page opens it as a sheet.

### 3.6 Connector and reports
- `get_recipe_analytics` returns per-recipe fields only
  (`supabase/functions/_shared/recipeAnalytics.ts:8-20`), read from
  `recipes.estimated_cost` (`…recipeAnalytics.ts:57-60`). The executor is
  `supabase/functions/ai-execute-tool/index.ts:458-510`.
- A Deno unit conversion port exists: `calculateDeduction`
  (`supabase/functions/_shared/inventoryConversion.ts:200`).
- `src/components/VarianceAnalysis.tsx` is not imported by any file and reads
  the legacy `pos_sales` table. No live theoretical-usage report exists.

## 4. Data model

Two migrations. The first adds the columns and the CHECK constraints as
`NOT VALID`. `products` is a hot table (each POS sale updates
`current_stock`), so the first file must not scan it under the
`ACCESS EXCLUSIVE` lock.

`supabase/migrations/2026093012xxxx_recipe_yield_pct.sql`:

```sql
ALTER TABLE public.products
  ADD COLUMN yield_pct numeric(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN waste_reason text NULL;
ALTER TABLE public.products
  ADD CONSTRAINT products_yield_pct_range
    CHECK (yield_pct >= 50 AND yield_pct <= 100) NOT VALID,
  ADD CONSTRAINT products_waste_reason_len
    CHECK (char_length(waste_reason) <= 120) NOT VALID;

ALTER TABLE public.recipe_ingredients
  ADD COLUMN yield_pct_override numeric(5,2) NULL;
ALTER TABLE public.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_yield_override_range
    CHECK (yield_pct_override IS NULL
           OR (yield_pct_override >= 50 AND yield_pct_override <= 100)) NOT VALID;
```

`supabase/migrations/2026093012xxxy_recipe_yield_pct_validate.sql` (a
separate file, so a separate transaction):

```sql
ALTER TABLE public.products VALIDATE CONSTRAINT products_yield_pct_range;
ALTER TABLE public.products VALIDATE CONSTRAINT products_waste_reason_len;
ALTER TABLE public.recipe_ingredients
  VALIDATE CONSTRAINT recipe_ingredients_yield_override_range;
```

- A `NOT VALID` constraint still applies to each new INSERT and UPDATE.
- `VALIDATE CONSTRAINT` takes a `SHARE UPDATE EXCLUSIVE` lock. It does not
  block POS writes. It must be in its own file because Supabase runs each
  migration file in one transaction, and the first file holds the
  `ACCESS EXCLUSIVE` lock until commit.
- `ADD COLUMN … DEFAULT <constant>` does not rewrite the table on Postgres 11+.
- Existing rows get 100 and NULL. No recipe cost or deduction changes until a
  user sets a value.
- The tables keep their current RLS policies. New columns need no new policy.
- `waste_reason` is free text with UI suggestions ("Trim", "Breakage",
  "Batch freezer / stone loss", "Spoilage"). An enum is too strict for this
  field.

## 5. Calculation

### 5.1 Shared TS helper (new): `src/lib/recipeYield.ts`

```ts
export const YIELD_MIN = 50;
export const YIELD_MAX = 100;
export const YIELD_REVIEW_BELOW = 80;

export function resolveYieldPct(productYield?: number | null, override?: number | null): {
  yieldPct: number;           // clamped 50..100, default 100
  source: 'product' | 'override';
};
export function loadedQuantity(portionQty: number, yieldPct: number): number; // portion / (yield/100)
export function computeLineCost(ingredient, product): {
  portionCost: number; loadedCost: number; wasteCost: number;
  yieldPct: number; source: 'product' | 'override'; loadedQty: number;
};
```

- `computeLineCost` calls `calculateInventoryImpact` one time with the portion
  quantity and multiplies the result by `100 / yieldPct`. Unit conversion is
  linear, so the result is the same as a call with the loaded quantity.
- `computeIngredientCost` (`useRecipes.tsx:123`) returns `loadedCost`.
- `RecipeDialog` deletes its duplicate loop (`RecipeDialog.tsx:224-264`) and
  calls `computeLineCost` for each line. It keeps `portionCost`,
  `loadedCost`, and a per-line result map for the row display.
- `calculateIngredientCost` in `prepCostCalculation.ts` applies the product
  yield (no override for prep). Add `yield_pct` to the `IngredientInfo.product`
  type (`src/lib/prepCostCalculation.ts:32`). Add `yield_pct` to each query
  that fills that type, or the helper has no value to read.
- `inventorySimulation.ts:151` applies the effective yield so the TS mirror
  keeps parity with SQL.

### 5.1a Override persistence (save and copy paths)

The override must reach the database on every write path. Today each path
has a fixed four-field shape (`product_id, quantity, unit, notes`):

- `updateRecipeIngredients` (`src/hooks/useRecipes.tsx:824-882`): add
  `yield_pct_override?: number | null` to the parameter type and to the
  insert row.
- `RecipeDialog.tsx:284-292` (`validIngredients`): map
  `yield_pct_override` from the form row.
- `fetchRecipeIngredients` and the dialog form reset: read
  `yield_pct_override` back into the form so an edit shows the saved value.
- `src/utils/recipePrefill.ts:19-24` (`RecipePrefill.ingredients`) and
  `buildRecipePrefill` (`:52-57`): copy `yield_pct_override`, so "Copy
  ingredients and units" in `RecipeCreateFromExistingDialog` keeps it.

### 5.1b Form field shape (empty = inherit)

- Zod: `yield_pct_override: z.number().min(50).max(100).nullable().optional()`.
- `onChange`: an empty string gives `null`. Otherwise `Number(value)`.
  Do **not** copy the Qty pattern `parseFloat(e.target.value) || 0`
  (`RecipeIngredientItem.tsx:155`). That pattern turns an empty box into
  `0`, which fails the bound or stores a wrong yield.
- The input value shows `field.value ?? ''`.
- The save maps `undefined` to `null`, so a cleared field writes NULL.

### 5.2 SQL deduction

In a new migration that re-creates `process_unified_inventory_deduction`
with the same signature:

```sql
SELECT ri.*, p.name AS product_name, …,
       COALESCE(ri.yield_pct_override, p.yield_pct, 100) AS effective_yield_pct
…
v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold
                      / (v_ingredient_record.effective_yield_pct / 100.0);
```

- Everything after line 163 reads `v_deduction_amount`, so the stock, cost,
  and transaction all include waste.
- The reason text gets a suffix when yield < 100, for example
  `… [yield 90%]`. Operators can then see why 5.56 oz left for a 5 oz scoop.
- The function body is copied in full from `20260705000000`. Only the cursor,
  line 163, and the reason text change. `CREATE OR REPLACE` with the same
  signature keeps grants.
- The re-created function must keep `SECURITY DEFINER` and
  `SET search_path TO 'public'` (`20260705000000_fix_prep_shadow_recipe_costing.sql:15-16`).
  Copy the full header, not only the body.
- The CHECK constraints make a zero or negative divisor impossible. The
  `COALESCE(…, 100)` covers a NULL.

### 5.3 Worked example

Sweet cream mix, 5 fl oz, $0.066 per fl oz, product yield 90%:

| | Quantity | Cost |
|---|---|---|
| Portion | 5.00 fl oz | $0.33 |
| Loaded (deducted) | 5.56 fl oz | $0.37 |
| Waste allowance | 0.56 fl oz | $0.04 |

## 6. UX

A live mockup was shown to the user in the brainstorm and approved as the
direction. The UI follows the CLAUDE.md Apple/Notion style.

### 6.1 Ingredient row (`RecipeIngredientItem`)

- New **Yield** field after Unit, `w-20`, `type="number"`, `min=50`,
  `max=100`, `step=1`, suffix `%`. Label: "Yield". `aria-label`:
  "Yield percent for {product}".
- Empty field = inherit. The placeholder shows the product value, for example
  `90`. Clear the field to go back to the product value.
- New **Cost** cell (read-only, right-aligned, tabular numbers) shows the
  loaded line cost.
- A caption line under the row (only when a product is selected):
  - A chip: "90% from product" (muted) or "85% override · product 90%"
    (accent tint).
  - "Uses 5.56 fl oz from inventory per sale · portion $0.33".
  - When the effective yield < 80: "Low yield — review" in the semantic
    `warning` token (`text-warning`, `bg-warning/10`, `border-warning/30`;
    defined at `tailwind.config.ts:47-49`). Do not copy the raw `amber-*`
    classes of the conversion warning (`RecipeIngredientItem.tsx:94-118`).
  - The override chip uses `bg-muted` plus `text-foreground`. The inherit
    chip uses `text-muted-foreground`. No raw color classes.
- At 100% with no override the caption shows only the cost text. This keeps
  the row quiet for cups, spoons, and other items with no loss.
- Mobile: the row already uses `flex-wrap` (`RecipeIngredientItem.tsx:121`).
  Yield and Cost wrap with Qty and Unit.
- Typography follows CLAUDE.md: new cell labels use the existing `FormLabel`
  to match Qty and Unit in the same row. The caption uses `text-[13px]
  text-muted-foreground`. The Cost value uses `text-[14px] font-medium
  tabular-nums`.

### 6.2 Cost summary (`RecipeDialog`)

Replace the "Estimated Cost:" box (`RecipeDialog.tsx:534-542`) with a 2×2
grid (4 columns at `sm:`):

| Tile | Value |
|---|---|
| Portion cost | Sum of portion costs |
| Waste allowance | Loaded − portion |
| Loaded cost | Sum of loaded costs (emphasis border) |
| Food cost % | Loaded cost ÷ `recipe.avg_sale_price`, or "—" with no sales |

- The average sale price already comes with the `recipe` prop. `useRecipes`
  fills `avg_sale_price` from `get_recipe_sales_stats`
  (`src/hooks/useRecipes.tsx:176-183`). A new recipe has no prop, so the
  tile shows "—". No new query is needed.
- Tile labels use `text-[12px] font-medium text-muted-foreground uppercase
  tracking-wider`. Values use `text-[17px] font-semibold tabular-nums`.
  Tiles use `rounded-xl border border-border/40 bg-muted/30`. The Loaded
  tile uses `border-foreground/40`.

Under the grid: "Waste allowance: $0.04 per serving · $21 a week at current
volume (530 sold in the last 7 days)."
- The weekly line shows only when the recipe has a `pos_item_name` and the
  last 7 days have sales.
- The volume comes from a new `useRecipeWeeklyVolume(restaurantId, posItemName)`
  hook (React Query, `staleTime: 60000`). It sums `unified_sales.quantity`
  for the item over the last 7 restaurant days.
- The hook has loading, error, and empty states. On error or empty the line
  shows only "per serving".
- When all lines are 100%, the Waste allowance tile shows `$0.00`, and a
  hint says "Set a yield on the product to include waste."

### 6.3 Product sheet (`ProductUpdateDialog` / `SizePackagingSection`)

- New fields in the size and packaging section:
  - **Usable yield** — number input with `%` suffix, 50–100, default 100.
  - **Waste reason** — optional combobox with the suggestions in §4 and free
    text.
- Helper text: "Share of each unit that ends up in what you sell. 100% means
  no loss."
- A count line: "Used in N recipes." The count comes from
  `recipe_ingredients` rows for this `product_id` with
  `yield_pct_override IS NULL`, in the selected restaurant.
  `idx_recipe_ingredients_product_id` covers the query.
- A value under 80 shows the same "Low yield — review" hint.

### 6.4 Recipes list

- The cost column in `src/components/recipes/recipeTableColumns.ts` keeps
  `estimated_cost`, which is now the loaded cost. No new column in this PR.

## 7. Connector (`get_recipe_analytics`)

- Add `portion_cost`, `loaded_cost`, and `waste_cost` per recipe.
- Add an `ingredients` array per recipe with `product_name`, `quantity`,
  `unit`, `yield_pct`, `yield_source`, `portion_cost`, `loaded_cost`.
- Calculate them in `_shared/recipeAnalytics.ts` with `calculateDeduction`
  from `_shared/inventoryConversion.ts:200`.
- `calculateRecipeProfitability` reads every active recipe
  (`recipeAnalytics.ts:57-60`, no `LIMIT`). The executor slices to 20 only
  after that (`ai-execute-tool/index.ts:485`).
- So the ingredient fetch is a separate step that runs **after** the sort
  and the slice. It fetches ingredients in **one** query
  (`.in('recipe_id', top20Ids)`) for the top 20 recipe ids only. No N+1, and
  the payload does not grow with the recipe count.
- `food_cost_percentage` keeps its current formula on `estimated_cost`
  (now loaded).

## 8. Data flow after the change

1. A user sets 90% on "Sweet cream mix".
2. The recipe dialog shows $0.37 loaded for the line. On save,
   `estimated_cost` stores the loaded total.
3. The next POS sale deducts 5.56 fl oz and writes a transaction with the
   `[yield 90%]` suffix.
4. The connector returns portion, loaded, and yield for each line.

Existing `recipes.estimated_cost` values stay stale until the next recipe
save or the cost heal in `useRecipes` runs. The cost heal already writes
back a changed computed cost (`src/hooks/useRecipes.tsx:276`), so the
list view corrects each recipe on the next load.

## 9. Testing

- Unit (`tests/unit/recipeYield.test.ts`): resolve, clamp, default 100,
  override wins, loaded quantity, line cost at 90% = $0.37 for the example.
- Unit: `buildEnhancedRecipes` with a 90% product changes `computed_cost`.
- Unit: `inventorySimulation` parity at 90%.
- Unit: `RecipeIngredientItem` shows the inherit chip, the override chip, and
  the low-yield flag at 75. A cleared Yield field gives `null`, not `0`.
- Unit: `updateRecipeIngredients` sends `yield_pct_override` in the insert.
- Unit: `buildRecipePrefill` copies `yield_pct_override`.
- pgTAP (`supabase/tests/recipe_yield_deduction.test.sql`):
  - 100% product → deduction unchanged.
  - A NULL `yield_pct` (column made nullable inside the test transaction)
    deducts as 100%. This guards the `COALESCE` if a later migration
    weakens the `NOT NULL`.
  - 90% product → deduct 5.5556 for 5 sold units of 1.
  - Line override 80% wins over product 90%.
  - CHECK rejects 49 and 101 on both columns.
  - The function signature keeps `SECURITY DEFINER` (check `pg_proc.prosecdef`).
  - A prep production run deducts with the product yield.
- Edge function unit test for the new connector fields.

## 10. Rollout

- Default 100 means no change on deploy.
- After deploy the owner seeds yields for the high-cost items first (ice
  cream mix, cake bases, pretzel dough).

## 11. Decided trade-offs

- Only the frontend calculates recipe cost. This design keeps that. The SQL
  deduction is authoritative for stock. Both use the same formula.
- A yield change does not recompute stored `estimated_cost` for every recipe
  at once. The cost heal corrects each recipe on the next list load.
- The existing conversion warning keeps its raw `amber-*` classes in this
  PR. New code uses the `warning` token. A token cleanup of the old block
  is out of scope.
- `avg_sale_price` covers all time (`get_recipe_sales_stats`). The Food
  cost % tile uses it as the current app does. A time window is a later
  change.
