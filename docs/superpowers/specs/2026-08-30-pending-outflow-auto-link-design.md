# Auto-link pending outflows to bank transactions

Date: 2026-08-30
Branch: claude/distracted-tharp-1e7635
Status: Reviewed — Phase 2.5 findings applied (frontend 14, supabase 10)

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
| `pending_outflows` table | supabase/migrations/20251107141500_pending_outflows.sql:2 | Schema, RLS, stale-status thresholds |
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
   The loop gets its own budget flag `v_budget_hit_link`. It checks the
   flag against the shared 40-second `v_budget`, the same ceiling the bank
   loop checks (20260804091000_standing_categorization_sweep.sql:49-59,129).
   The loop reads neither `v_budget_pos`, `v_budget_hit_pos`, nor
   `v_budget_hit_bank`.
   Warning: the conformance test
   `supabase/tests/51_standing_categorization_sweep.sql` slices the
   function body at the literal markers `'pos_sales'`,
   `'bank_transactions'`, and `'categorization drain: applied'`. It pins
   which budget flags each slice references. The new loop sits between the
   bank loop and the final RAISE LOG. The new loop references only
   `v_budget` and `v_budget_hit_link`, so the existing pins stay green. A
   new pgTAP test must pin the same properties for the link loop: it runs
   after the bank loop, and it references no POS flag and no bank flag, so
   it cannot starve the rules loops (mirror of tests 8 and 9 in that
   file).
2. **Stripe sync.** In `supabase/functions/stripe-sync-transactions/index.ts`,
   after the existing rules call, add a best-effort call to the new
   function. Wrap it in try/catch like the rules call. Use the same
   service-role client. Pass `p_skip_rebuild: true`, the same flag the
   rules call passes (index.ts:386-390). The edge function always calls
   `rebuild_account_balances` again on its no-violation path, so an
   internal rebuild here would run twice inside the ~10s CPU budget.
   Pass `p_batch_limit: 25` — a small bound for the same CPU budget.
   The 5-minute sweep links any remainder (performance review).
   The function has no `auth.uid()` check, which is required here because
   `auth.uid()` is NULL for service-role callers
   (comment at 20260820210300_sweep_local_entry_day.sql:216-217).

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
   `[po.issue_date, po.issue_date + 14 days]` (inclusive on both ends,
   so 15 calendar days). Derive the day with
   `bank_txn_entry_day(bt.transaction_date, restaurant.timezone)`, the
   single sanctioned derivation
   (20260820210300_sweep_local_entry_day.sql:154, PR #766 lesson at
   line 82-83). The window is forward-only: a payment posts on or after its
   issue date. A posting before the issue date signals a data-entry
   mismatch and stays in the suggestion flow.
3. **Vendor:** one shared boolean function, `vendor_text_match(a, b)`,
   holds the comparison. Two normalizers feed it (both IMMUTABLE):
   `normalize_match_text(text)` lowercases and removes every character
   that is not a-z or 0-9; `normalize_match_tokens(text)` lowercases and
   collapses every non-alphanumeric run to one space. The rules,
   symmetric in both directions:
   - Both sides must normalize to length >= 3.
   - Plain containment counts only when the contained string has 5+
     characters: outflow "Sysco Foods LLC" vs bank merchant "SYSCO", and
     outflow "Sysco" vs bank description "SYSCO FOODS 8812".
   - A 3-4 character string matches only at a token boundary: vendor
     "Cox" matches description "RENT AND COX 4411" but not "RANDCORP".
     Without this rule a short string can match across a word boundary
     ('dco' inside 'rentandcox'), and the containment check gates an
     unreviewed financial write (sound-logic review).
   The bank side checks `merchant_name`, `description`, and
   `normalized_payee` — the same fields the fuzzy score reads plus the
   normalized payee (20251107202635_...sql:57-60; `normalized_payee` on
   the BankTransaction interface, src/hooks/useBankTransactions.tsx).
   Both the candidate scan and the post-claim re-validation call
   `vendor_text_match`, so the two sites cannot drift apart. The amount
   and window predicates stay inline in the candidate join — the planner
   needs them sargable for `idx_bank_transactions_auto_link` — with
   mirror comments at both sites.
