# Auto-link pending outflows to bank transactions

Date: 2026-08-30
Branch: claude/distracted-tharp-1e7635
Status: Draft for Phase 2.5 review

## 1. Problem

A user records a pending outflow (a check or a planned expense). Later the
bank transaction posts for the same expense. Today the user must match them
by hand on the Pending Outflows page
(src/components/pending-outflows/PendingOutflowCard.tsx:194-211). An
unmatched pair counts twice in the dashboard totals: once as the open
outflow, once as the categorized bank transaction.

## 2. Required behavior

1. When a bank transaction posts, find open pending outflows with the same
   amount and the same vendor inside a 14-day window.
2. When exactly one candidate matches on amount, vendor, and window, link
   them automatically.
3. For ambiguous matches, show a one-click suggestion on the transaction.
4. The user can undo an automatic link.

## 3. Existing building blocks

| Piece | Location | Role |
|---|---|---|
| `suggest_pending_outflow_matches` RPC | supabase/migrations/20251107202635_d3d7b103-e55c-48ba-824b-548edb1ae703.sql:2 | Scores fuzzy matches for the suggestion UI |
| `confirmMatch` mutation | src/hooks/usePendingOutflows.tsx:134 | Applies a match with all guards; the auto-link must mirror it |
| `apply_rules_to_bank_transactions_internal` | supabase/migrations/20260820210300_sweep_local_entry_day.sql:18 | The service-role write pattern: batch claim, journal entry upsert, per-row error handling |
| `drain_categorization_backlog()` | supabase/migrations/20260804091000_standing_categorization_sweep.sql:27 | The standing 5-minute pg_cron driver |
| `categorize_bank_transaction` RPC | supabase/migrations/20260820210100_categorize_local_entry_day.sql:17 | The user-context categorize path; checks `auth.uid()` at line 52-59 |
| `pending_outflows` table | supabase/migrations/20251107141500_pending_outflows.sql:2 | Schema, RLS, stale cron |
| `bank_transactions.matched_at`, `matched_by` | supabase/migrations/20251018183326_*.sql | Match metadata columns already exist |
| For-review row UI | src/components/banking/MemoizedTransactionRow.tsx | Where the one-click suggestion surfaces |
| Linked-outflow join | src/hooks/useBankTransactions.tsx (buildBaseQuery `linked_outflows`) | The list already loads the linked outflow |

## 4. Design question 1: where does the auto-link run?

**Decision: a new service-role SQL function with two drivers — the standing
sweep and the Stripe sync edge function. Not an INSERT trigger.**

Reasons:

- The codebase removed a BEFORE INSERT categorization trigger 9 days ago
  (supabase/migrations/20260821190923_remove_bank_categorization_insert_trigger.sql:1-14).
  The trigger raced the standing sweep and wrote no journal entry. The
  chosen pattern is: the sweep owns background categorization work.
- The established pattern for background financial writes is a
  SECURITY DEFINER `_internal` function with EXECUTE granted only to
  `service_role`
  (supabase/migrations/20260820210300_sweep_local_entry_day.sql:366-369).
- The Stripe sync edge function already calls the internal rules function
  inline after it inserts new rows
  (supabase/functions/stripe-sync-transactions/index.ts, the
  `apply_rules_to_bank_transactions_internal` call). The auto-link call goes
  in the same place for fast feedback on the main sync path.
- The statement-import path
  (src/hooks/useBankStatementImport.tsx:551) and manual paths get coverage
  from the sweep, with at most 5 minutes of delay.

New function: `auto_link_pending_outflows_internal(p_restaurant_id uuid,
p_batch_limit integer default 100, p_skip_rebuild boolean default false)`.
It returns `(linked_count integer, candidate_count integer)`.

Drivers:

1. **Standing sweep.** Add a third loop to `drain_categorization_backlog()`
   after the bank rules loop
   (supabase/migrations/20260804091000_standing_categorization_sweep.sql:116-168).
   The loop selects restaurants with at least one open, unlinked pending
   outflow. It runs in random order under the same shared 40-second budget.
   It calls the new function with `p_skip_rebuild = true` and calls
   `rebuild_account_balances` once per restaurant when `linked_count > 0`,
   the same shape as the bank rules loop
   (20260804091000_standing_categorization_sweep.sql:151-156).
   The loop runs after rules so rules claim rows first.
   Warning: the conformance test
   `supabase/tests/51_standing_categorization_sweep.sql` pins properties of
   this function. The build must keep those pins green.
2. **Stripe sync.** In `supabase/functions/stripe-sync-transactions/index.ts`,
   after the existing rules call, add a best-effort call to the new
   function. Wrap it in try/catch like the rules call. Use the same
   service-role client. The function has no `auth.uid()` check, which is
   required here because `auth.uid()` is NULL for service-role callers
   (comment at 20260820210300_sweep_local_entry_day.sql:57-58).

