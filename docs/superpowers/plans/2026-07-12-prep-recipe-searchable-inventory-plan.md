# Plan: Searchable inventory dropdowns in the Prep Recipe modal

Design: `docs/superpowers/specs/2026-07-12-prep-recipe-searchable-inventory-design.md`

TDD (RED → GREEN → REFACTOR → COMMIT) per task. Tasks are ordered by dependency:
Task 1 (enhance the shared component) must land before Task 2 (consume it).

## Task 1 — Extend `SearchableProductSelector` API

**File:** `src/components/SearchableProductSelector.tsx`
**Test:** `tests/unit/SearchableProductSelector.test.tsx` (new)

1. **RED** — Add tests:
   - Default: renders "+ Create New Item" (guards Receipt/Recipe consumers).
   - `showCreateOption={false}`: "+ Create New Item" is absent.
   - `showCreateOption={false}` + `showSkipOption={false}`: no "Actions" group
     heading rendered; existing-products list still renders + filters.
   - `id="output"` forwards to the trigger; `aria-label="Output Item"` gives the
     `role="combobox"` trigger that accessible name.
2. **GREEN** — Implement:
   - Add `showCreateOption?: boolean` (default `true`), `id?: string`,
     `'aria-label'?: string` to `SearchableProductSelectorProps`.
   - Gate the create `CommandItem` on `showCreateOption`.
   - Render the `<CommandGroup heading="Actions">` only when
     `showCreateOption || showSkipOption`.
   - Spread `id` and `aria-label` onto the trigger `<Button>`.
3. **REFACTOR** — keep the actions-group condition readable (a small local
   boolean, e.g. `hasActions`).
4. **COMMIT** — `feat(products): showCreateOption + id/aria-label on SearchableProductSelector`

## Task 2 — Swap the two prep dropdowns to the searchable selector

**File:** `src/components/prep/EnhancedPrepRecipeDialog.tsx`
**Test:** `tests/unit/EnhancedPrepRecipeDialog.test.tsx` (new)

1. **RED** — Add tests (render dialog with a small `products` fixture):
   - Ingredient combobox: `getByRole('combobox', { name: /ingredient 1/i })`,
     open it, type a query, assert the list narrows; selecting an option updates
     the row (assert the trigger now shows the product name).
   - Output Item: `getByRole('combobox', { name: /output item/i })` present.
   - Assert "+ Create New Item" and "Skip This Item" are absent.
2. **GREEN** — Implement:
   - Import `SearchableProductSelector`.
   - Replace the Output Item `<Select>…</Select>` (≈ lines 663–682) with
     `<SearchableProductSelector id="output" aria-label="Output Item"
     value={formValues.output_product_id || ''} onValueChange={...}
     products={products} showSkipOption={false} showCreateOption={false}
     placeholder="Search inventory items..." />`.
   - Replace the per-row Ingredient `<Select>…</Select>` (≈ lines 851–865) with
     `<SearchableProductSelector aria-label={`Ingredient ${index + 1}`}
     value={ingredient.product_id}
     onValueChange={(value) => handleIngredientChange(index, 'product_id', value)}
     products={products} showSkipOption={false} showCreateOption={false}
     placeholder="Search inventory items..." />`.
   - Remove now-unused `Select*` imports **only if** no other `<Select>` remains
     in the file (Category, Yield Unit, Shelf Life, °F/°C still use `<Select>`, so
     the import stays — verify before deleting).
3. **REFACTOR** — confirm the ingredient-row grid column still lays out (the
   selector fills `flex-1` like the old trigger).
4. **COMMIT** — `feat(prep): searchable inventory dropdowns in prep recipe modal`

## Task 3 — Verify (Phase 8 gate)

- `npm run test` (new + existing prep/receipt/recipe suites green),
  `npm run typecheck`, `npm run lint`, `npm run build`.
- Manual/preview check on `/prep-recipes`: open modal → Ingredients tab → type to
  filter; Details tab → Output Item type to filter.

## Out of scope (per design "Decided trade-offs")

- Fixed-list selects (Category / Yield Unit / Shelf Life / °F-°C) stay plain.
- No create-new-product flow inside the prep modal.
- No dialog-wide Apple/Notion typography realignment.
- No shared-Fuse-index refactor of `SearchableProductSelector`.