4. **Uniqueness in both directions:** exactly one eligible outflow matches
   the transaction, and exactly one eligible transaction matches that
   outflow. Any tie disqualifies both sides for this pass. Ties fall back
   to the one-click suggestion.

Eligible transaction: `amount < 0`, `is_categorized = false`,
`is_split = false`, `is_transfer = false`, `excluded_reason IS NULL`,
`is_reconciled = false`, and no pending outflow already links to it.
Three of these mirror the `confirmMatch` guards on `is_transfer`,
`is_split`, and `excluded_reason`
(src/hooks/usePendingOutflows.tsx:176-180). The rest are new criteria the
function defines itself: `amount < 0` and `is_categorized = false` scope
the automatic path, and `is_reconciled = false` is the check
`confirmMatch` delegates to the categorize RPC
(20260820210100_categorize_local_entry_day.sql:110-112).

Scope note: the automatic link touches only uncategorized transactions.
`confirmMatch` can match an already-categorized transaction after a user
confirms it (src/hooks/usePendingOutflows.tsx:215-231). An automatic
reclassification is too aggressive for a background job. When a rule
categorizes the transaction first, the pair stays visible in the manual
match flow (src/components/pending-outflows/ManualMatchDialog.tsx).

Eligible outflow: `status IN ('pending','stale_30','stale_60','stale_90')`,
`linked_bank_transaction_id IS NULL`, and
`auto_link_suppressed_at IS NULL`. The first two match the open set the
fuzzy RPC uses (20251107202635_...sql:75-76). The suppression column is
new (section 7): the unlink RPC sets it, so an undone pair does not
re-link on the next sweep tick. Suppression applies to the outflow, not
to one pair. After an undo, the user links that outflow by hand or
through the one-click suggestion, which stays available.

## 6. Auto-link write semantics

The function mirrors `confirmMatch` (src/hooks/usePendingOutflows.tsx:134-301)
in one database transaction per pair, with per-row exception handling like
the rules sweep (20260820210300_sweep_local_entry_day.sql:339-348):

1. Claim both rows with `FOR UPDATE SKIP LOCKED`: first the outflow row,
   then the bank transaction row, the same claim pattern as the rules
   batch (20260820210300_sweep_local_entry_day.sql:97-111). Re-check both
   rows' eligibility after the claim. A plain re-read is not enough: the
   rules sweep, a manual `categorize_bank_transaction` call, or a bulk
   categorize can commit between a read and the write. The row lock on
   `bank_transactions` closes that race. It makes the sync-inline call
   and the sweep call safe to run concurrently.
2. Merge notes. Skip the merge when the bank notes already contain the
   outflow notes; else join with a blank line
   (src/hooks/usePendingOutflows.tsx:182-189).
3. When the outflow has a `category_id` and that category is active:
   - Guard the closed fiscal period on the local entry day
     (20260820210300_sweep_local_entry_day.sql:156-166). A closed period
     skips this pair; it does not abort the batch. `pending_outflows` has
     no per-row evaluation stamp, so a period-blocked pair re-runs on
     every 5-minute tick until the period opens. This is acceptable: the
     scan is bounded by the open outflows per restaurant, typically tens
     of rows.
   - Upsert the journal entry by `reference_type = 'bank_transaction'` and
     `reference_id`, the shared upsert shape
     (20260820210300_sweep_local_entry_day.sql:218-252). Entry prefix
     `BANK`, description `Matched pending outflow: <vendor_name>`,
     `created_by` NULL (nullable per the comment at line 216-217).
   - Insert the two journal lines: debit the category, credit cash account
     1000 (20260820210300_sweep_local_entry_day.sql:309-313).
   - Update the transaction: `category_id`, `is_categorized = true`,
     `suggested_category_id = po.category_id`, merged notes. In
     `confirmMatch`, the categorize RPC call writes `category_id` and
     `is_categorized` (src/hooks/usePendingOutflows.tsx:238-244); line 250
     sets only `suggested_category_id`. The SQL function writes all three
     in its own UPDATE.
