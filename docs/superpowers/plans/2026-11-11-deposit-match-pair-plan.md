# Deposit Match group pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `refresh_deposit_matches` link 2–3 adjacent POS days to 1–2 bank deposits when the sums agree.

**Architecture:** One new migration replaces `public.refresh_deposit_matches`. The new body is the current body plus an item scope (for groups that cross the range edge) and a step 3b group pass in a nested exception block. Step 5 and the schema do not change.

**Tech Stack:** PostgreSQL 15 PL/pgSQL, Supabase migrations, pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-11-deposit-match-pair-design.md`

## Global Constraints

- Write all comments, commit messages, and the PR body STE-aligned (`docs/STE100_STYLE.md`).
- Source body: copy `supabase/migrations/20260904150000_deposit_match_business_day_lag.sql:116-410` exactly, then change it. Do not copy older bodies.
- Keep the signature `(p_restaurant_id uuid, p_start_date date, p_end_date date) RETURNS void`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, the capability check, and the REVOKE/GRANT lines.
- No schema change. No change to `src/`.
- New `match_reason` values: `group_gross_fit`, `group_net_fee_fit`.
- Item group: 2 or 3 items, consecutive calendar `business_date`. Deposit set: 1 or 2 deposits. Deposit cap: 12 per item group.
- Generate the migration timestamp with `date -u +%Y%m%d%H%M%S` when you create the file. Before the PR, check that no other file in `supabase/migrations/` has the same 14-digit prefix.
- Run `npm run db:reset` after each edit to the migration, then the pgTAP tests.
- Stage files with explicit paths (`git -C <worktree> add <path>`). Never `git add -A`. Never bare `git stash`.

## Review Focus

1. A refresh range that starts or ends inside a group: both items must stay `matched` (Task 4 test).
2. A group with 1 confirmed and 1 suggested link must never occur: one state per group (Task 2 test).
3. An error in the group pass must keep the 1:1 links and must not set `rule_error` (Task 3 test).
4. A zero or negative `expected_amount` must not divide by zero or break `allocated_amount > 0` (Task 3 test).
5. A deposit that is already confirmed for another rule or by a manual link must not join a group (Task 3 test).

---

## File Structure

- Create: `supabase/migrations/<ts>_deposit_match_group_pass.sql` — the new function body.
- Create: `supabase/tests/deposit_match_group_pass_test.sql` — all group-pass tests.
- Read only: `supabase/tests/deposit_match_lag_window_test.sql` — fixture pattern (users, restaurants, `user_restaurants` role `owner` with `role_id 'b0000000-0000-0000-0000-000000000001'`, `SET LOCAL role TO postgres`, `connected_banks` with `status 'connected'` and `data_current_through = CURRENT_DATE + interval '1 year'`, a focus rule with `source_config '{"card_tender_names": ["Visa"]}'`, direct inserts into `deposit_match_items` and `bank_transactions`, then `set_config('request.jwt.claim.sub', <owner>, true)` and `lives_ok(refresh)`).

**Test dates.** Business days skip only Saturday and Sunday (`deposit_match_business_days_after`, `…_business_day_lag.sql`). Use fixed past dates. A matched status does not depend on `CURRENT_DATE`, and an unmatched past item is always `late`. Anchors: 2026-08-15 is a Saturday, 2026-08-16 a Sunday, 2026-08-17 a Monday, 2026-08-18 a Tuesday. Put deposits at `13:30:00+00`. Use a new UUID prefix (`aaaaaaaa-7000-…`) and a separate restaurant per case group, so cases do not share open deposits.

---

### Task 1: Group pass for gross rules (core)

**Files:**
- Create: `supabase/migrations/<ts>_deposit_match_group_pass.sql`
- Create: `supabase/tests/deposit_match_group_pass_test.sql`

**Interfaces:**
- Produces: the new function body with a step 3b block, and new local variables `v_group RECORD`, `v_state text`, `v_taken_items uuid[]`, `v_taken_txns uuid[]`. Later tasks extend this block.

- [ ] **Step 1: Write the failing tests** (gross rule, lag 1–3, `amount_tolerance 5`, `amount_tolerance_pct 0.005`, `descriptor_pattern 'SHIFT4'`)
  - Case A (prod shape 2→2): items Sat 971.56, Sun 1263.05; deposits Mon 1000.72, Tue 1233.89.
    - `is(status, 'matched')` for both items.
    - `is(count(links), 3)` for the 2 items.
    - `is(sum(allocated_amount) per item, expected_amount)` for both items (971.56, 1263.05).
    - `is(sum(allocated_amount) per deposit, amount)` for both deposits.
    - every link: `match_reason = 'group_gross_fit'`, `state = 'confirmed'`, `method = 'auto'`.
  - Case B (weekend 2→1): items Sat 400.00, Sun 600.00; deposit Mon 1000.00. Both `matched`; 2 links.
  - Case C (3→2): items Fri 300.00, Sat 500.00, Sun 700.00; deposits Mon 640.00, Tue 860.00. All 3 `matched`; `count(links) <= 4`.
  - Case D (no fit): items Sat 971.56, Sun 1263.05; deposits Mon 1000.72, Tue 1250.00 (off by 16.28). Both `late`; 0 links.
  - Case E (1:1 wins): items Sat 500.00 and Sun 700.00; deposits Mon 500.00 and Tue 690.00. Sat links 1:1 with `match_reason 'gross_fit'`. Sun stays `late` (690 is 10 off) and has 0 links.
  - Case F (gap day): items Fri 400.00 and Sun 600.00 (no Sat item); deposit Mon 1000.00. Both `late`; 0 links.
  - Case G (idempotent): call refresh a second time on Case A's restaurant. The set of `(item_id, bank_transaction_id, allocated_amount, state)` is the same as after the first call (compare with `results_eq` on a temp table snapshot).

- [ ] **Step 2: Run the tests and check that they fail**
  Run: `npm run test:db`
  Expected: FAIL in `deposit_match_group_pass_test.sql` on Case A `matched` (got `late`).

- [ ] **Step 3: Write the migration**
  - Copy the body (see Global Constraints). Add a header comment that names the design doc.
  - After the 1:1 `END LOOP` and before Step 5, add step 3b in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING 'refresh_deposit_matches: group pass failed for rule %: %', v_rule.id, SQLERRM; END;`.
  - Candidate query (one `FOR v_group IN … LOOP`), as CTEs:
    1. `open_items`: the design's "Open items" filters, plus `NOT (id = ANY(v_assigned_items))`.
    2. `item_groups`: self-joins on `business_date + 1` (and `+ 2` for size 3). Columns: `item_ids uuid[]` (date order), `expected_amounts numeric[]`, `first_date`, `e_sum`, and the per-item window bounds.
    3. `open_txns`: the design's "Open deposits" filters, plus `NOT (id = ANY(v_assigned_txns))`.
    4. `group_txns`: for each item group, the open deposits inside the window of at least 1 item, ranked by `abs(transaction_date::date - first_date)`, keep `rank <= 12`.
    5. `deposit_sets`: single deposits, and pairs with `t1.id < t2.id`. Columns: `txn_ids uuid[]` and `txn_amounts numeric[]` in `(transaction_date, id)` order, `d_sum`.
    6. `candidates`: the gross test from the design, plus `fit_score = abs(e_sum - d_sum)`.
  - Order by `fit_score, cardinality(item_ids) + cardinality(txn_ids), first_date, txn_ids`.
  - In the loop: skip the group if any item is in `v_taken_items` or any deposit is in `v_taken_txns`. Compute the shares and the waterfall (design "Allocation"). Insert 1 link per non-zero piece with `match_reason 'group_gross_fit'`. Append to the taken arrays.
  - In Task 1, set `v_state := 'confirmed'`. Task 2 replaces this.

