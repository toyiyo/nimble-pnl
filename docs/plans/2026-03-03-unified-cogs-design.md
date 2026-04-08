# Unified COGS Calculation Design

**Date**: 2026-03-03
**Status**: Approved

## Problem

COGS is calculated from multiple independent sources that don't talk to each other:

1. **Inventory usage** (`inventory_transactions.total_cost` where type='usage') — used by dashboard metrics
2. **Journaled COGS** (chart_of_accounts 5000-5999 via journal entries) — used by Income Statement only
3. **Bank transactions categorized as COGS** — not aggregated anywhere as COGS today

Customers who use bank transactions/expenses for cost tracking (without inventory) see no COGS on their dashboard. Customers who use both sources see inconsistent numbers across surfaces.

## Solution

A **per-restaurant COGS preference setting** with 3 modes, and a **single unified hook** that all surfaces consume.

### COGS Modes

| Mode | Source | Best For |
|------|--------|----------|
| **Inventory** (default) | `inventory_transactions` usage records | Real-time food cost tracking via recipes |
| **Financials** | Bank transactions + manual expenses categorized under COGS chart-of-accounts | Accounting accuracy, restaurants without inventory tracking |
| **Combined** | Sum of both sources | Restaurants wanting the full picture (with awareness of potential overlap) |

### Timing Trade-off

- Inventory COGS is **real-time** — available the moment a sale consumes ingredients
- Financial COGS is **delayed** — arrives when bank transactions sync and are categorized
- Combined sums both (may double-count if food purchases flow through both inventory and bank)

## Data Model

### New table: `restaurant_financial_settings`

```sql
CREATE TABLE restaurant_financial_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  cogs_calculation_method TEXT NOT NULL DEFAULT 'inventory'
    CHECK (cogs_calculation_method IN ('inventory', 'financials', 'combined')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id)
);
```

- Follows established pattern: `notification_settings`, `overtime_rules`, `restaurant_inventory_settings`
- One row per restaurant, auto-created on first access
- RLS: all restaurant users can view, owners/managers can update
- Extensible for future financial preferences

## Hook Architecture

### Layer 1: Data Fetchers

**`useFoodCosts()`** — existing, unchanged. Queries `inventory_transactions` where `transaction_type = 'usage'`, sums `total_cost` by date.

**`useCOGSFromFinancials()`** — NEW. Queries:
1. `bank_transactions` where `category_id → chart_of_accounts.account_subtype` IN (`food_cost`, `cost_of_goods_sold`, `beverage_cost`, `packaging_cost`), `is_split = false`, `is_transfer = false`, status IN (`posted`, `pending`)
2. `bank_transaction_splits` where `category_id → chart_of_accounts.account_subtype` matches COGS subtypes (for split parent transactions)
3. `pending_outflows` where `category_id → chart_of_accounts.account_subtype` matches COGS subtypes, `linked_bank_transaction_id IS NULL`, status IN (`pending`, `stale_30`, `stale_60`, `stale_90`)

Amounts use `Math.abs()` (bank outflows are negative).

### Layer 2: Orchestrator

**`useUnifiedCOGS(restaurantId, startDate, endDate)`**
- Reads `cogs_calculation_method` from `useFinancialSettings()`
- Delegates to the appropriate data fetcher(s) based on method
- Returns:
  ```typescript
  {
    totalCOGS: number,
    dailyCOGS: { date: string, amount: number, source: 'inventory' | 'financials' }[],
    breakdown: { inventory: number, financials: number },
    method: 'inventory' | 'financials' | 'combined',
    isLoading: boolean,
    error: Error | null
  }
  ```

### Layer 3: Settings Hook

**`useFinancialSettings(restaurantId)`**
- Queries `restaurant_financial_settings` with `.maybeSingle()`
- Auto-creates default row if none exists
- Returns `{ cogsMethod, updateSettings, isLoading }`

## Consumer Changes

### Dashboard Metrics (`useCostsFromSource`)
- Replace `useFoodCosts()` call with `useUnifiedCOGS()`
- All downstream consumers (`usePeriodMetrics`, dashboard cards) automatically get unified COGS
- No UI changes needed

### Income Statement (`IncomeStatement.tsx`)
- Replace the dual-source logic (journaled COGS + inventory fallback) with `useUnifiedCOGS()`
- Eliminates the "Inventory Usage (unposted)" synthetic account workaround
- COGS section now matches dashboard exactly

### Break-Even / Budget
- Break-even formula unchanged — still uses configured variable cost % from `operating_costs`
- NEW: Show actual unified COGS % as an overlay/comparison on the break-even chart
- Users can see: "My target is 30% food cost, but actual was 33% this month"

## Settings UI

New section on Restaurant Settings page:

- Radio group with 3 options (Inventory, Financials, Combined)
- Each option has a description explaining what it does
- Info box showing current COGS values from each source for the current period
- Helps users make an informed choice by seeing the actual numbers
- Follows Apple/Notion styling (uppercase label, rounded-xl container, border-border/40)

## Financial Sources for "Financials" Mode

Both of these count toward COGS:
1. **Bank transactions** (from Stripe Financial Connections) categorized under COGS accounts
2. **Manual expenses / pending outflows** (user-entered bills, invoices) categorized under COGS accounts

Filtered by `chart_of_accounts.account_subtype` matching the existing `isFoodCostSubtype()` check:
- `food_cost`
- `cost_of_goods_sold`
- `beverage_cost`
- `packaging_cost`

## Testing Strategy

| Component | Test Type | What We Test |
|-----------|-----------|-------------|
| `useFinancialSettings` | Unit (Vitest) | Auto-creation of defaults, reading/updating preference |
| `useCOGSFromFinancials` | Unit (Vitest) | Correct aggregation of bank txns + pending outflows + splits by COGS subtypes |
| `useUnifiedCOGS` | Unit (Vitest) | Correct delegation per method, combined mode summing, loading/error states |
| `restaurant_financial_settings` | pgTAP | RLS policies, default values, constraint enforcement |
| Settings UI component | Optional | Radio selection, info box display |

Key invariant: `useUnifiedCOGS` returns the same number regardless of which surface calls it.

## Key Files (Existing)

| File | Role |
|------|------|
| `src/hooks/useFoodCosts.tsx` | Inventory COGS (unchanged) |
| `src/hooks/useCostsFromSource.tsx` | Aggregates food + labor costs (updated) |
| `src/hooks/usePeriodMetrics.tsx` | Period financial metrics (updated via useCostsFromSource) |
| `src/components/financial-statements/IncomeStatement.tsx` | P&L display (updated) |
| `src/lib/expenseCategoryUtils.ts` | `isFoodCostSubtype()` function (reused) |
| `src/lib/expenseDataFetcher.ts` | Query pattern reference for bank transactions |
| `src/lib/breakEvenCalculator.ts` | Break-even formula (add actual COGS overlay) |
| `src/pages/RestaurantSettings.tsx` | Settings page (add Financial tab/section) |

## Key Files (New)

| File | Role |
|------|------|
| `src/hooks/useUnifiedCOGS.tsx` | Orchestrator hook |
| `src/hooks/useCOGSFromFinancials.tsx` | Bank/expense COGS data fetcher |
| `src/hooks/useFinancialSettings.tsx` | Restaurant financial settings hook |
| `supabase/migrations/YYYYMMDD_restaurant_financial_settings.sql` | New table + RLS |
| `tests/unit/useUnifiedCOGS.test.ts` | Unit tests |
| `tests/unit/useCOGSFromFinancials.test.ts` | Unit tests |
| `supabase/tests/restaurant_financial_settings.test.sql` | pgTAP tests |