4. When the outflow has no category: write the merged notes only. The
   transaction stays in For Review (src/hooks/usePendingOutflows.tsx:252-255).
5. Update the transaction metadata: `matched_at = now()` (parity:
   src/hooks/usePendingOutflows.tsx:209-210) and `matched_by = NULL`.
   `matched_by = NULL` is new behavior, not parity — `confirmMatch` never
   writes `matched_by` (the column exists, src/types/supabase.ts:868).
   NULL marks a background writer. Set `expense_invoice_upload_id` from
   the outflow's earliest upload, with an explicit
   `ORDER BY created_at LIMIT 1` in the SQL. The client code takes index
   `[0]` of an unordered embedded relation
   (src/hooks/usePendingOutflows.tsx:257-261, no `ORDER BY`), so the SQL
   function is stricter than the client here, not a mirror.
6. Update the outflow: `status = 'cleared'`,
   `linked_bank_transaction_id`, `cleared_at = now()`, and the new column
   `auto_linked_at = now()` (src/hooks/usePendingOutflows.tsx:272-276 for
   the first three).
7. After the loop: `rebuild_account_balances(p_restaurant_id)` when
   `linked_count > 0` and `p_skip_rebuild` is false
   (20260820210300_sweep_local_entry_day.sql:351-353).

Schema changes: add two nullable columns to `pending_outflows`.
`auto_linked_at TIMESTAMPTZ` — NULL means a manual link; the column
drives the "Auto-matched" badge and the undo eligibility display.
`auto_link_suppressed_at TIMESTAMPTZ` — set by the unlink RPC; a non-null
value removes the outflow from the auto-link candidate set (section 5).

Function shape: `SECURITY DEFINER` with
`SET search_path = pg_catalog, public`, the stricter precedent
(`bank_txn_entry_day` and `apply_rules_to_bank_transactions_internal`).
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
SECURITY DEFINER, `SET search_path = pg_catalog, public`, with an
`auth.uid()` membership guard
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
4. Reset the outflow: `linked_bank_transaction_id = NULL`,
   `cleared_at = NULL`, `auto_linked_at = NULL`, and
   `auto_link_suppressed_at = now()`. The suppression stamp stops the
   sweep from a re-link of the same pair on its next tick (section 5).
   Compute `status` inline from the age of `issue_date`, with the same
   thresholds as `mark_stale_pending_outflows()`
   (20251107141500_pending_outflows.sql:98-121): 'stale_90' past 90 days,
   then 'stale_60', then 'stale_30', else 'pending'. No cron job runs
   `mark_stale_pending_outflows()` — checked against the production
   `cron.job` table (16 jobs, none calls it) — so a plain 'pending' reset
   would stay wrong forever on an old outflow.

UI:

- `PendingOutflowCard` cleared branch: add an "Undo match" button next to
  the "Cleared" timestamp
  (src/components/pending-outflows/PendingOutflowCard.tsx:229-243). Gate it
  with `hasCapability('edit:pending_outflows')`, the existing capability
  check on the card (PendingOutflowCard.tsx:179). The card root is
  clickable (PendingOutflowCard.tsx:105-116), so the button's onClick
  must call `e.stopPropagation()` like every sibling button. Disable the
  button while the unlink mutation is pending. Reuse the styling of the
  existing Match button (PendingOutflowCard.tsx:194-211). Show an
  "Auto-matched" badge when `auto_linked_at` is set, styled like the
  "Needs category" badge (PendingOutflowCard.tsx:233-238).
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
- The RPC returns no `vendor_name` and no `reference_number` — its
  RETURNS TABLE has only the two ids, `match_score`, `amount_delta`,
  `date_delta`, and `payee_similarity` (20251107202635_...sql:2-10). The
  list joins each best match to the loaded outflow list by
  `pending_outflow_id` to get the display fields.
