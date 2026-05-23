# Design — Optional category on check creation

**Date:** 2026-05-22
**Branch:** `feature/check-create-with-category`
**Author:** Jose M Delgado (with Claude Code)

## Problem

When a user prints checks, every printed check creates a `pending_outflows`
row (an "expense"). Today those expenses land **uncategorized**
(`category_id IS NULL`). To attach a chart-of-accounts category the user has
to leave the Print Checks flow, navigate to Expenses, find the row, open the
edit sheet, pick the category, and save. That's three pages and a context
switch per check.

The user wants to pick the category **inline at check creation time** so the
common path ("print this check and book it to Office Supplies") is one screen.

## Goals

- Allow setting an optional chart-of-accounts category when **creating** a
  check on `/print-checks` (the batch "Write Checks" page).
- Allow setting/overriding the same optional category when **printing a
  check for an existing expense** via `PrintCheckButton` (the per-row print
  dialog on the Pending Outflows view).
- Keep category strictly optional — current uncategorized flow must still
  work without any extra clicks.

## Non-goals

- Bulk re-categorization of historical checks. (Already covered by the
  existing expense edit sheet and the Bank Transactions categorize panel.)
- Default-category memory ("remember last category for vendor X"). Could
  be a future iteration but is out of scope here.
- New chart-of-accounts UI. We reuse `SearchableAccountSelector`.
- Schema changes. `pending_outflows.category_id` already exists.

## Data model — minor hardening, no schema rewrite

The column itself already exists:

```
pending_outflows.category_id uuid NULL  REFERENCES chart_of_accounts(id)
```

…and the TypeScript types already accept it:

- `CreatePendingOutflowInput.category_id?: string | null`
- `UpdatePendingOutflowInput.category_id?: string | null`

The `usePendingOutflows` query already joins
`chart_account:chart_of_accounts!category_id(id, account_name)`, so reading
the category back on the expenses list already works.

**Two new migrations** are included (motivated by the Phase 2.5 supabase
reviewer):

### Migration A — same-restaurant FK guard

Today the FK only enforces that `category_id` references *some* row in
`chart_of_accounts`. It does not enforce that the referenced row's
`restaurant_id` matches the outflow's `restaurant_id`. In normal UI flow
this is invisible because the SELECT RLS on `chart_of_accounts` prevents
the user from seeing other restaurants' accounts. But a malicious or
buggy client could write a foreign `category_id` directly via the API.
Since this feature is the first one to put a category picker on a
high-volume create path, harden it now.

```sql
CREATE OR REPLACE FUNCTION assert_pending_outflow_category_same_restaurant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    PERFORM 1
      FROM chart_of_accounts
     WHERE id = NEW.category_id
       AND restaurant_id = NEW.restaurant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'pending_outflows.category_id % does not belong to restaurant %',
        NEW.category_id, NEW.restaurant_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pending_outflows_category_same_restaurant
BEFORE INSERT OR UPDATE OF category_id, restaurant_id ON pending_outflows
FOR EACH ROW
EXECUTE FUNCTION assert_pending_outflow_category_same_restaurant();
```

### Migration B — partial index on `category_id`

Aggregation read paths (`expenseDataFetcher`, `useMonthlyMetrics`,
`useExpenseHealth`) already join `chart_of_accounts!category_id` and
will start hitting populated values much more often once this feature
ships. Historical rows are mostly `NULL`, so a partial index is the
right shape:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_outflows_category
  ON pending_outflows(category_id)
  WHERE category_id IS NOT NULL;