## 5. Design question 2: how does vendor matching work?

**Decision: strict deterministic criteria for the automatic link. The
existing fuzzy score stays for suggestions only.**

The existing RPC score is too weak for an automatic financial write. Its
vendor test is a first-5-characters LIKE
(20251107202635_d3d7b103-e55c-48ba-824b-548edb1ae703.sql:55-61), its amount
tolerance is $10 (line 80), and its window is 30 days (line 82).

Auto-link criteria (all must hold):

1. **Amount:** exact. `ABS(po.amount + bt.amount) < 0.01`
   (`pending_outflows.amount` is positive, `bank_transactions.amount` is
   negative for outflows — same sign convention as
   20251107202635_...sql:37,78).
2. **Window:** the transaction's restaurant-local entry day falls in
   `[po.issue_date, po.issue_date + 14 days]`. Derive the day with
   `bank_txn_entry_day(bt.transaction_date, restaurant.timezone)`, the
   single sanctioned derivation
   (20260820210300_sweep_local_entry_day.sql:154, PR #766 lesson at
   line 82-83). The window is forward-only: a payment posts on or after its
   issue date. A posting before the issue date signals a data-entry
   mismatch and stays in the suggestion flow.
3. **Vendor:** normalized containment in either direction. Define
   `normalize_match_text(text)`: lowercase, then remove every character
   that is not a-z or 0-9 (IMMUTABLE). Match when one normalized string
   contains the other. Both normalized strings must have length >= 3.
   Containment in either direction handles both truncations:
   outflow "Sysco Foods LLC" vs bank merchant "SYSCO", and outflow "Sysco"
   vs bank description "SYSCO FOODS 8812". The bank side checks
   `merchant_name`, `description`, and `normalized_payee` — the same fields
   the fuzzy score reads plus the normalized payee
   (20251107202635_...sql:57-60; `normalized_payee` on the BankTransaction
   interface, src/hooks/useBankTransactions.tsx).
4. **Uniqueness in both directions:** exactly one eligible outflow matches
   the transaction, and exactly one eligible transaction matches that
   outflow. Any tie disqualifies both sides for this pass. Ties fall back
   to the one-click suggestion.

Eligible transaction: `amount < 0`, `is_categorized = false`,
`is_split = false`, `is_transfer = false`, `excluded_reason IS NULL`,
`is_reconciled = false`, and no pending outflow already links to it. This
is the `confirmMatch` guard list
(src/hooks/usePendingOutflows.tsx:176-180) plus `is_reconciled`, which
`confirmMatch` delegates to the categorize RPC
(20260820210100_categorize_local_entry_day.sql:110-112) and the auto-link
must check itself.

Scope note: the automatic link touches only uncategorized transactions.
`confirmMatch` can match an already-categorized transaction after a user
confirms it (src/hooks/usePendingOutflows.tsx:215-231). An automatic
reclassification is too aggressive for a background job. When a rule
categorizes the transaction first, the pair stays visible in the manual
match flow (src/components/pending-outflows/ManualMatchDialog.tsx).

Eligible outflow: `status IN ('pending','stale_30','stale_60','stale_90')`,
`linked_bank_transaction_id IS NULL` — the same open set the fuzzy RPC uses
(20251107202635_...sql:75-76).

## 6. Auto-link write semantics

The function mirrors `confirmMatch` (src/hooks/usePendingOutflows.tsx:134-301)
in one database transaction per pair, with per-row exception handling like
the rules sweep (20260820210300_sweep_local_entry_day.sql:339-348):

1. Claim the outflow row with `FOR UPDATE SKIP LOCKED`, the same claim
   pattern as the rules batch
   (20260820210300_sweep_local_entry_day.sql:97-111). Re-check the
   transaction's eligibility after the claim. This makes the sync-inline
   call and the sweep call safe to run concurrently.
2. Merge notes. Skip the merge when the bank notes already contain the
   outflow notes; else join with a blank line
   (src/hooks/usePendingOutflows.tsx:182-189).
3. When the outflow has a `category_id` and that category is active:
   - Guard the closed fiscal period on the local entry day
     (20260820210300_sweep_local_entry_day.sql:156-166). A closed period
     skips this pair; it does not abort the batch.
   - Upsert the journal entry by `reference_type = 'bank_transaction'` and
     `reference_id`, the shared upsert shape
     (20260820210300_sweep_local_entry_day.sql:218-252). Entry prefix
     `BANK`, description `Matched pending outflow: <vendor_name>`,
     `created_by` NULL (nullable per the comment at line 216-217).
   - Insert the two journal lines: debit the category, credit cash account
     1000 (20260820210300_sweep_local_entry_day.sql:309-313).
   - Update the transaction: `category_id`, `is_categorized = true`,
     `suggested_category_id = po.category_id` (confirmMatch parity,
     src/hooks/usePendingOutflows.tsx:250), merged notes.
