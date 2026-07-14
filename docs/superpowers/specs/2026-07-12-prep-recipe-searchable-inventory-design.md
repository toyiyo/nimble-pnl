# Design: Searchable inventory dropdowns in the Prep Recipe modal

**Date:** 2026-07-12
**Branch:** `feature/prep-recipe-searchable-inventory`
**Route affected:** `/prep-recipes` → `PrepRecipesEnhanced` → `EnhancedPrepRecipeDialog`

## Problem

In the Prep Recipe create/edit modal (`EnhancedPrepRecipeDialog`), inventory
items are chosen through plain shadcn `<Select>` dropdowns. With a large
inventory these become long, unscrollable scan-lists — there is no way to type
to filter. Two dropdowns are affected:

1. **Output Item** (Details tab) — `output_product_id`, line ~663.
2. **Ingredient** (Ingredients tab, one per row) — `ingredient.product_id`,
   line ~851.

The rest of the app already solved this: `SearchableProductSelector`
(Command + Popover + Fuse.js fuzzy search over `name`/`sku`/`brand`) is used by
`RecipeIngredientItem` and `receipt/ReceiptItemRow`.

## Goal

Make the two **inventory-item** dropdowns in the prep modal searchable by
reusing the existing `SearchableProductSelector` — no new bespoke combobox, no
duplicated search logic. Short fixed-list selects (Category, Yield Unit, Shelf
Life, °F/°C) stay as plain `<Select>` (confirmed with requester: inventory
dropdowns only).

## Approach

### 1. Reuse `SearchableProductSelector` in both prep dropdowns

Replace each `<Select>…</Select>` block that selects a `Product` with:

```tsx
<SearchableProductSelector
  value={...}
  onValueChange={...}
  products={products}
  showSkipOption={false}
  showCreateOption={false}
  placeholder="Search inventory items..."
  id={...}          // Output Item only, to preserve <Label htmlFor>
  aria-label={...}   // accessible name for the trigger
/>
```

- **Ingredient row:** `value={ingredient.product_id}`,
  `onValueChange={(value) => handleIngredientChange(index, 'product_id', value)}`,
  `aria-label={`Ingredient ${index + 1}`}` (the "Ingredient" column header is a
  `hidden md:grid` `<div>`, not a `<label>`, so the trigger needs its own name).
- **Output Item:** `value={formValues.output_product_id || ''}`,
  `onValueChange={(value) => setFormValues({ ...formValues, output_product_id: value || undefined })}`,
  `id="output"` so the existing `<Label htmlFor="output">Output Item</Label>`
  stays associated, plus `aria-label="Output Item"`.

The prep modal has **no** create-new-product flow, so neither `onCreateNew` nor
the "Skip" action is wired.

### 1a. Forward `id` + `aria-label` from `SearchableProductSelector` to its trigger

**(Fixes the Phase 2.5 critical finding.)** The selector's trigger `<Button>`
today accepts no `id`/`aria-label`, so a `<Label htmlFor>` pointing at the old
`<Select id="output">` would become orphaned after the swap (WCAG 3.3.2 / the
CLAUDE.md "form inputs need associated labels" rule). Add optional `id?: string`
and `'aria-label'?: string` props to `SearchableProductSelectorProps` and spread
them onto the trigger `<Button>`. Existing consumers pass neither, so their
behavior is unchanged.

### 2. Add a `showCreateOption` prop to `SearchableProductSelector`

Today the "+ Create New Item" action is rendered unconditionally. The prep modal
must not show it (there's nowhere to create a product from here, and selecting it
would set an invalid `'new_item'` id).

**Why not couple to `onCreateNew` presence:** `ReceiptItemRow` deliberately uses
the create action *without* passing `onCreateNew` — it reads the resulting
`'new_item'` value back through `onValueChange` to drive its
`mapping_status === 'new_item'` branch. Hiding the action whenever `onCreateNew`
is absent would silently regress the receipt-mapping flow.

