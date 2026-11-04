# Plan: auto-link pending outflows to bank transactions

Date: 2026-08-30
Branch: claude/distracted-tharp-1e7635
Design doc: docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
(Status: Reviewed — all Phase 2.5 findings applied.)

Read the design doc before any task. It holds the decided semantics.
This plan holds the build order, the file list, and the verification
gates. When the plan and the design doc disagree, the design doc wins.

## Build order

Build SQL first, frontend second, E2E last. Write each test before its
implementation (TDD). Run `npm run db:reset` after each migration task.

### Task 1: migration — columns, normalize, internal function

Files:
- `supabase/migrations/20260830100000_auto_link_pending_outflows.sql`
- `supabase/tests/69_auto_link_pending_outflows.sql` (write first)

Steps:
1. Write the pgTAP test file with the design §10 cases for the internal
   function: happy path with category (journal entry, two lines,
   transaction flags, outflow flags, `auto_linked_at`), happy path
   without category (link only, transaction stays uncategorized), every
   no-link case (two outflows tie, two transactions tie, vendor
   mismatch, amount off by $0.02, posting outside the 14-day window,
   posting before the issue date, transaction is transfer / split /
   excluded / reconciled / categorized / already linked, outflow is
   cleared or voided or suppressed), notes-merge idempotence on a second
   call, closed fiscal period skips the pair, `p_skip_rebuild = true`
   leaves `account_balances` unchanged, and the grants checks
   (service_role only).
2. Write the migration:
   - `ALTER TABLE pending_outflows ADD COLUMN auto_linked_at
     timestamptz, ADD COLUMN auto_link_suppressed_at timestamptz;`
   - `normalize_match_text(text)`: IMMUTABLE, lowercase, delete every
     character outside a-z0-9.
   - `auto_link_pending_outflows_internal(p_restaurant_id uuid,
     p_batch_limit integer default 100, p_skip_rebuild boolean default
     false) RETURNS (linked_count integer, candidate_count integer)`.
     SECURITY DEFINER, `SET search_path = pg_catalog, public`. Follow
     design §5 (criteria) and §6 (write semantics) exactly: lock both
     rows with `FOR UPDATE SKIP LOCKED`, re-check both, per-pair
     exception handler, closed-period skip, journal upsert with
     `created_by` NULL, `ORDER BY created_at LIMIT 1` for the upload.
   - REVOKE from PUBLIC / anon / authenticated; GRANT to service_role.
3. `npm run db:reset`, then `npm run test:db`. All new tests green.

Warning: keep the template at
`supabase/migrations/20260820210300_sweep_local_entry_day.sql` open.
Copy its claim, journal-upsert, and exception shapes.

### Task 2: migration — unlink RPC

Files:
- `supabase/migrations/20260830100100_unlink_pending_outflow.sql`
- `supabase/tests/70_unlink_pending_outflow.sql` (write first)

Steps:
1. Write the pgTAP cases: full revert with journal deletion and flag
   reset, `category_kept = true` when the transaction is reconciled,
   `category_kept = true` when the category changed after the link,
   membership guard raises for an outsider and for a staff role, unlink
   sets `auto_link_suppressed_at`, a second internal-function run does
   not re-link the pair, unlink computes the correct stale status for an
   outflow with an old `issue_date` (31 / 61 / 91 days), grants (anon
   revoked).
2. Write the RPC per design §7: SECURITY DEFINER,
   `SET search_path = pg_catalog, public`, owner/manager guard, the
   revert-safety condition list, the status computation from
   `issue_date` age, `rules_evaluated_at = '-infinity'` on revert,
   `rebuild_account_balances` after a revert.
3. `npm run db:reset`, then `npm run test:db`.

### Task 3: migration — sweep third loop

Files:
- `supabase/migrations/20260830100200_sweep_auto_link_loop.sql`
- `supabase/tests/51_standing_categorization_sweep.sql` (extend first)

Steps:
1. Extend the conformance test: the link loop sits after the
   `'bank_transactions'` marker and before
   `'categorization drain: applied'`; its slice references only
   `v_budget` and `v_budget_hit_link`; it references no POS flag and no
   bank flag (mirror tests 8 and 9). Confirm the existing pins still
   pass unchanged.
2. CREATE OR REPLACE `drain_categorization_backlog()` with the third
   loop per design §4: restaurants with at least one eligible open
   outflow, random order, `p_skip_rebuild = true`, one
   `rebuild_account_balances` per restaurant when `linked_count > 0`,
   budget check against `v_budget` with the new `v_budget_hit_link`
   flag, per-restaurant exception handler with `query_canceled` named.
3. `npm run db:reset`, then `npm run test:db`.

