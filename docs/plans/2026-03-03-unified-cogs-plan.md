# Unified COGS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify COGS calculation across all surfaces (dashboard, P&L, break-even) with a per-restaurant preference setting (inventory, financials, or combined).

**Architecture:** New `useUnifiedCOGS` orchestrator hook reads a per-restaurant preference from `restaurant_financial_settings` and delegates to either the existing `useFoodCosts` (inventory), a new `useCOGSFromFinancials` (bank transactions + expenses), or both. All surfaces consume this single hook.

**Tech Stack:** React Query hooks (TypeScript), Supabase PostgreSQL (migrations + RLS + pgTAP), Vitest (unit tests), shadcn/ui (settings UI)

**Design Doc:** `docs/plans/2026-03-03-unified-cogs-design.md`

---

### Task 1: Database Migration — `restaurant_financial_settings` Table

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_create_restaurant_financial_settings.sql`

**Step 1: Write the migration**

```sql
-- Create restaurant_financial_settings table
CREATE TABLE public.restaurant_financial_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  cogs_calculation_method TEXT NOT NULL DEFAULT 'inventory'
    CHECK (cogs_calculation_method IN ('inventory', 'financials', 'combined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_financial_settings_restaurant_id_key UNIQUE (restaurant_id)
);

-- Enable RLS
ALTER TABLE public.restaurant_financial_settings ENABLE ROW LEVEL SECURITY;

-- View policy: all restaurant members can view
CREATE POLICY "Users can view financial settings for their restaurants"
  ON public.restaurant_financial_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = restaurant_financial_settings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- Manage policy: owners and managers only
CREATE POLICY "Owners and managers can manage financial settings"
  ON public.restaurant_financial_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = restaurant_financial_settings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_restaurant_financial_settings_updated_at
  BEFORE UPDATE ON public.restaurant_financial_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

**Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: Migration applies without errors.

**Step 3: Commit**

```bash
git add supabase/migrations/*_create_restaurant_financial_settings.sql
git commit -m "feat: add restaurant_financial_settings table for COGS preference"
```

---

### Task 2: pgTAP Tests — `restaurant_financial_settings`

**Files:**
- Create: `supabase/tests/restaurant_financial_settings.test.sql`

**Step 1: Write the pgTAP tests**

Test the following:
- Table exists with expected columns
- Default value for `cogs_calculation_method` is `'inventory'`
- CHECK constraint rejects invalid values (e.g., `'invalid_method'`)
- UNIQUE constraint on `restaurant_id` prevents duplicates
- RLS: restaurant member can SELECT their own settings
- RLS: non-member cannot SELECT another restaurant's settings
- RLS: owner/manager can INSERT/UPDATE settings
- RLS: staff role cannot INSERT/UPDATE settings

Follow the pattern in existing pgTAP tests (e.g., `supabase/tests/deleted_bank_transactions.test.sql`). Use `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`.

**Step 2: Run pgTAP tests**

Run: `npm run test:db`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add supabase/tests/restaurant_financial_settings.test.sql
git commit -m "test: pgTAP tests for restaurant_financial_settings table"
```

---

### Task 3: `useFinancialSettings` Hook

**Files:**
- Create: `src/hooks/useFinancialSettings.tsx`
- Create: `tests/unit/useFinancialSettings.test.ts`

**Step 1: Write failing tests**

Test cases:
1. Returns default `'inventory'` when no settings exist (auto-creates row)
2. Returns stored method when settings exist
3. `updateSettings()` updates the method and returns new value
4. Loading state while fetching
5. Returns `null` when `restaurantId` is undefined

Mock Supabase client using the same patterns as other hook tests in `tests/unit/`.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useFinancialSettings.test.ts`
Expected: FAIL — hook doesn't exist yet.

**Step 3: Implement `useFinancialSettings`**

Follow the pattern from `src/hooks/useInventorySettings.tsx` (138 lines):

```typescript
// src/hooks/useFinancialSettings.tsx
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export type COGSMethod = 'inventory' | 'financials' | 'combined';

export interface FinancialSettings {
  id: string;
  restaurant_id: string;
  cogs_calculation_method: COGSMethod;
}

export interface UseFinancialSettingsReturn {
  settings: FinancialSettings | null;
  cogsMethod: COGSMethod;
  isLoading: boolean;
  updateSettings: (updates: Partial<Pick<FinancialSettings, 'cogs_calculation_method'>>) => Promise<void>;
}

export function useFinancialSettings(restaurantId: string | undefined): UseFinancialSettingsReturn {
  // Pattern: useState for settings + loading
  // fetchSettings() with auto-create if not found (maybeSingle → insert if null)
  // updateSettings() with toast feedback
  // useEffect on restaurantId change
  // Default cogsMethod = settings?.cogs_calculation_method ?? 'inventory'
}
```

Key implementation notes:
- Query: `supabase.from('restaurant_financial_settings').select('*').eq('restaurant_id', restaurantId).maybeSingle()`
- Auto-create: If data is null, insert `{ restaurant_id: restaurantId, cogs_calculation_method: 'inventory' }` and use the returned row
- Update: `supabase.from('restaurant_financial_settings').update({ ...updates, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId)`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useFinancialSettings.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/hooks/useFinancialSettings.tsx tests/unit/useFinancialSettings.test.ts
git commit -m "feat: useFinancialSettings hook with auto-create defaults"
```

---

### Task 4: `useCOGSFromFinancials` Hook

**Files:**
- Create: `src/hooks/useCOGSFromFinancials.tsx`
- Create: `tests/unit/useCOGSFromFinancials.test.ts`
- Reference: `src/lib/expenseDataFetcher.ts` (query patterns), `src/lib/expenseCategoryUtils.ts:173-178` (COGS subtypes)

**Step 1: Write failing tests**

Test cases:
1. Returns 0 COGS when no transactions are categorized as COGS
2. Sums bank transactions categorized under COGS subtypes (food_cost, beverage_cost, packaging_cost, cost_of_goods_sold)
3. Uses `Math.abs()` on amounts (bank outflows are negative)
4. Includes split transaction line items (where parent `is_split = true`)
5. Does NOT double-count split parents (parent `is_split = true` should be excluded)
6. Includes pending outflows categorized as COGS (where `linked_bank_transaction_id IS NULL`)
7. Excludes transfer transactions (`is_transfer = true`)
8. Returns daily aggregation by `transaction_date`
9. Filters by date range correctly

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useCOGSFromFinancials.test.ts`
Expected: FAIL.

**Step 3: Implement `useCOGSFromFinancials`**

```typescript
// src/hooks/useCOGSFromFinancials.tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const COGS_SUBTYPES = ['food_cost', 'cost_of_goods_sold', 'beverage_cost', 'packaging_cost'];

export interface FinancialCOGSData {
  date: string;
  amount: number; // positive number
  source: 'bank_transaction' | 'pending_outflow';
}

export interface FinancialCOGSResult {
  dailyCosts: FinancialCOGSData[];
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
}

export function useCOGSFromFinancials(
  restaurantId: string | undefined,
  startDate: string,
  endDate: string
): FinancialCOGSResult {
  // Query pattern (3 parallel queries, following expenseDataFetcher.ts):
  //
  // 1. Bank transactions (non-split):
  //    from('bank_transactions')
  //    .select('id, transaction_date, amount, is_split, chart_of_accounts!category_id(account_subtype)')
  //    .eq('restaurant_id', restaurantId)
  //    .in('status', ['posted', 'pending'])
  //    .eq('is_transfer', false)
  //    .eq('is_split', false)
  //    .lt('amount', 0)  // outflows only
  //    .gte('transaction_date', startDate)
  //    .lte('transaction_date', endDate)
  //    Then filter client-side: chart_of_accounts.account_subtype IN COGS_SUBTYPES
  //
  // 2. Split line items (for split parents):
  //    First get split parent IDs:
  //    from('bank_transactions').select('id').eq('is_split', true).eq('restaurant_id', restaurantId)...
  //    Then: from('bank_transaction_splits')
  //    .select('transaction_id, amount, chart_of_accounts!category_id(account_subtype)')
  //    .in('transaction_id', splitParentIds)
  //    Filter: account_subtype IN COGS_SUBTYPES
  //    Need transaction_date from parent — join or fetch separately
  //
  // 3. Pending outflows:
  //    from('pending_outflows')
  //    .select('id, issue_date, amount, chart_of_accounts!category_id(account_subtype)')
  //    .eq('restaurant_id', restaurantId)
  //    .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
  //    .is('linked_bank_transaction_id', null)
  //    .gte('issue_date', startDate)
  //    .lte('issue_date', endDate)
  //    Filter: account_subtype IN COGS_SUBTYPES
  //
  // Aggregate all by date, use Math.abs() on amounts.
  // Return { dailyCosts, totalCost, isLoading, error }
}
```

Use React Query with queryKey `['cogs-financials', restaurantId, startDate, endDate]` and `staleTime: 30000`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useCOGSFromFinancials.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/hooks/useCOGSFromFinancials.tsx tests/unit/useCOGSFromFinancials.test.ts
git commit -m "feat: useCOGSFromFinancials hook — bank transactions + expenses as COGS"
```

---

### Task 5: `useUnifiedCOGS` Orchestrator Hook

**Files:**
- Create: `src/hooks/useUnifiedCOGS.tsx`
- Create: `tests/unit/useUnifiedCOGS.test.ts`
- Reference: `src/hooks/useFoodCosts.tsx` (inventory source), `src/hooks/useCOGSFromFinancials.tsx` (financials source), `src/hooks/useFinancialSettings.tsx` (preference)

**Step 1: Write failing tests**

Test cases:
1. When method is `'inventory'`, returns only inventory COGS (from useFoodCosts)
2. When method is `'financials'`, returns only financial COGS (from useCOGSFromFinancials)
3. When method is `'combined'`, returns sum of both sources
4. `breakdown` always shows both values regardless of method
5. `method` field matches the current setting
6. Loading is true while any source is loading
7. Error propagates from either source

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useUnifiedCOGS.test.ts`
Expected: FAIL.

**Step 3: Implement `useUnifiedCOGS`**

```typescript
// src/hooks/useUnifiedCOGS.tsx
import { useMemo } from 'react';
import { useFoodCosts } from '@/hooks/useFoodCosts';
import { useCOGSFromFinancials } from '@/hooks/useCOGSFromFinancials';
import { useFinancialSettings, COGSMethod } from '@/hooks/useFinancialSettings';

export interface UnifiedCOGSResult {
  totalCOGS: number;
  dailyCOGS: { date: string; amount: number; source: 'inventory' | 'financials' }[];
  breakdown: { inventory: number; financials: number };
  method: COGSMethod;
  isLoading: boolean;
  error: Error | null;
}

export function useUnifiedCOGS(
  restaurantId: string | undefined,
  startDate: string,
  endDate: string
): UnifiedCOGSResult {
  const { cogsMethod, isLoading: settingsLoading } = useFinancialSettings(restaurantId);
  const inventoryCosts = useFoodCosts(restaurantId, startDate, endDate);
  const financialCosts = useCOGSFromFinancials(restaurantId, startDate, endDate);

  // Both hooks always run (React hooks can't be conditional),
  // but we only use the data based on the method.

  return useMemo(() => {
    const inventoryTotal = inventoryCosts.totalCost ?? 0;
    const financialsTotal = financialCosts.totalCost ?? 0;

    let totalCOGS: number;
    let dailyCOGS: { date: string; amount: number; source: 'inventory' | 'financials' }[];

    switch (cogsMethod) {
      case 'inventory':
        totalCOGS = inventoryTotal;
        dailyCOGS = (inventoryCosts.dailyCosts ?? []).map(d => ({
          date: d.date, amount: d.total_cost, source: 'inventory' as const
        }));
        break;
      case 'financials':
        totalCOGS = financialsTotal;
        dailyCOGS = (financialCosts.dailyCosts ?? []).map(d => ({
          date: d.date, amount: d.amount, source: 'financials' as const
        }));
        break;
      case 'combined':
        totalCOGS = inventoryTotal + financialsTotal;
        // Merge daily data from both sources
        dailyCOGS = [
          ...(inventoryCosts.dailyCosts ?? []).map(d => ({
            date: d.date, amount: d.total_cost, source: 'inventory' as const
          })),
          ...(financialCosts.dailyCosts ?? []).map(d => ({
            date: d.date, amount: d.amount, source: 'financials' as const
          })),
        ];
        break;
    }

    return {
      totalCOGS,
      dailyCOGS,
      breakdown: { inventory: inventoryTotal, financials: financialsTotal },
      method: cogsMethod,
      isLoading: settingsLoading || inventoryCosts.isLoading || financialCosts.isLoading,
      error: inventoryCosts.error || financialCosts.error || null,
    };
  }, [cogsMethod, inventoryCosts, financialCosts, settingsLoading]);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useUnifiedCOGS.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/hooks/useUnifiedCOGS.tsx tests/unit/useUnifiedCOGS.test.ts
git commit -m "feat: useUnifiedCOGS orchestrator hook — single COGS source of truth"
```

---

### Task 6: Wire `useCostsFromSource` to Use `useUnifiedCOGS`

**Files:**
- Modify: `src/hooks/useCostsFromSource.tsx` (line ~50 where `useFoodCosts` is called)
- Modify: `tests/unit/useCostsFromSource.test.ts` (if exists, update mocks)

**Step 1: Update useCostsFromSource**

In `src/hooks/useCostsFromSource.tsx`:

- Replace the `useFoodCosts()` call (line ~50) with `useUnifiedCOGS()`
- The hook currently destructures `{ dailyCosts: foodCosts, totalCost: totalFoodCost }` from useFoodCosts
- Change to destructure `{ dailyCOGS, totalCOGS, breakdown, method }` from useUnifiedCOGS
- Map `dailyCOGS` into the existing `DailyCostData` structure (the `food_cost` field gets the unified COGS value)
- The rest of the hook (labor cost merging) stays unchanged

**Important**: `useFoodCosts` takes `(restaurantId, startDate, endDate)` — check if `useCostsFromSource` passes these params. If it currently relies on `useFoodCosts` defaulting dates internally, we need to thread start/end dates through.

Check `useFoodCosts` signature: it takes `(restaurantId: string | undefined, startDate?: string, endDate?: string)`. Check how `useCostsFromSource` calls it and match `useUnifiedCOGS`'s required params.

**Step 2: Run existing tests**

Run: `npx vitest run tests/unit/ --grep "costsFromSource"`
Expected: Tests pass with updated mock structure.

**Step 3: Commit**

```bash
git add src/hooks/useCostsFromSource.tsx
git commit -m "feat: wire useCostsFromSource to useUnifiedCOGS for dashboard metrics"
```

---

### Task 7: Update Income Statement to Use `useUnifiedCOGS`

**Files:**
- Modify: `src/components/financial-statements/IncomeStatement.tsx` (lines ~34-54 `mergeInventoryCOGS`, lines ~153-182 inventory COGS query)

**Step 1: Understand the current logic**

The Income Statement currently:
1. Queries `journal_entry_lines` for accounts with `account_type = 'cogs'` (journaled COGS)
2. Separately queries `inventory_transactions` where `transaction_type = 'usage'` (inventory COGS)
3. Calls `mergeInventoryCOGS()` which adds inventory usage ONLY if no journaled COGS exists

**Step 2: Replace with useUnifiedCOGS**

- Import `useUnifiedCOGS`
- Call it with the Income Statement's date range
- Replace the `mergeInventoryCOGS` logic:
  - Instead of querying inventory_transactions separately (lines ~154-161), use `useUnifiedCOGS.totalCOGS`
  - The COGS section of the Income Statement should show the unified number
  - If method is `'combined'`, optionally show the breakdown (inventory vs financials) as sub-lines
- Remove the `mergeInventoryCOGS` helper function (lines 34-54) — no longer needed
- Remove the inventory_transactions query (lines 153-161) — `useUnifiedCOGS` handles this

**Step 3: Test manually**

Run: `npm run dev`
Navigate to Financial Statements > Income Statement
Verify: COGS section shows the correct number matching the dashboard

**Step 4: Commit**

```bash
git add src/components/financial-statements/IncomeStatement.tsx
git commit -m "feat: Income Statement uses useUnifiedCOGS for consistent COGS"
```

---

### Task 8: Settings UI — Financial Preferences Section

**Files:**
- Create: `src/components/settings/COGSPreferenceSettings.tsx`
- Modify: `src/pages/RestaurantSettings.tsx` (add Financial tab, ~line 427)

**Step 1: Create the COGSPreferenceSettings component**

Follow Apple/Notion styling from CLAUDE.md:

```typescript
// src/components/settings/COGSPreferenceSettings.tsx
// Props: { restaurantId: string }
// Uses: useFinancialSettings(restaurantId), useUnifiedCOGS for preview numbers
//
// Layout:
// - Section header: "COGS CALCULATION METHOD" (text-[12px] uppercase tracking-wider)
// - Description: "How should we calculate Cost of Goods Sold?"
// - RadioGroup with 3 options:
//   - "Inventory (real-time)" — description: "Uses recipe consumption data..."
//   - "Financials (bank transactions & expenses)" — description: "Uses transactions categorized as COGS..."
//   - "Combined" — description: "Sums both sources..."
// - Info box (rounded-lg bg-muted/30 border border-border/40):
//   - "Currently using: {method}"
//   - "Inventory COGS (this period): ${inventoryTotal}"
//   - "Financial COGS (this period): ${financialsTotal}"
//
// On radio change: call updateSettings({ cogs_calculation_method: newValue })
// Use shadcn RadioGroup component
// Use date range: first day of current month → today
```

**Step 2: Add Financial tab to RestaurantSettings**

In `src/pages/RestaurantSettings.tsx`:
- Add `financial` TabsTrigger after `subscription` (around line 427), with DollarSign icon from lucide-react
- Add `financial` TabsContent section that renders `<COGSPreferenceSettings restaurantId={...} />`

**Step 3: Test manually**

Run: `npm run dev`
Navigate to Restaurant Settings > Financial tab
Verify: Radio buttons work, info box shows current values, switching modes updates the preference

**Step 4: Commit**

```bash
git add src/components/settings/COGSPreferenceSettings.tsx src/pages/RestaurantSettings.tsx
git commit -m "feat: COGS preference settings UI in restaurant settings"
```

---

### Task 9: Break-Even Chart — Actual COGS Overlay

**Files:**
- Modify: `src/hooks/useBreakEvenAnalysis.tsx` (add actual COGS % to return data)
- Modify: `src/components/budget/SalesVsBreakEvenChart.tsx` (add overlay line)
- Reference: `src/lib/breakEvenCalculator.ts` (break-even formula stays unchanged)

**Step 1: Extend useBreakEvenAnalysis return data**

In `src/hooks/useBreakEvenAnalysis.tsx`:
- Import `useUnifiedCOGS`
- Call it with the same date range used for break-even analysis
- Add to the return data: `actualCOGSPercentage: (totalCOGS / totalRevenue) * 100`
- Add to the daily history: `actualCOGS` field per day (from `useUnifiedCOGS.dailyCOGS`)
- The break-even formula itself stays unchanged (still uses operating_costs percentages)

**Step 2: Add overlay to SalesVsBreakEvenChart**

In `src/components/budget/SalesVsBreakEvenChart.tsx`:
- Add a second ReferenceLine (dashed, different color) showing actual COGS % if available
- Or: add a Line component overlay showing daily actual COGS
- Add to the summary stats: "Actual Food Cost: X%" next to the existing metrics
- Use a muted/subtle color so it doesn't overwhelm the primary break-even visualization

**Step 3: Test manually**

Run: `npm run dev`
Navigate to Budget page > Break-Even chart
Verify: Chart shows both the break-even line (projected) and actual COGS overlay

**Step 4: Commit**

```bash
git add src/hooks/useBreakEvenAnalysis.tsx src/components/budget/SalesVsBreakEvenChart.tsx
git commit -m "feat: break-even chart shows actual COGS % overlay vs projected"
```

---

### Task 10: Regenerate TypeScript Types

**Step 1: Regenerate types**

Use the `sync-types` skill to regenerate Supabase TypeScript types from the updated database schema.

**Step 2: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore: regenerate Supabase types for restaurant_financial_settings"
```

---

### Task 11: Final Verification

**Step 1: Run all unit tests**

Run: `npm run test`
Expected: All pass.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new errors introduced (pre-existing errors are OK per MEMORY.md — 3400+).

**Step 3: Run build**

Run: `npm run build`
Expected: Builds successfully.

**Step 4: Run pgTAP tests**

Run: `npm run test:db`
Expected: All pass.

**Step 5: Manual smoke test**

Run: `npm run dev`
Test these scenarios:
1. Dashboard shows food cost % — change COGS method in settings, verify number changes
2. Income Statement COGS section matches dashboard number
3. Break-even chart shows actual COGS overlay
4. New restaurant with no data — defaults to 'inventory', shows $0
5. Restaurant with only bank data — switch to 'financials', verify COGS appears

**Step 6: Final commit if any cleanup needed**

---

## Dependency Order

```
Task 1 (migration) → Task 2 (pgTAP)
Task 1 → Task 10 (types) → Task 3 (useFinancialSettings)
Task 3 → Task 4 (useCOGSFromFinancials)
Task 3 + Task 4 → Task 5 (useUnifiedCOGS)
Task 5 → Task 6 (wire useCostsFromSource)
Task 5 → Task 7 (Income Statement)
Task 3 + Task 5 → Task 8 (Settings UI)
Task 5 → Task 9 (Break-even overlay)
All → Task 11 (verification)
```

Tasks 6, 7, 8, 9 can be done in parallel after Task 5 completes.
