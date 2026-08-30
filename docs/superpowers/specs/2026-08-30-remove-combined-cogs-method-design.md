# Design: Delete the 'combined' COGS method

Date: 2026-08-30
Branch: `claude/angry-shirley-1fe1ad`
Status: Draft for design review

## Problem

The dashboard shows an inflated COGS number for restaurants with the
`combined` method. The `combined` case adds the two sources:
`totalCOGS = inventoryCosts.totalCost + financialCosts.totalCost`
(src/hooks/useUnifiedCOGS.tsx:63). The inventory source counts
consumption (`transaction_type = 'usage'`, src/hooks/useFoodCosts.tsx:44).
The financials source counts purchases (bank transactions, splits, and
pending outflows, src/hooks/useCOGSFromFinancials.tsx:52-121). A purchase
becomes consumption over time. The sum counts the same goods twice.

`useMonthlyMetrics` repeats the same pattern. It adds inventory COGS and
financial COGS to the same `food_cost` bucket when the method is
`combined` (src/hooks/useMonthlyMetrics.tsx:508-522).

## Option A evaluation: true accrual COGS

Option A redefines `combined` as: purchases + (beginning inventory −
ending inventory). This formula needs the inventory value at two past
dates.

The codebase has no inventory valuation history:

- `get_inventory_valuation` computes only the current value from
  `products.current_stock * cost_per_unit`
  (supabase/migrations/20260814145000_get_inventory_valuation.sql:6).
  It has no date parameter.
- No table stores valuation snapshots. A search of `supabase/migrations/`
  for snapshot or history tables found only per-run production cost
  snapshots (`total_cost_snapshot` in
  supabase/migrations/20251229130000_refactor_complete_production_runs.sql:286).
  Those are not period valuations.

**Conclusion: Option A is not possible today.** Per the task instruction,
fall back to Option B.

## Decision: Option B — delete the 'combined' option

Delete `combined` from the type, the orchestrator, the monthly metrics
hook, the settings UI, and the database constraint. Migrate existing
`combined` rows to a single source.

## Production data

One production restaurant has `cogs_calculation_method = 'combined'`
(query against `restaurant_financial_settings`, 2026-08-30). That
restaurant has inventory `usage` transactions and bank transactions.

## Replacement value for migrated rows

Rule: a restaurant with inventory `usage` transactions gets `inventory`.
A restaurant without them gets `financials`.

Rationale: consumption-based COGS is the more accurate method when the
restaurant logs usage. Without usage data, the inventory source returns
zero, so `financials` is the only source with data. The one production
`combined` restaurant has usage data, so it becomes `inventory`.

## Changes

### 1. Shared normalization helper (new)

File: `src/lib/cogsMethod.ts` (new). Export:

```typescript
export type COGSMethod = 'inventory' | 'financials';
export function normalizeCOGSMethod(value: string | null | undefined): COGSMethod;
```

`normalizeCOGSMethod` returns `financials` for `'financials'`. It returns
`inventory` for every other input, including the legacy `'combined'`,
`null`, and unknown strings. `inventory` is the system default
(supabase/migrations/20260303200001_create_restaurant_financial_settings.sql:5,
src/hooks/useFinancialSettings.tsx:121).

This client-side fallback is defensive only. It covers the window where
the client is new and the database row still holds `combined`. The
migration removes such rows. The generated row type is `string`
(src/integrations/supabase/types.ts:5781), so the helper is also the
single cast point.

### 2. `src/hooks/useFinancialSettings.tsx`

- Re-export `COGSMethod` from `src/lib/cogsMethod.ts`. The type narrows
  to `'inventory' | 'financials'` (currently three values at
  src/hooks/useFinancialSettings.tsx:7).
- `cogsMethod` return value: `normalizeCOGSMethod(settings?.cogs_calculation_method)`
  (currently `?? 'inventory'` at src/hooks/useFinancialSettings.tsx:121).
- `updateSettings` keeps its signature; the narrowed type now rejects
  `combined` at compile time.

### 3. `src/hooks/useUnifiedCOGS.tsx`

- Delete the `case 'combined'` block (src/hooks/useUnifiedCOGS.tsx:62-78).
- Replace the switch with: `financials` selects the financial source;
  every other value selects the inventory source. This keeps a total
  function over the narrowed type.
- Keep `breakdown` unchanged; it always exposes both sources
  (src/hooks/useUnifiedCOGS.tsx:84-87) and the settings info box uses it
  (src/components/settings/COGSPreferenceSettings.tsx:61-65).