- [ ] **Step 4: Run the tests and check that they pass**
  Run: `npm run db:reset && npm run test:db`
  Expected: PASS for all files, including the existing deposit-match tests.

- [ ] **Step 5: Commit**
  ```bash
  git -C <worktree> add supabase/migrations/<ts>_deposit_match_group_pass.sql supabase/tests/deposit_match_group_pass_test.sql
  git -C <worktree> commit -m "feat(deposit-match): link adjacent days to their deposits as a group"
  ```

### Task 2: Net rules and the group state

**Files:**
- Modify: `supabase/migrations/<ts>_deposit_match_group_pass.sql` (step 3b)
- Modify: `supabase/tests/deposit_match_group_pass_test.sql`

**Interfaces:**
- Consumes: the step 3b loop from Task 1.

- [ ] **Step 1: Write the failing tests**
  - Case H (net 2→2): net rule, `fee_pct_min 1.6`, `fee_pct_max 3.1`. Items Sat 1000.00, Sun 1000.00; deposits Mon 600.00, Tue 1360.00 (group fee 2.0%; no deposit fits 1:1). Both `matched_net`; reason `group_net_fee_fit`; `fee_amount > 0` for both.
  - Case I (ambiguous): gross rule. Items Sat 400.00, Sun 600.00; deposits Mon 1000.00 and Tue 1001.00 (each fits as 2→1). Every link of the chosen group has `state = 'suggested'`. Both items `needs_review` with `status_reason 'ambiguous_match'`. `count(DISTINCT state)` over the group links is 1.

- [ ] **Step 2: Run the tests and check that they fail**
  Run: `npm run test:db`
  Expected: FAIL on Case H (`late`) and Case I (`confirmed`).

- [ ] **Step 3: Change step 3b**
  - Add the net test from the design to `candidates`, and `fit_score = abs(e_sum * (1 - (fee_pct_min + fee_pct_max) / 2.0 / 100.0) - d_sum)` for net.
  - Set `match_reason` from `v_rule.settlement`.
  - Collect all candidates into an array or temp result before the loop. For the chosen group, `v_state := 'confirmed'` only if no other candidate shares an item id or a txn id (`&&` on the arrays). Else `'suggested'`. Write `v_state` on every link of the group.