```

No RPC change, no RLS policy change, no column changes.

## UI changes

### 1. `src/pages/PrintChecks.tsx` — batch Write Checks page

**Row shape.** Extend the local `CheckRow` interface:

```ts
interface CheckRow {
  id: string;
  payeeName: string;
  amount: string;
  issueDate: string;
  memo: string;
  categoryId: string | null;   // NEW
  selected: boolean;
}
```

`createEmptyRow()` initializes `categoryId: null`.

**`updateRow` signature widening.** The existing helper is typed
`(id, field: keyof CheckRow, value: string | boolean) => void`. `null`
is not assignable to that union, so the signature widens to
`string | boolean | null`. All existing callers pass `string` or
`boolean`, so the widening is non-breaking.

**Table layout.** Insert a new "Category" column between Memo and the trash
button. Header cell follows the existing typography
(`text-[12px] font-medium text-muted-foreground uppercase tracking-wider`).
Body cell hosts:

```tsx
<SearchableAccountSelector
  value={row.categoryId ?? undefined}
  onValueChange={(v) => updateRow(row.id, 'categoryId', v || null)}
  filterByTypes={['expense', 'cogs', 'asset']}
  placeholder="Optional"
/>
```

Sized roughly to match the Memo column (`w-48` give-or-take) so the row
height stays uniform. The selector is the same component used by
`AddExpenseSheet`, `AddPendingOutflowDialog`, and `EditExpenseSheet`, so
search behavior, parent/child grouping, and keyboard navigation are
already battle-tested.

**Accessibility — per-row aria-label.** The header `<TableHead>Category`
is a *column* label, not a per-cell programmatic label. Each row's
combobox trigger needs its own accessible name. `SearchableAccountSelector`
gains a new optional `triggerAriaLabel?: string` prop that gets forwarded
to the underlying `<Button role="combobox">`. The Write Checks page
passes `triggerAriaLabel={`Category for ${row.payeeName || 'check row ' + (rowIndex + 1)}`}`
per row.

**Popover collision padding.** `PopoverContent` (Radix) is portal-mounted
so the `overflow-x-auto` wrapper does not clip it, but on narrow viewports
the 350 px popover can collide with the right edge. Pass
`collisionPadding={8}` on the popover content inside
`SearchableAccountSelector`. (Already inside that component — a single
file edit covers every consumer.)

**Print handler.** Instead of relying on positional alignment between
`checks[]` and `selectedRows[]` (fragile under later refactors), carry
`categoryId` *on* the per-check intermediate value:

```ts
type CheckJob = CheckData & { categoryId: string | null };

const jobs: CheckJob[] = selectedRows.map((row, i) => ({
  checkNumber: startNumber + i,
  payeeName: row.payeeName.trim(),
  amount: parseFloat(row.amount),
  issueDate: row.issueDate,
  memo: row.memo.trim() || undefined,
  categoryId: row.categoryId ?? null,
}));

for (const job of jobs) {
  const outflow = await createPendingOutflow.mutateAsync({
    vendor_name: job.payeeName,
    amount: job.amount,
    payment_method: 'check',
    reference_number: String(job.checkNumber),
    issue_date: job.issueDate,
    notes: job.memo ?? null,
    category_id: job.categoryId,
  });
  // …logCheckAction unchanged…
}
```

`generateCheckPDF` then receives `jobs` cast/sliced to `CheckData[]`
(the PDF renderer doesn't need `categoryId`). The categoryId travels
with the row it came from, so any future filter/reorder of `jobs`
keeps the category attached to the correct expense.

**Reset.** `setRows([createEmptyRow()])` already clears state on success;
`createEmptyRow` returns `categoryId: null`, so no extra reset wiring.

### 2. `src/components/pending-outflows/PrintCheckButton.tsx` — existing-expense dialog

**State.** Add `selectedCategoryId: string | null`. Mirror the `memo`
initialization pattern:

```ts
const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
  expense.category_id ?? null,
);

useEffect(() => {
  if (!open) return;
  setSelectedCategoryId(expense.category_id ?? null);
}, [open, expense.category_id]);
```

**Dialog body.** Insert a "Category (optional)" block after the Memo input
and before the dialog footer. Same Apple/Notion form styling already used
elsewhere in this file:

```tsx
<div className="space-y-2">
  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
    Category (optional)
  </Label>
  <SearchableAccountSelector
    value={selectedCategoryId ?? undefined}
    onValueChange={(v) => setSelectedCategoryId(v || null)}
    filterByTypes={['expense', 'cogs', 'asset']}
    placeholder="Pick a chart-of-accounts category"
  />
