# Design: Transfer-categorized bank transactions counted as Expenses

**Date:** 2026-04-26
**Branch:** `fix/transfer-category-classification`
**Type:** Bug fix (financial reporting correctness)

## Bug

Bank transactions whose category is set to a Transfer-type chart-of-accounts account (e.g., "Transfer Clearing Account" #1050, `account_type='asset'`, or "Inter-Account Transfer" #3010, `account_type='equity'`) are summed into the monthly **Expenses** total in the dashboard. Conceptually, transfers between accounts (cash → savings, owner draws, etc.) are not P&L events and must be excluded from both Income and Expense totals.

## Root cause

The codebase has two independent mechanisms for marking a transaction as a transfer:

1. **`bank_transactions.is_transfer` flag** — set ONLY by the `mark_as_transfer()` RPC (Transfer dialog that pairs two transactions via `transfer_pair_id`).
2. **Assigning a chart-of-accounts category whose `account_type` is `asset|liability|equity`** — `categorize_bank_transaction` RPC (`supabase/migrations/20251020140237_*.sql:211-219`) sets `category_id` and `is_categorized=true` but never touches `is_transfer`.

The dashboard's expense fetcher (`src/lib/expenseDataFetcher.ts:107`) only filters `.eq('is_transfer', false)`. Mechanism #2 leaves `is_transfer=false`, so those rows pass through and get summed as expenses.

## Decision: read-path fix (Approach B)

Exclude transactions/splits/pending-outflows whose category's `account_type` is `asset|liability|equity` from P&L aggregations. No write-time changes, no data migration. Existing miscategorized rows are corrected immediately because their classification is recomputed on every read.

Rejected alternatives:
- **Write-time fix in `categorize_bank_transaction`** (Approach A) — overloads the meaning of `is_transfer` (currently "paired with `transfer_pair_id`"), risks breaking `unmark_as_transfer`, and requires a backfill.
- **Both** (Approach C) — YAGNI for a single bug.

## Single source of truth

Add a small helper in `src/lib/chartOfAccountsUtils.ts`:

```ts
const NON_PNL_ACCOUNT_TYPES = new Set<AccountType>(['asset', 'liability', 'equity']);

export function isTransferCategoryType(
  accountType: AccountType | string | null | undefined
): boolean {
  return !!accountType && NON_PNL_ACCOUNT_TYPES.has(accountType as AccountType);
}
```

Every read path that aggregates P&L from bank-transaction-derived data uses this helper. Single source of truth → can't drift.

## Files to change

| File | Change |
|---|---|
| `src/lib/chartOfAccountsUtils.ts` | Add `isTransferCategoryType` helper + `NON_PNL_ACCOUNT_TYPES` constant |
| `src/lib/expenseDataFetcher.ts` | Add `account_type` to all three `chart_of_accounts` SELECT projections; filter transactions, pendingOutflows, and splitDetails through `isTransferCategoryType` before return |
| `src/hooks/useExpenseHealth.tsx` | Add the missing `.eq('is_transfer', false)` filter (pre-existing secondary bug); add `account_type` to projection; apply `isTransferCategoryType` to the revenue (`amount > 0`), outflow (`amount < 0`), and uncategorized-spend reductions |
| `src/pages/Index.tsx` (daily-spending) | Add `isTransferCategoryType(t.chart_of_accounts?.account_type)` to the existing filter at line 310-317 (verify `chart_of_accounts` is on the row first; add to the underlying fetch projection if not) |

`useMonthlyMetrics.tsx` COGS and labor sections already use `account_subtype` allowlists (`food_cost`, `cost_of_goods_sold`, `payroll`, etc.) so a Transfer-typed category cannot match — verified safe, no changes needed.

## ExpenseTransaction shape change

`ExpenseTransaction.chart_of_accounts` is widened to include `account_type`:

```ts
chart_of_accounts: {
  account_name: string;
  account_subtype: string;
  account_type: AccountType;
} | null;
```

Same widening applied to `PendingOutflowRecord.chart_account` and `SplitDetail.chart_of_accounts`. This is additive — existing consumers continue to work.

## Test strategy (TDD)

**RED first** — write tests that demonstrate the bug, watch them fail.

### 1. Unit test: `isTransferCategoryType` (`tests/unit/chartOfAccountsUtils.test.ts`)

| Input | Expected |
|---|---|
| `'asset'` | true |
| `'liability'` | true |
| `'equity'` | true |
| `'expense'` | false |
| `'cogs'` | false |
| `'revenue'` | false |
| `null` | false |
| `undefined` | false |
| `''` | false |

### 2. Unit test: `expenseDataFetcher` (`tests/unit/expenseDataFetcher.test.ts`)

Mock `supabase.from(...).select(...)...` chain with two transactions in the response:
- Tx A: `amount=-500`, `chart_of_accounts.account_type='expense'` → expected in result
- Tx B: `amount=-500`, `chart_of_accounts.account_type='asset'` (Transfer Clearing Account) → expected EXCLUDED

Same for `pendingOutflows` (one expense + one asset-typed) and one split (one expense + one asset-typed).

Assert the returned `transactions`, `pendingOutflows`, and `splitDetails` arrays contain only the expense-typed entries.

### 3. Unit test: `useExpenseHealth` (`tests/unit/useExpenseHealth.test.ts` — extend if exists, else create)

Mock the supabase response with mixed account types and assert revenue, foodCost, laborCost, and uncategorizedSpend exclude `asset|liability|equity`-typed rows. Also assert the new `is_transfer = false` filter is applied (verify the call args via spy).

### 4. pgTAP test: `supabase/tests/categorize_transfer_account.test.sql`

End-to-end DB-level reproduction:
1. Seed restaurant + chart of accounts (insert "Transfer Clearing Account" with `account_type='asset'`)
2. Insert a `bank_transaction` with `amount = -500`
3. Call `categorize_bank_transaction(tx_id, transfer_account_id, ...)`
4. Assert `is_transfer` remains `false` after categorization (documents current RPC behavior)
5. Verify the row's joined `account_type` is `'asset'` (the data shape our read-path filter relies on)

This test pins the *write-time* contract (RPC unchanged) so future drift is caught.

## Out of scope

- Auto-promote category-based transfers to `is_transfer = true` (write-time fix). Tracked as a future improvement; would need backfill + RPC semantics review.
- Surface a "Transfer" badge in `TransactionDetailSheet` for category-based transfers. UX consistency follow-up.
- Backfilling existing miscategorized rows — Approach B fixes them on next read with no migration.
- Changing the category dropdown to filter out Transfer-type accounts — users should still be able to pick them; the math just needs to handle them correctly.

## Risks

- **Performance:** Three `.filter()` passes on already-fetched arrays. Negligible — tens to low-thousands of rows per month.
- **Other consumers:** Anything using the widened `chart_of_accounts` shape continues to work because the new field is additive. Verified by `npm run typecheck` in Phase 8.
- **Subtype-only consumers:** `useMonthlyMetrics` COGS/labor sections rely on `account_subtype` allowlists, so unaffected. Confirmed during exploration.