- [ ] **Step 4: Run the tests and check that they pass**
  Run: `npm run db:reset && npm run test:db`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git -C <worktree> add supabase/migrations/<ts>_deposit_match_group_pass.sql supabase/tests/deposit_match_group_pass_test.sql
  git -C <worktree> commit -m "feat(deposit-match): match net groups and give one state to each group"
  ```

### Task 3: Guards

**Files:**
- Modify: `supabase/migrations/<ts>_deposit_match_group_pass.sql` (step 3b)
- Modify: `supabase/tests/deposit_match_group_pass_test.sql`

- [ ] **Step 1: Write the failing tests**
  - Case J (`expected_amount <= 0`): items Sat -10.00, Sun 1000.00; deposit Mon 990.00. No 1:1 fit (Sun is off by 10). Without the guard, the group sum fits exactly and Sat gets a share of -10.00. Expected: 0 links; Sun `late`; no item has `status_reason 'rule_error'`.
  - Case K (allocation guard, zero share): items Sat 0.01, Sun 0.01; deposit Mon 0.01. The gross sum test passes (diff 0.01). The shares are 0.01 and 0.00, so the last share fails `a_i > 0`. Expected: 0 links; both items `late`; no `rule_error`.
  - Case L (other rule's deposit): a second rule on the same bank holds a confirmed manual link to deposit Mon. The group from Case B shape does not use that deposit; both items `late`.
  - Case M (manual link): Case A shape, plus a manual confirmed link from Sat to an unrelated deposit. Sun is not grouped; Sun has 0 auto links.
  - Case N (stale bank): Case A shape on a bank with `data_current_through = '2026-08-16'`. 0 group links; both items `incomplete` / `bank_stale`.
  - Case O (error isolation): only if the implementer finds a safe way to force an error inside step 3b; else skip and note it in the PR body.

- [ ] **Step 2: Run the tests and check that they fail**
  Run: `npm run test:db`
  Expected: at least Case J or Case K fails (division by zero or the CHECK), or each new case passes already. Record which in the commit body.

- [ ] **Step 3: Change step 3b**
  - `open_items`: add `expected_amount > 0`.
  - In the loop, before the insert: compute all shares, then check every share `> 0` and the Step 5 band for each item, with the exact Step 5 expressions (design "Allocation guard"). Skip the group if a check fails. A skipped group does not take its items or deposits.

- [ ] **Step 4: Run the tests and check that they pass**
  Run: `npm run db:reset && npm run test:db`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git -C <worktree> add supabase/migrations/<ts>_deposit_match_group_pass.sql supabase/tests/deposit_match_group_pass_test.sql
  git -C <worktree> commit -m "fix(deposit-match): guard the group pass against bad shares and taken deposits"
  ```

### Task 4: Item scope for groups that cross the range edge

**Files:**
- Modify: `supabase/migrations/<ts>_deposit_match_group_pass.sql` (Step 2, Step 3, step 3b, Step 5, rule-level handler)
- Modify: `supabase/tests/deposit_match_group_pass_test.sql`

**Interfaces:**
- Produces: local `v_scope_items uuid[]`, computed per rule after Step 1.

- [ ] **Step 1: Write the failing test**
  - Case P (partial range): Case A shape. Refresh `'2026-08-01'..'2026-08-31'` first. Then refresh `'2026-08-16'..'2026-08-31'` (starts on Sun). Both items `matched`; 3 links; `sum(allocated_amount)` per item equals `expected_amount`.

- [ ] **Step 2: Run the test and check that it fails**
  Run: `npm run test:db`
  Expected: FAIL. Sun is `late` or `short`, because Sat's link still holds the Mon deposit.

- [ ] **Step 3: Add the scope**
  - After Step 1: `v_scope_items` = ids of this rule's items in `p_start_date..p_end_date`, plus ids of this rule's items that have an auto link on a `bank_transaction_id` that an auto link of those in-range items also uses.
  - Replace `business_date BETWEEN p_start_date AND p_end_date` with `id = ANY(v_scope_items)` (or `i.id = ANY(...)`) in Step 2, the 1:1 candidate query, step 3b `open_items`, Step 5, and the rule-level `EXCEPTION` handler.
  - Keep the date range in Step 1 and in the `rule_inactive` update.

- [ ] **Step 4: Run the tests and check that they pass**
  Run: `npm run db:reset && npm run test:db`
  Expected: PASS for all files.

- [ ] **Step 5: Commit**
  ```bash
  git -C <worktree> add supabase/migrations/<ts>_deposit_match_group_pass.sql supabase/tests/deposit_match_group_pass_test.sql
  git -C <worktree> commit -m "fix(deposit-match): refresh whole groups when the range cuts a group"
  ```

### Task 5: Final checks

- [ ] **Step 1:** Run `npm run db:reset && npm run test:db`. Expected: all pgTAP files pass.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm run test`. Expected: no new errors (no `src/` change).
- [ ] **Step 3:** Run `ls supabase/migrations | cut -c1-14 | sort | uniq -d`. Expected: no output.
- [ ] **Step 4:** In the PR body, add the prod check from the design ("Verification in production") and the follow-up for `useConfirmDepositMatchLink` (design "Decided trade-offs").