### 4. `src/hooks/useMonthlyMetrics.tsx`

- Normalize the raw setting with `normalizeCOGSMethod`
  (currently `(settingsData?.cogs_calculation_method as string) || 'inventory'`
  at src/hooks/useMonthlyMetrics.tsx:260).
- Delete the four `|| cogsMethod === 'combined'` branches
  (src/hooks/useMonthlyMetrics.tsx:264, 280, 508, 517). Each guard
  becomes a single equality test.

### 5. `src/components/settings/COGSPreferenceSettings.tsx`

- Delete the `combined` entry from `COGS_OPTIONS`
  (src/components/settings/COGSPreferenceSettings.tsx:34-39).
- Update the copy so each option states what it computes:
  - `inventory` → label "Inventory (consumption)", description
    "Computes COGS from inventory usage: the cost of ingredients that
    your recipes consume."
  - `financials` → label "Financials (purchases)", description
    "Computes COGS from purchases: bank transactions, splits, and
    pending outflows in COGS categories."
- The skeleton block renders three placeholders
  (src/components/settings/COGSPreferenceSettings.tsx:78-81); reduce to
  two.

### 6. Database migration (new)

File: `supabase/migrations/<timestamp>_remove_combined_cogs_method.sql`.

```sql
-- Step 1: migrate existing rows before the constraint tightens.
UPDATE restaurant_financial_settings s
SET cogs_calculation_method = CASE
  WHEN EXISTS (
    SELECT 1 FROM inventory_transactions it
    WHERE it.restaurant_id = s.restaurant_id
      AND it.transaction_type = 'usage'
  ) THEN 'inventory'
  ELSE 'financials'
END
WHERE s.cogs_calculation_method = 'combined';

-- Step 2: tighten the CHECK constraint.
ALTER TABLE restaurant_financial_settings
  DROP CONSTRAINT IF EXISTS restaurant_financial_settings_cogs_calculation_method_check;
ALTER TABLE restaurant_financial_settings
  ADD CONSTRAINT restaurant_financial_settings_cogs_calculation_method_check
  CHECK (cogs_calculation_method IN ('inventory', 'financials'));
```

The original constraint is an unnamed inline CHECK
(supabase/migrations/20260303200001_create_restaurant_financial_settings.sql:5-6),
so Postgres assigned the default name
`restaurant_financial_settings_cogs_calculation_method_check`.
The migration verifies the drop with `IF EXISTS` and re-adds under the
same name.

### 7. Tests

Unit (`tests/unit/`):
- New `cogsMethod.test.ts`: `normalizeCOGSMethod` maps `'inventory'`,
  `'financials'`, `'combined'`, `null`, `undefined`, and garbage.
- Update `useUnifiedCOGS.test.ts`: delete the four `combined` tests
  (tests/unit/useUnifiedCOGS.test.ts:132, 148, 199, 352). Add one test:
  the hook never adds the two sources.
- Update `useFinancialSettings.test.ts`: replace `combined` fixtures
  (tests/unit/useFinancialSettings.test.ts:118, 130, 135, 232) with
  `financials`. Add one test: a DB row with `combined` normalizes to
  `inventory`.

pgTAP (`supabase/tests/restaurant_financial_settings.test.sql`):
- Replace the `combined` inserts and update
  (lines 162, 174, 216) with `financials`.
- Add one test: the CHECK constraint now rejects `combined`.
- Adjust `plan(N)`.

E2E (`tests/e2e/`):
- New `cogs-settings.spec.ts`: sign in, open restaurant settings, check
  the COGS card shows exactly two options and no "Combined" option,
  select "Financials (purchases)", check the persisted state after a
  reload.

## Impact on consumers

`useUnifiedCOGS` consumers read `totalCOGS` only and have no `combined`
branch: src/pages/BudgetRunRate.tsx:44, src/pages/Index.tsx:274,
src/components/financial-statements/IncomeStatement.tsx:174,
src/hooks/useCostsFromSource.tsx:58. No change needed there.

`combineCosts.ts` deduplicates labor, not COGS
(src/lib/combineCosts.ts:53-94). No change needed.

## Decided trade-offs

- The client fallback (`inventory`) and the migration rule (data-driven)
  can disagree for a restaurant without usage data during the deploy
  window. The window is short and the migration is the durable fix.
- No E2E for the migrated-value path: pgTAP cannot insert `combined`
  after the constraint tightens, so the UPDATE step is verified by
  review and by the constraint test.
