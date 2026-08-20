# Design: Bulk categorize must create journal entries

Date: 2026-08-19
Branch: `fix/bulk-categorize-journal-entries`
Status: Draft for Phase 2.5 review

## 1. Problem

The income statement shows $0.00 for accounts that have categorized bank
transactions. Example: account 9000-01 "SBA Loan Interest" shows $0.00 for
every period. Six transactions with a total of $25,718.55 carry that
category.

The income statement reads only `journal_entry_lines` joined to
`journal_entries` (src/components/financial-statements/IncomeStatement.tsx:207-221).
A categorized transaction without a journal entry is invisible to it.

## 2. Root cause

`useBulkCategorizeTransactions` updates `bank_transactions` directly
(src/hooks/useBulkTransactionActions.tsx:20-29). It sets `category_id`,
`is_categorized = true`, and clears `suggested_category_id`. It does not
create a journal entry.

The correct path is the RPC `categorize_bank_transaction`. Its authoritative
definition is supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql:25-255.
It creates a journal entry with two lines and rebuilds account balances.

No background process repairs the gap. The categorization sweep processes
only rows where `is_categorized = false OR category_id IS NULL`
(supabase/migrations/20260804090300_bounded_categorization_sweep.sql:343).
A row the bulk hook touched is categorized, so the sweep never revisits it.

## 3. Producers of journal-entry-less rows

Production shows 2,328 categorized, non-transfer bank transactions with no
journal entry, across 6 restaurants, $901,016.81 absolute total, dated
2025-11-02 through 2026-08-19. Attribution by row signature:

| Producer | Signature | Rows | Abs total |
|---|---|---|---|
| Bulk hook (this fix) | no suggestion, no `matched_at` | 2,191 | $797,868.40 |
| Pending-outflow match | `matched_at` set | 137 | $103,148.41 |
| Auto-apply trigger | indistinguishable from bulk hook | (within 2,191) | — |

Notes on the other producers (both OUT OF SCOPE, follow-up tasks filed):

- The BEFORE INSERT trigger `auto_apply_bank_categorization_rules`
  (supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:224-275)
  sets `NEW.category_id` and `NEW.is_categorized := true` when an
  `auto_apply` rule matches. It creates no journal entry. It does not stamp
  `matched_by`, so its rows look like bulk-hook rows.
- The pending-outflow match flow (src/hooks/usePendingOutflows.tsx:140-223)
  direct-updates `bank_transactions` with `is_categorized: true` and a
  `category_id`. It creates no journal entry.

The backfill in this fix is producer-agnostic. It repairs all 2,328 rows.
The two out-of-scope producers keep creating new bad rows until their
follow-up tasks land. The backfill function stays in the database and is
rerunnable, so a later repair costs one function call.

Eight additional rows are transfers (`is_transfer = true`, $9,242.20).
Transfers must not create profit-and-loss entries. The backfill excludes
them. The approved count of 2,328 already excluded them.

## 4. Scope

Three deliverables:

1. New RPC `bulk_categorize_bank_transactions`. It mirrors
   `categorize_bank_transaction` per row and creates journal entries.
2. Change `useBulkCategorizeTransactions` to call the new RPC.
3. Backfill migration that repairs the 2,328 production rows.

Out of scope (follow-up task chips filed in this session):

- Journal entries for the auto-apply trigger path.
- Journal entries for the pending-outflow match path.
- Missing membership check in `bulk_delete_bank_transactions`
  (supabase/migrations/20260301000001_update_delete_functions_with_tombstone.sql:100-183 —
  `auth.uid()` appears only as the tombstone `deleted_by` value).
- The Undo stub in the bulk toast (src/hooks/useBulkTransactionActions.tsx:41-47).

## 5. Design decision 1: new bulk RPC, inline journal-entry logic

Signature:

```sql
bulk_categorize_bank_transactions(
  p_transaction_ids uuid[],
  p_category_id uuid,
  p_restaurant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout TO '120s'
```

`GRANT EXECUTE ... TO authenticated; REVOKE ... FROM PUBLIC, anon;`

The `statement_timeout` override is not optional. This codebase already
shipped a client-callable, 500-row-batch, per-row-loop SECURITY DEFINER
function without one; it hit the `authenticated` role's ~8s default and
threw `canceling statement due to statement timeout`
(supabase/migrations/20260720120001_bulk_deduction_keyset_batching.sql:1-8,31).

Why a new RPC and not a loop over `categorize_bank_transaction` in the
client or in SQL:

