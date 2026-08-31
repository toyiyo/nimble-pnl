# Design: auto-link pending outflows to rule-categorized bank transactions

Date: 2026-08-30
Status: draft
Prior design: [2026-08-30-pending-outflow-auto-link-design.md](2026-08-30-pending-outflow-auto-link-design.md)

## 1. Problem

The auto-link function excludes categorized bank transactions. The candidate
scan requires `bt.is_categorized = false`
(`supabase/migrations/20260830100000_auto_link_pending_outflows.sql:171`), and
the post-claim re-check repeats the same flag (`20260830100000:259`).

The sweep runs the bank rules loop before the link loop
(`supabase/migrations/20260830100200_sweep_auto_link_loop.sql`). The rules loop
sets `is_categorized = true` and posts a journal entry
(`supabase/migrations/20260820210300_sweep_local_entry_day.sql:212,325`). For a
vendor with an active rule, the rule always wins the race. The link loop then
never claims the transaction. The result:

1. The pending outflow stays open.
2. The P&L counts the cost twice: once from the rule's journal entry, once
   from the open pending outflow.

The prior design chose this on purpose (§5, §9, §11 of the prior design doc:
"Rules first… the pair then resolves through the manual match flow"). Production
data shows the manual flow does not resolve the pairs. This design revises
that decision.

## 2. Production evidence

The evidence tenant is one production restaurant (fictional name: **Pretzel
Peak**; the real identifiers stay in the session notes, not in this document).
A read-only query applied the full auto-link predicate — exact amount, forward
entry-day window, `vendor_text_match`, uniqueness in both directions — with
only the `is_categorized` filter removed. Result: **16 pairs** that the
auto-link would claim, all blocked only by the `is_categorized` filter.

Classification of the 16 pairs by category agreement:

| Case | Condition | Count | Journal entry present |
|------|-----------|-------|-----------------------|
| A | `po.category_id = bt.category_id` | 13 | all 13 |
| B | `po.category_id IS NULL` | 1 | yes |
| C | categories differ | 2 | both |

Details that drive the design:

- Every Case A and Case B transaction has a journal entry. Some entries carry
  the description prefix `Auto-categorized by rule: ` (the rules sweep wrote
  them). Most carry other descriptions (a person categorized them on the
  Banking page).
- Both Case C pairs are small ($64.86 and $8.07) and both were categorized by
  a person, not by a rule. A person chose a category different from the
  outflow's category.

Conclusion: Case A and Case B cover the double-count. Case C is rare, small,
and human-authored. A background job must not overwrite a person's category
choice, so Case C stays out of scope.

## 3. Options considered

**(a) Widen auto-link eligibility to categorized transactions — chosen.**
The link loop claims a categorized transaction when a journal entry backs the
categorization and the categories agree (or the outflow has none). See §4.

**(b) Make the rules loops skip transactions with a unique pending-outflow
candidate — rejected.** The uniqueness test is a restaurant-global window
computation (`20260830100000:199-213`). The rules sweep claims batch-scoped
rows (`20260820210300`), so the computation does not fit its claim pattern.
The option also does not repair the existing categorized backlog, and it can
leave a transaction uncategorized forever when the outflow never clears.

**(c) Run the link loop before the rules loops — rejected.** Order inside one
tick does not fix cross-tick races: a transaction categorized in an earlier
tick, before the outflow existed, never links. The Stripe sync edge function
also applies rules inline, outside the sweep (`20260830100000:254` documents
this concurrency). The conformance tests pin the loop structure
(`supabase/tests/51_standing_categorization_sweep.sql:320-349`).

## 4. Chosen design

### 4.1 Eligibility: two-stage predicate

Split the candidate predicate into **identity** and **linkability**:

- **Identity** decides whether a transaction is the same payment as an
  outflow: amount, entry-day window, vendor match, plus the base row flags
  (`amount < 0`, `is_split = false`, `is_transfer = false`,
  `excluded_reason IS NULL`, `is_reconciled = false`, not already linked).
  Drop `is_categorized = false` from this stage
  (today at `20260830100000:171`).
