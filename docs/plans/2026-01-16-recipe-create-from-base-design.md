# Recipe Create From Base Design

## Context
Users think in variations, not duplication. The UX should frame reuse and confidence, not copying. Copying is a starting point, never a silent action. This design aligns with Apple/Notion patterns: calm, obvious, reversible.

## Goals
- Keep blank recipe creation the fastest path.
- Make reuse intentional with a clear confirmation step.
- Prevent accidental inheritance (name, price, POS mapping).
- Teach the recipe model through the reuse checklist.
- Favor warnings and guidance over blocking.

## Non-Goals
- Full template library (placeholder only).
- Detach-from-base lineage management.
- Automated price setting or enforced margins.

## UX Principles
- Language: "Create from existing recipe" / "Use as base" / "Create variation."
- Two intentional entry points:
  - Primary split button in Recipes header.
  - Contextual "Create variation" inside the recipe editor (and row action menu).
- Warnings > impacts > suggestions.
- No icon-only copy buttons, no bulk-copy for first exposure, no auto-copy.

## Flow
1. Primary entry (Recipes header):
   - Main button: Create blank recipe immediately.
   - Dropdown: "From Existing Recipe" and disabled "From Template (soon)."
2. Contextual entry:
   - "Create variation" in recipe editor and row actions menu.
3. Step 1 chooser (modal):
   - Search + filter list.
   - Each row shows name, cost, margin, warnings (missing conversions, no ingredients).
   - Clicking a row advances to Step 2.
4. Step 2 intent confirmation:
   - "What do you want to reuse?"
   - Default checked: Ingredients, Conversions, Serving size, Tax assumptions.
   - Default unchecked: Name, Sale price, POS mapping.
   - Name required and must differ from base.
5. Editor:
   - Banner: "Based on {Base Recipe}" with optional "Change base."
   - Inline name validation prevents duplicate names.

## Components & Data Flow
- `src/pages/Recipes.tsx`:
  - Replace single "Create Recipe" button with split button.
  - Add "Create variation" to row actions.
- New `RecipeCreateFromExistingDialog`:
  - Step 1 chooser + Step 2 intent confirmation.
  - Uses `useRecipes` data; loads ingredients via `fetchRecipeIngredients`.
- `RecipeDialog`:
  - Add optional `prefill` and `basedOn` props.
  - Apply `prefill` to default values and show base banner.
- Helper: `buildRecipePrefill(baseRecipe, ingredients, reuseOptions)`.

## Error Handling & Feedback
- Chooser load failure: neutral empty state with "Retry" and "Create blank recipe."
- Ingredient fetch failure: auto-uncheck Ingredients/Conversions and allow proceed.
- Warnings shown inline; creation never blocked.
- Server errors use existing toast pattern.

## Pricing Guidance (Future)
- Show suggested price range only after cost is computable.
- Inline, advisory, with rationale (food cost %, tax, comparable items).
- Pricing mode lives in Settings, not the recipe form.

## Testing
- Unit tests for `buildRecipePrefill` (only selected fields included).
- UI tests:
  - Main button creates blank recipe without chooser.
  - Dropdown opens chooser; selection -> intent confirmation -> editor with banner.
  - Row action "Create variation" opens chooser with base preselected.
- Manual checklist:
  - Name required and not identical to base.
  - Warnings visible but non-blocking.
  - Ingredient fetch failure still allows creation.

## Success Criteria
- Fast blank creation remains 1 click.
- Reuse is deliberate and reversible.
- Users avoid duplicate names by default.
- Feels calm, obvious, and reversible on iPad in a noisy kitchen.