- The single RPC calls `rebuild_account_balances` on every call
  (20260709120000_categorize_preserve_metadata_on_noop.sql:246). That
  function recomputes every active account in a loop
  (supabase/migrations/20251019021231_942cf575-c06d-491f-9f5f-77c57b85d1a2.sql:61-84).
  N calls for N transactions risks a statement timeout on large selections.
  The bulk RPC rebuilds once at the end.
- Adding a `p_skip_rebuild` parameter to the single RPC with
  `CREATE OR REPLACE` creates an overload. PostgREST then returns PGRST203
  ambiguity errors. A DROP+CREATE dance on a hot production function is a
  larger risk than inlined logic. The bounded sweep took the same inline
  approach (20260804090300_bounded_categorization_sweep.sql).
- One client-side RPC call per row multiplies network round trips and gives
  no transactional boundary.

Set-level guards, checked once (mirror of 20260709120000 lines 57-65,
120-129, 144-153):

1. Membership: raise `Unauthorized` unless a `user_restaurants` row matches
   `p_restaurant_id` and `auth.uid()`.
2. Category: raise `Category not found or inactive` unless the category
   belongs to `p_restaurant_id` and `is_active = true`.
3. Cash account: raise `Cash account (1000) not found` unless the restaurant
   has an account with `account_code = '1000'` (first by `LIMIT 1`).
4. Input: raise on NULL or empty `p_transaction_ids`. Raise on more than
   500 ids — an explicit error, never silent truncation. The cap bounds the
   statement. The client chunks larger selections (section 6). The page size
   is 500 (src/hooks/useBankTransactions.tsx:14,
   `BANK_TRANSACTIONS_PAGE_SIZE`), and `selectAll` can exceed it after
   `loadMore()` (src/pages/Transactions.tsx:60-67,520-525).

**Amendment (2026-08-20):** Guard 1 now checks two conditions, not one.
A caller must have a matching `user_restaurants` row, and the `edit:transactions`
capability. See
docs/superpowers/specs/2026-08-20-bulk-categorize-capability-guard-design.md
and supabase/migrations/20260820100000_bulk_categorize_capability_guard.sql.

Per-row loop over
`SELECT ... FROM bank_transactions WHERE id = ANY(p_transaction_ids) AND restaurant_id = p_restaurant_id`.
Ids outside the tenant do not match the filter; the RPC reports them in
`skipped` with reason `not_found`. The current hook silently ignored them
(the UPDATE filter at src/hooks/useBulkTransactionActions.tsx:27-28); the
RPC makes that visible.

Per-row branch semantics, an exact mirror of the single RPC
(20260709120000 lines 83-243), with the RAISE guards converted to skip
reasons because one bad row must not abort the batch:

| Row state | Action | Mirror source |
|---|---|---|
| Same category already set | No-op, count `unchanged` | lines 89-113 |
| Categorized, different category | RECLASS journal entry + `transaction_reclassifications` row | lines 163-197 |
| Reconciled, not yet categorized | Skip, reason `reconciled` | lines 115-118 |
| Date in closed fiscal period | Skip, reason `closed_period` | lines 131-142 |
| Uncategorized, existing entry for reference | Reuse entry: delete lines, update totals | lines 198-207 |
| Uncategorized, no entry | Insert `BANK-` entry | lines 208-219 |

Journal entry lines follow the sign convention of lines 221-231: amount < 0
debits the category and credits cash `'Cash payment'`; amount >= 0 debits
cash `'Cash received'` and credits the category. All amounts `ABS()`.

Entry number format: `'BANK-' || COALESCE(stripe_transaction_id, id::text) || '-' || TO_CHAR(clock_timestamp(), 'YYYYMMDD-HH24MISS-US')`.
Deviation from the single RPC: `clock_timestamp()` instead of `now()`.
`now()` is constant for the whole transaction, so a batch would stamp every
entry with one suffix. Uniqueness then rests only on the COALESCE segment.
`clock_timestamp()` advances per row and keeps the suffix meaningful.

Final per-row update mirrors lines 234-243 with one addition:
`suggested_category_id = NULL`. The current hook clears suggestions
(src/hooks/useBulkTransactionActions.tsx:25) and the UI depends on that
contract. The single RPC does not clear suggestions; this is a deliberate
bulk-only behavior, kept from the current hook.

Per-row exception trap: `BEGIN ... EXCEPTION WHEN OTHERS THEN` collects
`(id, SQLERRM)` into `skipped` and continues. A failed row must not roll
back the other rows' entries.

After the loop: one `PERFORM rebuild_account_balances(p_restaurant_id)` when
at least one row changed.