- The Banking list computes the map once at list level, inside the
  existing `displayValues` `useMemo`
  (src/components/banking/BankTransactionList.tsx:126-148). The matches
  map joins that `useMemo` and its dependency array. The per-row value
  rides in a new `displayValues` field `pendingOutflowMatch` — a new
  field, not a reuse of `hasSuggestion` — which keeps the
  `MemoizedTransactionRow` comparator contract (displayValues compared by
  reference).
- Row UI: a subtitle line under the description in the for_review state,
  next to the existing linked-info subtitle position
  (src/components/banking/MemoizedTransactionRow.tsx, LinkedInfoSubtitle),
  with the outflow vendor, reference number, and a "Match" button.
  The button calls the existing `confirmMatch` mutation hoisted at list
  level (single mutation instance, same pattern as `useCategorizeTransaction`
  at src/components/banking/BankTransactionList.tsx:109). The button's
  onClick calls `e.stopPropagation()` so a click does not toggle row
  selection. The button disables while its mutation is pending.
- The Match button disables for one row while that row's confirm runs
  (the subtitle stays visible). The per-row check is
  `confirmMatch.variables?.bankTransactionId === transaction.id` together
  with `isPending` — not a broadcast pending flag. The match queries
  invalidate on success (src/hooks/usePendingOutflows.tsx:303-309).
- Two surfaces can suggest the same pair: this row subtitle and the
  outflow card's "Match Found" flow. Both call the same `confirmMatch`
  mutation, and its guards make a second confirm a safe no-op.

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
  overlap. The `FOR UPDATE SKIP LOCKED` claim on both rows — the outflow
  and the bank transaction — plus the post-claim re-check makes the pair
  write once. The transaction-row lock stops a lost update against the
  rules sweep, a manual categorize, or a bulk categorize.
- **Budget.** The third sweep loop shares the existing 40-second budget and
  follows the bank loop, so it never starves rules. Its scan is bounded by
  the count of open outflows per restaurant (typically tens of rows).

## 10. Migrations and tests

Migrations (unique 14-digit prefixes; current maximum is
20260821190923, so 202608301xxxxx is safe; the uniqueness test is
tests/unit/migrationVersionUniqueness.test.ts):

1. `20260830100000_auto_link_pending_outflows.sql` — the
   `pending_outflows.auto_linked_at` and `auto_link_suppressed_at`
   columns, `normalize_match_text`, `normalize_match_tokens`,
   `vendor_text_match`, `auto_link_pending_outflows_internal`, grants.
2. `20260830100100_unlink_pending_outflow.sql` — the unlink RPC, grants.
3. `20260830100200_sweep_auto_link_loop.sql` — CREATE OR REPLACE of
   `drain_categorization_backlog()` with the third loop.
4. `20260830100300_idx_bank_transactions_auto_link.sql` —
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ON bank_transactions
   (restaurant_id, amount, transaction_date) WHERE is_categorized = false
   AND is_split = false AND is_transfer = false AND excluded_reason IS
   NULL AND is_reconciled = false`. No existing index covers this scan:
   `idx_bank_transactions_restaurant_categorized` covers only
   `(restaurant_id, is_categorized)`, and the partial rule-candidates
   index keys on `rules_evaluated_at`, which this scan never uses. The
   file starts with the `-- supabase: no-transaction` header and has no
   BEGIN, the same shape as
   20260814148000_idx_bank_transactions_restaurant_date.sql:1-2.

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
- Unlink, then run the internal function again: the pair does not
  re-link (`auto_link_suppressed_at` blocks it).
- `p_skip_rebuild = true`: the function links the pair and does not
  change `account_balances`.
- Unlink sets the correct stale status for an old outflow (issue_date
  more than 30/60/90 days back).
- Sweep conformance in `51_standing_categorization_sweep.sql`: the
  existing pins stay green, plus new pins for the link loop — it sits
  after the bank loop and references only `v_budget` and
  `v_budget_hit_link` (mirror of tests 8 and 9).

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