</div>
```

**Print handler.** Add `category_id` to the `updatePendingOutflow` call:

```ts
await updatePendingOutflow.mutateAsync({
  id: expense.id,
  input: {
    payment_method: 'check',
    reference_number: String(checkNumber),
    notes: memo.trim() || expense.notes,
    check_bank_account_id: selectedAccount.id,
    category_id: selectedCategoryId,   // NEW
  },
});
```

### 3. Visual notes / styling

- Both surfaces use `SearchableAccountSelector` — that component renders a
  `Popover` inside the trigger, which is portal-friendly and works inside
  table cells and inside `DialogContent`.
- Tailwind: existing tokens only. No new color usage.
- Mobile: the Write Checks table is already inside `overflow-x-auto`, so
  an extra column doesn't break narrow viewports — it just makes more
  horizontal scroll. Acceptable; matches today's behaviour for the wide
  layout.
- `PrintCheckButton`'s `DialogContent` currently has no `max-h-[80vh]` /
  `overflow-y-auto`. Adding the Category field is the natural moment to
  add those classes so the dialog stays usable on phones with the
  software keyboard open (the existing CLAUDE.md dialog template uses
  exactly those classes).
- `SearchableAccountSelector` currently emits two `console.log` calls on
  every render (lines 70–71). Both new surfaces would re-emit them in
  production. Removed in the same PR — one-line cleanup adjacent to the
  prop and `collisionPadding` changes already required.

## Behaviour

- **Empty category ⇒ unchanged behaviour.** `null` is still legal at the
  database, type, and UI layer. Hitting Print without picking a category
  produces the same `pending_outflow` rows we produce today.
- **Per-row independence (batch page).** Two rows in the same print job
  can have different categories.
- **Override semantics (per-expense dialog).** When `expense.category_id`
  is already set, the selector is prefilled. Saving without touching it
  re-submits the same value — a no-op from the user's point of view.
- **Order of operations (per-expense dialog).** Lesson #211 (from
  PR #480–482): fetch encrypted MICR secrets BEFORE any write. We do not
  change that. The `updatePendingOutflow` call (which now also carries
  `category_id`) still runs **after** secrets resolve.
- **Atomicity.** `category_id` rides in the same single-row insert/update
  RPC as the rest of the expense; no second round-trip, no half-saved
  state.

## Error handling

- If `chart_of_accounts` is empty for the restaurant,
  `SearchableAccountSelector` shows its standard empty state ("No accounts
  found") and the field stays disabled-by-effect (you literally can't pick
  anything). Print path is unaffected because the field is optional.
- If the user picks a category, then the chart-of-accounts row is deleted
  between selection and print, the `category_id` insert would fail with a
  FK violation. Probability ≈ zero (single-user dialog), and the existing
  error toast in `createPendingOutflow.onError` surfaces it. Worth noting,
  not worth defensive coding.

## Testing

All new files live under `tests/unit/` and use the existing Vitest
fixtures and `vi.mock(...)` patterns.

### `tests/unit/PrintChecksCategoryColumn.test.tsx` (new)

1. Render `PrintChecks` with a mocked restaurant context, a mocked
   `useCheckBankAccounts` returning one default account, a mocked
   `useCheckSettings` returning configured settings, and a mocked
   `useChartOfAccounts` returning three accounts (one expense, one COGS,
   one asset).
2. Fill in a payee name, amount, and date in row 1.
3. Open the Category selector, pick "Food Costs" (the COGS account).
4. Click Print.
5. Assert `createPendingOutflow.mutateAsync` was called with
   `category_id: '<food-costs-id>'`.

### `tests/unit/PrintCheckButtonCategory.test.tsx` (new)

Three cases in one file:

1. **Uncategorized expense, user picks a category.** Render
   `PrintCheckButton` for an expense with `category_id: null`, open the
   dialog, pick a category from the selector, click Print. Assert
   `updatePendingOutflow.mutateAsync` is called with the picked
   `category_id`.
2. **Pre-categorized expense, user keeps existing.** Render for an
   expense already linked to "Office Supplies". Assert the selector
   renders that account as its initial value. Click Print without
   touching it. Assert `category_id` in the update payload equals the
   original id.
3. **Pre-categorized expense, user changes it.** Same setup as (2), but
   pick a different account. Assert the update payload's `category_id`
   matches the newly picked id.

### Lesson-driven test discipline

- Lesson #193 (SonarCloud new-code coverage ignores Vitest excludes):
  these tests render the real components and the real
  `SearchableAccountSelector` (not a mock) so the new column path and
  the new dialog field are counted as covered lines.
- Lesson #167 (Prefer structural `role`-based assertions): pick categories
  via `getByRole('combobox')` / `getByRole('option', { name: ... })`
  rather than `getByText` where possible.

### `supabase/tests/pending_outflows_category_same_restaurant.test.sql` (new)

pgTAP test for Migration A. Two assertions:

1. `lives_ok($$INSERT INTO pending_outflows (..., category_id) VALUES (..., <same-restaurant-account>)$$)`
2. `throws_ok($$INSERT INTO pending_outflows (..., category_id) VALUES (..., <other-restaurant-account>)$$, '23503')`

(ERRCODE `23503` = `foreign_key_violation`, which is what
`RAISE EXCEPTION ... USING ERRCODE` emits.)

Also a third assertion to cover the UPDATE path: insert with
`category_id = NULL`, then attempt to update to a foreign category id;
expect the same `23503`.

### Existing test impact

- `tests/unit/checkPrinting.test.ts` (the PDF generation tests) is
  untouched — the PDF render doesn't take a category. No change there.
- One Vitest fixture (`tests/unit/SearchableAccountSelector.test.tsx`,
  if present) may need a small update to cover the new
  `triggerAriaLabel` prop. Verified during implementation.

## Risk

- **Low.** Surface area is two files plus two new tests, no schema
  change, no RPC change. The new field is optional and already exists at
  the DB layer, so a runtime regression can only manifest as either "the
  field doesn't appear in the UI" (caught by render tests) or "the field
  appears but isn't passed through" (caught by mutation assertion tests).

## Decided trade-offs (Phase 2.5 review)

The Phase 2.5 frontend and supabase reviewers raised six concerns. Three
are folded into the design above (cross-restaurant trigger, partial
index, aria-label / collisionPadding / dialog overflow / console-log
cleanup, positional-indexing refactor, `updateRow` typing widening). The
remaining three are explicitly **deferred**:

1. **`useChartOfAccounts` does not surface an `error` value to consumers.**
   Pre-existing across five call sites. Mitigation: today the selector
   shows the empty state on errors (data defaults to `[]`), so users
   physically cannot pick a wrong value. Fixing the error surface is a
   separate cross-cutting refactor.
2. **`useChartOfAccounts` `staleTime: 5 * 60 * 1000` exceeds the
   CLAUDE.md 60s cap.** Same pre-existing issue. Lowering it here would
   reduce cache effectiveness for the five other call sites without a
   user-visible win — chart-of-accounts edits are infrequent.
3. **`useMonthlyMetrics` labor path matches on `account_subtype === 'labor'`
   without applying `isTransferCategoryType`.** The supabase reviewer
   noted this could double-count if a user creates an asset-typed
   account with subtype "labor". Probability ≈ zero (asset/labor is a
   nonsensical pairing in the seeded chart). Tracked but not in scope.

## Open questions

None. All three brainstorming questions resolved:

- Q1 batch UI placement → per-row column in the table.
- Q2 existing-expense flow → yes, add it there too for parity.
- Q3 account filter → `['expense', 'cogs', 'asset']`.