Result shape (precedent: `bulk_delete_bank_transactions` returns jsonb with
`success` and counts, 20260301000001 lines 170-175):

```json
{
  "success": true,
  "categorized_count": 0,
  "reclassified_count": 0,
  "unchanged_count": 0,
  "skipped": [{ "id": "uuid", "reason": "text" }]
}
```

## 6. Design decision 2: hook change

`useBulkCategorizeTransactions` (src/hooks/useBulkTransactionActions.tsx:15-57)
keeps its signature. The mutationFn chunks `transactionIds` into batches of
500 and calls the RPC once per chunk, in sequence:

```ts
const { data, error } = await supabase.rpc('bulk_categorize_bank_transactions', {
  p_transaction_ids: chunk,
  p_category_id: categoryId,
  p_restaurant_id: restaurantId,
});
```

Throw on `error` or on `!result.success`. Aggregate the counts and the
`skipped` arrays across chunks and return the aggregate.

Invalidation must cover every query the new journal entries change. Mirror
`useCategorizeTransactions` (src/hooks/useCategorizeTransactions.tsx:38-41):
invalidate `['bank-transactions']`, `['income-statement']`,
`['balance-sheet']`, and `['chart-of-accounts']`. The current hook
invalidates only `['bank-transactions']`
(src/hooks/useBulkTransactionActions.tsx:36); with the default 30s
`staleTime` (src/lib/react-query-config.ts:33) the income statement would
show stale zeros right after a bulk categorize.

Toasts (design-review findings folded):

- Success toast count = `categorized_count + reclassified_count` only.
  `unchanged_count` rows produced no ledger change; when it is above zero,
  the toast description names it ("N already had this category").
- When `skipped` is not empty, show a `toast.error` with the skipped count
  and the reason counts grouped ("3 reconciled, 2 in a closed period"),
  `duration: 10000`. The codebase uses only `toast.success/error/info`;
  `toast.warning` is unproven under the current theme
  (src/components/ui/sonner.tsx:13).
- `onError` shows `error.message`, not the current fixed string
  (src/hooks/useBulkTransactionActions.tsx:50-55). Precedent:
  `useBulkDeleteTransactions` at line 97.

Call sites (src/pages/Transactions.tsx:29,52 and src/pages/Banking.tsx:36,84)
need no change. Both already disable the submit control while the mutation
is pending (src/pages/Transactions.tsx:565, src/pages/Banking.tsx:869).

The Undo stub stays as-is (out of scope). Note: after this fix the stub sits
next to a real accounting mutation, so its follow-up task gains weight.

## 7. Design decision 3: backfill as a kept, rerunnable function

One migration file, timestamp after `20260815110000` (newest on
origin/main), generated at file-creation time:

1. `CREATE FUNCTION backfill_bank_transaction_journal_entries() RETURNS jsonb`,
   SECURITY DEFINER, `SET search_path = public, pg_temp`.
   `REVOKE EXECUTE FROM PUBLIC, anon, authenticated;` then
   `GRANT EXECUTE ... TO service_role;` — the revoke from PUBLIC also strips
   `service_role`, so the explicit grant is required for the reuse story.
   Precedents that pair the revoke with the grant:
   supabase/migrations/20260804090300_bounded_categorization_sweep.sql:601-604
   and supabase/migrations/20260721150000_revel_sold_at_timezone_backfill.sql:280-284.
   It is a maintenance function, not an API.
2. `SET statement_timeout = 0;` then `SELECT backfill_bank_transaction_journal_entries();`
   then `RESET statement_timeout;`. The function stays in the database so a
   later repair (for example after the trigger fix lands) is one call.

Why a kept function: pgTAP can call it against fixtures, and the two
out-of-scope producers keep creating bad rows until their fixes land.

Candidate predicate (verified against production on 2026-08-19; 2,328 rows,
0 reconciled, 0 zero-amount, 0 inactive categories, 0 closed periods, no
duplicate `stripe_transaction_id` groups):

```sql
FROM bank_transactions bt
JOIN chart_of_accounts cat
  ON cat.id = bt.category_id
 AND cat.restaurant_id = bt.restaurant_id
 AND cat.is_active = true
WHERE bt.is_categorized = true
  AND bt.category_id IS NOT NULL
  AND bt.is_transfer = false
  AND NOT EXISTS (journal entry with reference_type = 'bank_transaction',
                  reference_id = bt.id, restaurant_id = bt.restaurant_id)
  AND NOT EXISTS (closed fiscal period covering bt.transaction_date)
  AND EXISTS (cash account '1000' for bt.restaurant_id)
```