### Task 4: migration — partial index

File: `supabase/migrations/20260830100300_idx_bank_transactions_auto_link.sql`

One statement, with the `-- supabase: no-transaction` header and no
BEGIN (shape: 20260814148000_idx_bank_transactions_restaurant_date.sql):
`CREATE INDEX CONCURRENTLY IF NOT EXISTS
idx_bank_transactions_auto_link ON bank_transactions
(restaurant_id, amount, transaction_date) WHERE is_categorized = false
AND is_split = false AND is_transfer = false AND excluded_reason IS NULL
AND is_reconciled = false;`

Run `npm run db:reset` and `npm run test` — the migration uniqueness
test must stay green.

### Task 5: Stripe sync inline call

File: `supabase/functions/stripe-sync-transactions/index.ts`

After the `apply_rules_to_bank_transactions_internal` call (line ~386),
add a best-effort `auto_link_pending_outflows_internal` call with
`p_skip_rebuild: true`, in its own try/catch. A failure logs and does
not fail the sync. Do not touch the final rebuild path (~line 428).

### Task 6: frontend — types and match helper

Files:
- `src/types/pending-outflows.ts` — add `auto_linked_at` and
  `auto_link_suppressed_at` to `PendingOutflow`.
- `src/lib/pendingOutflowMatching.ts` (new) —
  `selectBestMatchPerTransaction(matches)`: group by
  `bank_transaction_id`, keep the top score, threshold
  `match_score >= 70`.
- `tests/unit/pendingOutflowMatching.test.ts` (write first) — grouping,
  threshold boundary (69.9 / 70), tie keeps the highest, empty input.

Run `npm run test`.

### Task 7: frontend — one-click suggestion on the transaction row

Files:
- `src/components/banking/BankTransactionList.tsx`
- `src/components/banking/MemoizedTransactionRow.tsx`
- `src/hooks/usePendingOutflows.tsx` (only if the match query needs a
  restaurant-wide caller export; prefer reuse)

Follow design §8 exactly:
- Fetch the matches and the open outflows at list level. Join each best
  match to its outflow by `pending_outflow_id` for `vendor_name` and
  `reference_number`.
- Compute the per-row value inside the existing `displayValues`
  `useMemo` (BankTransactionList.tsx:126-148). Add the map to the
  dependency array. New field name: `pendingOutflowMatch`.
- Row subtitle in the for_review state with vendor, reference number,
  and a "Match" button. The button calls the hoisted `confirmMatch`
  mutation, calls `e.stopPropagation()`, and disables while pending.
  Per-row pending check:
  `confirmMatch.variables?.bankTransactionId === transaction.id &&
  confirmMatch.isPending`.
- Keep the `MemoizedTransactionRow` comparator contract: no new hook
  inside the row, displayValues compared by reference.

Run `npm run typecheck` and `npm run lint`.

### Task 8: frontend — undo match on the outflow card

Files:
- `src/hooks/usePendingOutflows.tsx` — new `unlinkMatch` mutation that
  calls `unlink_pending_outflow`, invalidates the same six query keys
  as `confirmMatch` (lines 303-309), and maps the `category_kept = true`
  result to an informational toast.
- `src/components/pending-outflows/PendingOutflowCard.tsx` — cleared
  branch (lines 229-243): "Undo match" button (styling template lines
  194-211, `e.stopPropagation()`, disabled while pending, gated by
  `hasCapability('edit:pending_outflows')`) and an "Auto-matched" badge
  when `auto_linked_at` is set (badge template lines 233-238).

Run `npm run typecheck` and `npm run lint`.

### Task 9: E2E

File: `tests/e2e/pending-outflow-auto-link.spec.ts` (new)

One flow with helpers from `'../helpers/e2e-supabase'` and
`generateTestUser()`: create a pending outflow with a category, insert a
matching bank transaction, call
`auto_link_pending_outflows_internal` through the service-role client
(deterministic — do not wait for a cron), reload, check the outflow
shows Cleared with the "Auto-matched" badge and the transaction shows
categorized, click "Undo match", check the outflow returns to open and
the transaction returns to For Review. Use `page.getByRole()` /
`page.getByLabel()` selectors.

## Verification gate (hard, before the PR)

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run test:e2e
```

All five must pass. Fix failures before Phase 8.

## Risks

- The sweep conformance pins are brittle by design. Change test 51 only
  as Task 3 step 1 describes.
- Migration prefixes 20260830100000-100300 are claimed for this branch.
  Peer branch claude/angry-shirley-1fe1ad holds 20260830120000. Do not
  renumber.
- `progress.md` is gitignored. Stage explicit paths only; never
  `git add -A`.