- **Linkability** decides whether the background job may act on a unique
  pair. A pair is linkable when the transaction is uncategorized, OR when all
  of these hold:
  1. A journal entry exists for the transaction
     (`reference_type = 'bank_transaction'`, `reference_id = bt.id`).
  2. `po.category_id IS NULL` (Case B) or
     `po.category_id = bt.category_id` (Case A).

Compute the uniqueness windows (`20260830100000:199-213`) over **identity**
pairs, then filter unique pairs by **linkability**. Reason: two outflows that
both match one transaction make the payment identity ambiguous. The category
does not remove that ambiguity, so a Case C pair must still count as a tie.
The same rule applies to a categorized transaction without a journal entry:
it counts for uniqueness, but it is not linkable (mirror of the `confirmMatch`
block at `src/hooks/usePendingOutflows.tsx:258-262`).

Behavior change to document in tests: before this change, a categorized twin
transaction did not count toward uniqueness. Now it does, so an ambiguous
amount/vendor/window group blocks the link. This is the safe direction.

### 4.2 Write shape per case

The post-claim re-validation (`20260830100000:245-288`) recomputes the full
predicate on the locked rows, including the new linkability stage.

- **Uncategorized transaction (existing behavior, unchanged):** the category
  branch posts or replaces the journal entry and categorizes the transaction
  (`20260830100000:316-396`).
- **Case A (categories equal, journal entry exists):** link only. Do not
  touch the journal entry, `category_id`, `is_categorized`, or
  `suggested_category_id`. Write only the merged notes, `matched_at`,
  `matched_by = NULL`, and `expense_invoice_upload_id` on the transaction,
  and the normal link fields on the outflow (`20260830100000:398-405`).
- **Case B (outflow has no category, journal entry exists):** same
  transaction write as Case A. Also copy `bt.category_id` to
  `po.category_id` in the outflow update. This mirrors `confirmMatch`
  (`src/hooks/usePendingOutflows.tsx:317-320`), which copies the
  journal-backed category to the outflow.
- **Case C:** not linkable. The pair stays for the manual match flow.

`rebuild_account_balances` runs only when a call changed ledger data
(`20260830100000:417-419`). Case A and Case B links change no journal rows,
so a call that produced only such links skips the rebuild. Track this with a
"wrote ledger" flag next to `v_linked_count`.

### 4.3 Unlink: revert only entries the auto-link wrote

`unlink_pending_outflow` reverts the categorization when the revert is safe
(`supabase/migrations/20260830100100_unlink_pending_outflow.sql:90-95`). The
current condition list (`auto_linked_at` set, categories equal, journal entry
present) was sufficient when the auto-link always authored the entry. After
this change, a Case A or Case B link points at an entry that a person or a
rule wrote before the link. The revert would delete that entry and reset
`rules_evaluated_at` — destroying work the link never created.

Add one condition to `v_can_revert`: the journal entry description must start
with `Matched pending outflow: `. Only the auto-link writes that prefix
(`20260830100000:347,360`). The rules sweep writes
`Auto-categorized by rule: ` (`20260820210300:212`). The manual RPC writes
`COALESCE(p_description, …)` forms
(`supabase/migrations/20260820210100_categorize_local_entry_day.sql:176,218`).
Each writer overwrites the description on a rewrite, so the current prefix
identifies the last writer.

For a Case A or Case B unlink, `v_can_revert` is false: the function keeps
the categorization, clears the match metadata, and returns
`category_kept = true` — the existing UI path for a kept category.

### 4.4 Index

The partial index `idx_bank_transactions_auto_link` includes
`is_categorized = false` in its predicate
(`supabase/migrations/20260830100300_idx_bank_transactions_auto_link.sql:10`),
so it cannot serve the widened identity scan. A new `no-transaction`
migration creates `idx_bank_transactions_auto_link_v2` with the same key
columns (`restaurant_id`, `amount`, `transaction_date`) and the predicate
without `is_categorized`, `CONCURRENTLY`, then drops the old index.