The cash account joins via a `LEFT JOIN LATERAL ... LIMIT 1` to mirror the
single RPC's `LIMIT 1` (20260709120000 line 149) and to prevent fan-out if a
restaurant ever has two accounts with code `1000`.

Insert shape, one statement, idempotent:

```sql
WITH ins AS (
  INSERT INTO journal_entries (restaurant_id, entry_date, entry_number,
    description, reference_type, reference_id, total_debit, total_credit, created_by)
  SELECT ... , NULL          -- created_by is nullable; no auth context in a migration
  FROM candidates
  ON CONFLICT ON CONSTRAINT unique_journal_entry_reference DO NOTHING
  RETURNING id, reference_id, restaurant_id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id,
  debit_amount, credit_amount, description)
SELECT ...   -- two lines per entry, sign convention CASE, from ins JOIN candidates
```

Lines insert only for entries the CTE actually created, so a rerun after a
partial state creates nothing twice. Entry numbers use the RPC format with
`clock_timestamp()` plus a `row_number()` suffix segment; the suffix
guarantees uniqueness inside one statement even for equal timestamps.
Description of the entry: `bt.description` (the single RPC uses
`COALESCE(p_description, v_transaction.description)` and the bulk path has
no description parameter).

`entry_date` in both new functions is
`(bt.transaction_date AT TIME ZONE 'UTC')::date`, written explicitly.
Background: `bank_transactions.transaction_date` is TIMESTAMPTZ
(supabase/migrations/20251021195308_82a73d7e-12b8-49e6-b3ab-975a7b822f5c.sql)
and `journal_entries.entry_date` is DATE
(supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:165).
The single RPC assigns one to the other with an implicit cast at the session
time zone (20260709120000 line 172/213). PostgREST sessions run with
`TimeZone = UTC`, so every existing entry carries the UTC calendar day. The
explicit UTC cast keeps the new entries consistent with the existing ledger
and deletes the dependence on the session GUC (a migration session could
carry a different `TimeZone`). A restaurant-local cast in only the new paths
would split the ledger into two date conventions. The restaurant-local
question covers the single RPC too; it is filed as a follow-up task.

After the insert: loop `PERFORM rebuild_account_balances(restaurant_id)` for
each distinct affected restaurant (6 in production). Return jsonb with
`entries_created`, `lines_created`, `restaurants_rebuilt`. The migration
wraps the call in `DO $$ ... RAISE NOTICE ... $$` so CI logs show the counts.

Local `db reset` runs the migration against an empty database; the function
returns zeros and the migration is a no-op there.

## 8. Test plan (detail in the Phase 3 plan)

| Layer | File | Covers |
|---|---|---|
| pgTAP | supabase/tests/bulk_categorize_bank_transactions.sql | membership raise, inactive category raise, missing cash account raise, empty array raise, over-500 array raise, entry creation for negative and positive amounts, sign convention, suggestion cleared, same-category no-op, reclassification entry + `transaction_reclassifications` row, reconciled + uncategorized skip reason, reconciled + categorized reclassification succeeds, closed-period skip reason, cross-tenant id in `skipped`, result shape |
| pgTAP | supabase/tests/backfill_bank_transaction_journal_entries.sql | fixture rows gain entries with correct lines, idempotent rerun, transfer excluded, closed-period excluded, restaurant without cash account excluded |
| Vitest | tests/unit/useBulkTransactionActions.test.ts | RPC called with correct params, 501+ ids chunk into two calls with aggregated result, error path throws with the RPC message, skipped rows show an error toast with grouped reasons, all four query keys invalidated |
| Playwright | tests/e2e (extend banking spec) | bulk categorize marks rows categorized in the UI |

pgTAP impersonation: `SELECT set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);`.

## 9. Risks

- The bulk RPC traps exceptions per row. A bug in the trap could hide
  failures. Mitigation: the result reports every skipped id and reason, and
  the hook surfaces the count.
- The backfill writes ~2,328 `journal_entries` and ~4,656
  `journal_entry_lines` in production. The user approved these counts.
  Idempotency rests on constraint `unique_journal_entry_reference`
  (UNIQUE on reference_type, reference_id).
- `rebuild_account_balances` for 6 restaurants runs inside the migration.
  Verified shape: a per-account loop over active accounts. The
  `statement_timeout = 0` wrapper covers slow runs.
- Rows created by the two remaining producers after this migration runs stay
  broken until the follow-up tasks land. The kept backfill function makes a
  repeat repair cheap.