4. When the outflow has no category: write the merged notes only. The
   transaction stays in For Review (src/hooks/usePendingOutflows.tsx:252-255).
5. Update the transaction metadata: `matched_at = now()`,
   `matched_by = NULL`, and `expense_invoice_upload_id` from the outflow's
   first upload when present (src/hooks/usePendingOutflows.tsx:257-261;
   order by `created_at`, `LIMIT 1` for determinism).
6. Update the outflow: `status = 'cleared'`,
   `linked_bank_transaction_id`, `cleared_at = now()`, and the new column
   `auto_linked_at = now()` (src/hooks/usePendingOutflows.tsx:272-276 for
   the first three).
7. After the loop: `rebuild_account_balances(p_restaurant_id)` when
   `linked_count > 0` and `p_skip_rebuild` is false
   (20260820210300_sweep_local_entry_day.sql:351-353).

Schema change: add `pending_outflows.auto_linked_at TIMESTAMPTZ NULL`.
NULL means a manual link. The column drives the "Auto-matched" badge and
the undo eligibility display.

Grants: `REVOKE ... FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ... TO service_role;`
(pattern: 20260820210300_sweep_local_entry_day.sql:366-369). The pgTAP
grants conformance test must cover the new function
(pattern: supabase/tests/*_secdef_execute_grants style checks).

## 7. Design question 3: how does the user undo an automatic link?

**Decision: a new user-context RPC `unlink_pending_outflow` plus an
"Undo match" action on the cleared outflow card.**

No unlink path exists today. `PendingOutflowCard` renders the cleared state
with no action (src/components/pending-outflows/PendingOutflowCard.tsx:229-243).

RPC: `unlink_pending_outflow(p_pending_outflow_id uuid) RETURNS jsonb`.
SECURITY DEFINER, `SET search_path`, with an `auth.uid()` membership guard
restricted to owner/manager — the same roles the pending_outflows UPDATE
RLS policy allows (20251107141500_pending_outflows.sql:53-69).

Steps:

1. Load the outflow. Require `status = 'cleared'` and a non-null
   `linked_bank_transaction_id`.
2. Revert the categorization only when the link created it and the revert
   is safe. All must hold:
   - `auto_linked_at IS NOT NULL` (the link was automatic),
   - the transaction is categorized with exactly the outflow's
     `category_id`,
   - `is_reconciled = false`,
   - the local entry day is not in a closed fiscal period,
   - a journal entry with `reference_type = 'bank_transaction'` and
     `reference_id = transaction id` exists.
   Then delete that journal entry and its lines, set
   `is_categorized = false`, `category_id = NULL`,
   `suggested_category_id = NULL`,
   `rules_evaluated_at = '-infinity'` so the rules sweep can claim the row
   again (reset precedent:
   20260820210300_sweep_local_entry_day.sql:339-347), and call
   `rebuild_account_balances`.
   When any condition fails, keep the categorization and report
   `category_kept = true` in the result. The UI then tells the user to
   recategorize on the Banking page.
3. Clear the transaction match metadata: `matched_at = NULL`,
   `matched_by = NULL`. Clear `expense_invoice_upload_id` only when it
   equals the outflow's own upload id.
4. Reset the outflow: `status = 'pending'`,
   `linked_bank_transaction_id = NULL`, `cleared_at = NULL`,
   `auto_linked_at = NULL`. The stale cron re-marks old outflows on its
   next run (20251107141500_pending_outflows.sql:98-121), so 'pending' is
   a safe reset value.

UI:

- `PendingOutflowCard` cleared branch: add an "Undo match" button next to
  the "Cleared" timestamp
  (src/components/pending-outflows/PendingOutflowCard.tsx:229-243). Gate it
  with `hasCapability('edit:pending_outflows')`, the existing capability
  check on the card (PendingOutflowCard.tsx:179). Show an "Auto-matched"
  badge when `auto_linked_at` is set.
- Mutation in `usePendingOutflowMutations`, invalidating the same six
  query keys as `confirmMatch`
  (src/hooks/usePendingOutflows.tsx:303-309).

Notes stay merged after an unlink. The merge is additive text and a
reversal risks deleting user edits.

## 8. One-click suggestion on the transaction

For ambiguous matches, the transaction row in For Review shows the best
candidate with a one-click confirm.

- Data: the existing `suggest_pending_outflow_matches` RPC, unchanged. The
  existing hook already fetches restaurant-wide matches when called without
  an outflow id (src/hooks/usePendingOutflows.tsx:38-56).
- A pure helper `selectBestMatchPerTransaction(matches)` in
  `src/lib/pendingOutflowMatching.ts` groups matches by
  `bank_transaction_id` and keeps the top-scored candidate with
  `match_score >= 70`. 70 is the existing "medium confidence" boundary
  (src/components/pending-outflows/MatchSuggestionCard.tsx score colors).
  This helper gets Vitest unit tests.
- The Banking list computes the map once at list level and passes the
  per-row value inside `displayValues`, which keeps the
  `MemoizedTransactionRow` comparator contract (displayValues compared by
  reference; map rebuilt in the existing `useMemo`,
  src/components/banking/BankTransactionList.tsx:126-148).
- Row UI: a subtitle line under the description in the for_review state,
  next to the existing linked-info subtitle position
  (src/components/banking/MemoizedTransactionRow.tsx, LinkedInfoSubtitle),
  with the outflow vendor, reference number, and a "Match" button.
  The button calls the existing `confirmMatch` mutation hoisted at list
  level (single mutation instance, same pattern as `useCategorizeTransaction`
  at src/components/banking/BankTransactionList.tsx:109).
- The suggestion hides while the confirm mutation for that row is pending,
  and the match queries invalidate on success
  (src/hooks/usePendingOutflows.tsx:303-309).

The fuzzy RPC filters to `bt.is_categorized = false`
(20251107202635_...sql:77), so suggestions only appear on For Review rows.
That matches the surface: the categorized tab has no suggestion column.

## 9. Interplay and ordering

- **Rules first.** In the sweep tick, the rules loop runs before the
  auto-link loop. A rule that categorizes a transaction removes it from the
  auto-link candidate set (section 5 scope note). The pair then resolves
  through the manual match flow.
- **Auto-link then rules.** A transaction the auto-link categorizes leaves
  the rules candidate set, because the sweep only claims rows with
  `is_categorized = false OR category_id IS NULL`
  (20260820210300_sweep_local_entry_day.sql:105).
- **Concurrent drivers.** The sync-inline call and the sweep call can
  overlap. The `FOR UPDATE SKIP LOCKED` claim on the outflow plus the
  post-claim re-check of the transaction make the pair write once.
- **Budget.** The third sweep loop shares the existing 40-second budget and
  follows the bank loop, so it never starves rules. Its scan is bounded by
  the count of open outflows per restaurant (typically tens of rows).

## 10. Migrations and tests

Migrations (unique 14-digit prefixes; current maximum is
20260821190923, so 202608301xxxxx is safe; the uniqueness test is
tests/unit/migrationVersionUniqueness.test.ts):

1. `20260830100000_auto_link_pending_outflows.sql` —
   `pending_outflows.auto_linked_at` column, `normalize_match_text`,
   `auto_link_pending_outflows_internal`, grants.
2. `20260830100100_unlink_pending_outflow.sql` — the unlink RPC, grants.
3. `20260830100200_sweep_auto_link_loop.sql` — CREATE OR REPLACE of
   `drain_categorization_backlog()` with the third loop.

pgTAP (`supabase/tests/`):

- Auto-link happy path with category: journal entry, lines, balances,
  transaction flags, outflow flags, `auto_linked_at`.
- Auto-link without category: link only, transaction stays uncategorized.
- No link when: two outflows tie, two transactions tie, vendor mismatch,
  amount off by $0.02, posting outside the 14-day window, posting before
  the issue date, transaction is transfer/split/excluded/reconciled/
  categorized/already linked, outflow is cleared or voided.
- Notes merge idempotence on a second call.
- Closed fiscal period skips the pair and links nothing.
- Unlink: full revert with journal deletion, `category_kept = true` when
  the transaction is reconciled, membership guard raises for an outsider.
- Grants: internal function is service_role-only; unlink revoked from anon.
- Sweep conformance additions in `51_standing_categorization_sweep.sql`
  stay green.

Vitest (`tests/unit/`):

- `pendingOutflowMatching.test.ts` for `selectBestMatchPerTransaction`:
  grouping, threshold, tie-keeps-highest, empty input.
- Migration prefix uniqueness stays green.

E2E (Playwright): one flow — create a pending outflow with a category,
import a matching statement line, wait for the suggestion or trigger the
link, verify the outflow clears and the transaction categorizes, then undo
and verify the revert. The exact trigger mechanics (direct RPC call as
service role vs UI wait) get settled in the plan.

## 11. Out of scope

- Automatic links to already-categorized transactions (manual flow covers
  them).
- Changes to the fuzzy score formula in `suggest_pending_outflow_matches`.
- A backfill that links historical pairs. The sweep processes open
  outflows on its normal cadence after deploy, which is the backfill.
- Suggestion UI on the mobile card view (`BankTransactionCard`) — follow-up.
