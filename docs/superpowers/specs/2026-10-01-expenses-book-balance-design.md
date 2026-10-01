# Expenses page book balance: the 60-day rule — design

Status: draft for review. Text is STE-aligned.

Follow-up 6.4 of `docs/superpowers/specs/2026-09-30-stale-pending-outflows-design.md`
(PR #838).

## 1. Problem

The Expenses page and the cash runway show two different book balances for
the same restaurant on the same day.

- The runway subtracts only open outflows with an `issue_date` in the last
  60 days (`src/hooks/useLiquidityMetrics.tsx:30`, `:75-81`, `:85-86`).
- The Expenses page subtracts every open outflow, with no date filter
  (`src/pages/Expenses.tsx:44-48`).
- The page shows three cards: Bank Balance (`:112-124`), Uncommitted
  Expenses (`:126-138`) and Book Balance (`:140-154`).
- The page reads its rows from `usePendingOutflows()` (`src/pages/Expenses.tsx:34`).
  That hook selects all rows of the restaurant, with no status or date filter
  (`src/hooks/usePendingOutflows.tsx:18-32`).

Prod data (from the #838 design, section 1.1): one restaurant has $56,191 of
open outflows, and only $494 of it is 0-30 days old. 8 restaurants hold
$384,634 older than 90 days. On the Expenses page these old checks make the
book balance low, or negative, while the runway shows a healthy number.

## 2. Goals

1. The Book Balance card uses the same 60-day rule as the runway.
2. The three cards stay consistent: Bank Balance − Uncommitted Expenses =
   Book Balance.
3. The user can see that old open outflows exist and are not counted.

Not goals: no change to the data source or query, no change to the list
below the cards (`PendingOutflowsList`, `src/pages/Expenses.tsx:164-168`), no
change to the runway result.

## 3. Approach

### 3.1 Options

| Option | Uncommitted card | Book Balance | Result |
|---|---|---|---|
| A (recommended) | 60-day amount, plus a note line for the older amount | Bank − 60-day amount | Cards agree with each other and with the runway. The old amount stays visible. |
| B | All open rows (no change) | Bank − 60-day amount | Bank − Uncommitted ≠ Book. The cards contradict each other. |
| C | 60-day amount, no note | Bank − 60-day amount | The old amount disappears from the cards. The user does not know why the card total and the list differ. |

Option A.

### 3.2 Shared helper (`src/lib/openOutflows.ts`, new)

A pure module, so the hook and the page use one rule:

```ts
export const OPEN_OUTFLOW_STATUSES = ['pending', 'stale_30', 'stale_60', 'stale_90'] as const;
export const OPEN_OUTFLOW_WINDOW_DAYS = 60;

// 'yyyy-MM-dd' of the first day inside the window (today − 59 days).
export function getOpenOutflowCutoff(now: Date = new Date()): string;

// Splits open rows into the in-window amount and the older amount.
// Rows with other statuses (cleared, voided) count in neither.
export function summarizeOpenOutflows(
  rows: ReadonlyArray<{ amount: number | string; status: string; issue_date: string }>,
  now: Date = new Date(),
): { inWindow: number; older: number } {
  const cutoff = getOpenOutflowCutoff(now);
  // 1. Keep only rows whose status is in OPEN_OUTFLOW_STATUSES.
  // 2. Add Number(row.amount) to inWindow if row.issue_date >= cutoff, else to older.
}
```

The function does the status filter itself. The page passes all rows
(`expenses ?? []`) and does no filter of its own.

- The cutoff math is the same as the hook today:
  `format(subDays(now, OPEN_OUTFLOW_WINDOW_DAYS - 1), 'yyyy-MM-dd')`
  (`src/hooks/useLiquidityMetrics.tsx:75`).
- `issue_date` is a `yyyy-MM-dd` string (`src/types/pending-outflows.ts:11`).
  A string compare `issue_date >= cutoff` is the same as the SQL `.gte`.
  Future-dated rows are in the window, as in the hook.
- `amount` goes through `Number()`, so a numeric string from PostgREST does
  not concatenate.

### 3.3 Hook change (`src/hooks/useLiquidityMetrics.tsx`)

No behavior change. Import `OPEN_OUTFLOW_WINDOW_DAYS`,
`OPEN_OUTFLOW_STATUSES` and `getOpenOutflowCutoff` from the new module.
Re-export `OPEN_OUTFLOW_WINDOW_DAYS`, so the import at
`tests/unit/useLiquidityMetrics.test.tsx:5` still works. The query stays the
same. The 11 existing tests must pass with no change.

### 3.4 Page change (`src/pages/Expenses.tsx`)

- Replace the sum at `:44-46` with
  `const { inWindow, older } = useMemo(() => summarizeOpenOutflows(expenses ?? []), [expenses])`.
- `bookBalance = totalBalance - inWindow`.
- The Uncommitted Expenses card shows `inWindow`.
- Under the card label, when `older > 0`, add one line:
  `+$X older than 60 days, not counted`. Use a `span` with
  `block text-xs text-muted-foreground`. The existing sub-line "After
  expenses clear" (`src/pages/Expenses.tsx:150`) gets its muted color from
  the parent `div`. The new line sets the color itself. The text uses
  `OPEN_OUTFLOW_WINDOW_DAYS`, not a literal 60.
- No other markup changes. The card colors stay as they are (the existing
  `text-green-600` and `from-green-50/50` are out of scope).

The `useMemo` cutoff uses `new Date()` at compute time. The memo recomputes
when `expenses` changes (30 s `staleTime`, `src/hooks/usePendingOutflows.tsx:38`).
The midnight trade-off is the same as #838 trade-off 6.6.

## 4. Tests

### 4.1 Unit, helper (`tests/unit/openOutflows.test.ts`, new)

Use fixed `now` values (pass `now`, no fake timers).

- `OPEN_OUTFLOW_WINDOW_DAYS` is 60.
- `getOpenOutflowCutoff(new Date(2026, 8, 30, 12))` is `'2026-08-02'`.
  Year edge: `new Date(2026, 0, 15, 12)` gives `'2025-11-17'`.
- `summarizeOpenOutflows`:
  - A row on the cutoff day is `inWindow`. A row one day before is `older`.
  - A future-dated row is `inWindow`.
  - `stale_30`, `stale_60`, `stale_90` rows count by date, not by status.
  - `cleared` and `voided` rows count in neither.
  - An empty array gives `{ inWindow: 0, older: 0 }`.
  - A numeric string amount sums as a number.

### 4.2 Unit, page (`tests/unit/expensesBookBalance.test.tsx`, new)

Use the mock pattern of `tests/unit/expensesPrintChecksHeaderGate.test.tsx:13-72`.
Fake timers with `toFake: ['Date']`, restored in `afterEach` (lesson
2026-04-21).

- Bank 10,000. Rows: 500 in window (`pending`), 2,000 older (`stale_90`),
  300 `cleared`. Expect Uncommitted `$500.00`, Book `$9,500.00`, and the
  note `+$2,000.00 older than 60 days, not counted`.
- No older rows: the note is absent.

### 4.3 Hook

`tests/unit/useLiquidityMetrics.test.tsx` runs with no change and passes.

### 4.4 E2E

Justified exception. The change is a number and one text line on an
existing page. No seed helper exists for connected banks and balances, so
an E2E cannot set the Bank Balance. The page test renders the real page
component with the real helper.

## 5. Decided trade-offs

1. **Card and list totals differ.** The list below the cards still shows
   all open rows. The note line explains the gap. A split total in the list
   is a separate follow-up (#838 design 6.7).
2. **Device date.** The page uses the browser's local date, as the hook
   does. Same as #838 trade-off 6.1.
3. **Card typography.** The cards use `text-3xl`, `text-sm` and
   `text-green-600`. These do not follow the CLAUDE.md typography scale and
   tokens. This is old debt and out of scope.
4. **Hook refactor.** The hook imports the rule from the new module. This
   adds a small diff to a file with no behavior change, but it keeps one
   source for the rule.

## 6. Follow-ups (not in this PR)

- A runway note for the excluded old amount (#838 design 6.2).
- A split total on the pending outflows list (#838 design 6.7).
- Local-day edges for the hook.