### 4.5 Sweep: no change

`drain_categorization_backlog` calls
`auto_link_pending_outflows_internal(r.restaurant_id, 100, true)` with an
unchanged signature. The loop order, the budget flags, and the conformance
tests (`supabase/tests/51_standing_categorization_sweep.sql`, tests 10-11)
stay untouched.

## 5. Backfill

The widened function is the backfill. The standing sweep runs every 5 minutes
(pg_cron, `categorization-backlog-drain`). The window predicate compares
`transaction_date` to `issue_date`, not to `now()`, so old pairs stay in
range. On the first tick after deploy, the sweep claims the 14 Case A and
Case B pairs at the evidence tenant and clears the outflows. No data
migration and no manual production write is needed.

Verification plan (read-only):

1. Before deploy, run the classification query from §2 and record the pair
   count.
2. After deploy, wait two sweep ticks, run the same query, and confirm the
   Case A and Case B rows are gone (`status = 'cleared'`,
   `linked_bank_transaction_id` set, `auto_linked_at` set).
3. Confirm the tenant's month COGS decreased by the sum of the cleared
   outflow amounts, and that no `journal_entries` row was created or updated
   for the Case A transactions.

## 6. Test plan

### pgTAP: `supabase/tests/69_auto_link_pending_outflows.sql`

Scenario 9 currently pins "already-categorized transaction: outflow stays
pending" (`supabase/tests/69_auto_link_pending_outflows.sql:246`). Its
fixture transaction has no journal entry, so the row stays skipped under the
new predicate — for a new reason. Rename the assertion to "categorized
transaction without journal entry: outflow stays pending".

New scenarios:

- Case A: categorized transaction + journal entry + equal categories →
  outflow clears, journal entry untouched (same id, same description, same
  lines), transaction `category_id` unchanged, notes merged, `matched_at`
  set.
- Case B: categorized transaction + journal entry + outflow without
  category → outflow clears and receives `bt.category_id`.
- Case C: categorized transaction + journal entry + different categories →
  outflow stays pending, no writes.
- Uniqueness: one outflow, two identity-matching transactions where one is
  categorized → tie, outflow stays pending (the new counting behavior).
- Unlink after a Case A link → `category_kept = true`, journal entry
  survives, categorization survives, `auto_link_suppressed_at` set.
- Unlink after an original-path link (auto-link wrote the entry) →
  revert still works (`category_kept = false`), pinning the description
  marker.
- Rebuild skip: a call that produces only Case A links leaves
  `current_balance` unchanged (mirror of scenario 13,
  `supabase/tests/69_auto_link_pending_outflows.sql:302-321`).

### Conformance: `supabase/tests/51_standing_categorization_sweep.sql`

No changes. Tests 10-11 must stay green as-is.

### Unit tests

`tests/unit/migrationVersionUniqueness.test.ts` must pass with the new
migration timestamps. Current maximum prefix: `20260830120000`. New
migrations use `20260830130000` and later.

## 7. Out of scope

- Case C automatic relink or journal-entry replacement. The manual match
  flow (`confirmMatch`) already handles it with explicit user intent.
- Any change to the rules sweep, the sweep loop order, or the budget flags.
- Frontend changes. `usePendingOutflows` and the match UI keep their
  behavior; the widened link only shrinks the manual queue.
- Suppressed pairs (`auto_link_suppressed_at` set) stay excluded.

## 8. Risks

- **Race with a concurrent recategorize:** a person recategorizes the
  transaction between the scan and the claim. The post-claim re-validation
  recomputes the linkability stage on the locked row, so the pair is skipped
  in that tick and re-evaluated on the next one.
- **Journal-less categorized rows:** legacy rows with `is_categorized = true`
  and no journal entry never link automatically. This matches the manual
  flow's block and keeps them visible in the match UI.
- **Description marker drift:** if a future writer reuses the
  `Matched pending outflow: ` prefix, unlink could delete its entry. The
  pgTAP unlink tests pin the marker in both directions.