**Chosen implementation:** add an explicit, symmetric prop
`showCreateOption?: boolean` (default `true`), mirroring the existing
`showSkipOption`. Existing call sites keep the default and are unchanged; the
prep modal passes `showCreateOption={false}`.

The "Actions" `CommandGroup` renders only when at least one of the create/skip
actions is enabled, so with both off the prep dropdown shows just the search
input + the existing-products list (and the `CommandEmpty` state).

## Files changed

| File | Change |
|---|---|
| `src/components/SearchableProductSelector.tsx` | Add `showCreateOption` prop (default `true`); gate the create action + the whole Actions group on it. Add optional `id` + `aria-label` props forwarded to the trigger `<Button>`. |
| `src/components/prep/EnhancedPrepRecipeDialog.tsx` | Replace the two product `<Select>` blocks with `SearchableProductSelector`; drop now-unused `Select*` imports if no longer used elsewhere in the file. |

No DB / RPC / edge-function / RLS changes. No new dependencies (Fuse.js already a
dep via the selector).

## Three-state / a11y notes

- The dialog already receives `products` from `PrepRecipesEnhanced`; loading/empty
  handling of that list is unchanged. Empty inventory → `CommandEmpty`
  ("No products found").
- `SearchableProductSelector` renders a `role="combobox"` button with
  `aria-expanded`, keyboard-navigable via cmdk — an accessibility improvement
  over the current `<Select>` for long lists **once each trigger has an
  accessible name** (see §1/§1a): Output Item keeps its `<Label htmlFor>` via the
  forwarded `id`; each Ingredient row gets `aria-label="Ingredient N"`.
- Selected value display: the trigger shows the product name (existing selector
  behavior), matching prior UX.
- **Pre-existing dialog styling divergence (not introduced here):** the
  `EnhancedPrepRecipeDialog` shell already diverges from CLAUDE.md's documented
  Dialog Structure (title `text-xl md:text-2xl`, `h-[95dvh] w-[98vw]` sizing,
  colored icon box). This change does not touch or "bless" that; it only swaps
  the two product controls. Realigning the whole dialog to the Apple/Notion
  scale is out of scope.

## Testing

- **Unit (`SearchableProductSelector`):** new test asserting that with
  `showCreateOption={false}` the "+ Create New Item" item is not rendered, and
  that it *is* rendered by default (guard against regressing Receipt/Recipe
  flows). Existing consumers already cover the default-on path indirectly; add
  the explicit off/on assertions.
- **Unit (`EnhancedPrepRecipeDialog`):** render the dialog, open the Ingredient
  combobox, type a query, assert filtering narrows the list and selecting an
  item updates the row (`product_id`). Verify Output Item likewise. Assert the
  create/skip actions are absent. Assert accessible names:
  `getByRole('combobox', { name: /output item/i })` and
  `getByRole('combobox', { name: /ingredient 1/i })` (covers the §1a
  label-association fix).
- Full Phase 8 gate: `npm run test`, `typecheck`, `lint`, `build`.

## Decided trade-offs

- **Explicit `showCreateOption` prop vs. inferring from `onCreateNew`:** chosen
  explicit prop to avoid regressing `ReceiptItemRow` (see §2). Symmetric with the
  existing `showSkipOption` prop, so the component API stays consistent.
- **Output Item has no "clear" affordance:** parity with the current `<Select>`,
  which also can't be un-picked once set. Out of scope.
- **Per-row Fuse index (Phase 2.5 major, accepted):** each ingredient row mounts
  its own `SearchableProductSelector`, each building a component-local Fuse index
  over the full `products` array. This is the **already-established pattern** —
  `RecipeIngredientItem` mounts one selector per ingredient row identically. Prep
  recipes have a handful of ingredient rows, so N is small; the index is memoized
  per row and only rebuilds when `products` changes. Not optimizing here would
  keep the shared component simple and consistent; a shared-index refactor, if
  ever wanted, belongs in `SearchableProductSelector` itself and would benefit all
  consumers, so it's out of scope for this change.
