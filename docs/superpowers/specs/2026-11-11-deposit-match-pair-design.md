# Design: Deposit Match group pass (multi-day deposits)

Date: 2026-11-11
Branch: `feature/deposit-match-pair`
Base: `origin/main` at `18a92670e`

## Problem

The engine links 1 POS item to 1 bank deposit. Shift4 sometimes pays
2 adjacent business days as 2 deposits. No single deposit matches a
single day. The sum of the days matches the sum of the deposits.

Example: a focus rule (gross, lag 1–3 business days, tolerance $5.00
or 0.5%, descriptor `SHIFT4`). A production case has this shape. The
amounts below are synthetic.

| Side | Date | Amount |
|---|---|---|
| POS item | Sat Oct 31 | 948.37 |
| POS item | Sun Nov 1 | 1,251.63 |
| Deposit | Mon Nov 2 | 978.12 |
| Deposit | Tue Nov 3 | 1,221.88 |
| **Sum** | | **2,200.00 on both sides** |

The 2 deposits have no links in production (query on 2026-11-11). The
2 items show `late` / `past_lag_max`. No money is missing. The engine
cannot express this case.

### Why the engine cannot match this case

- The candidate loop scores 1 item against 1 transaction
  (`supabase/migrations/20260904150000_deposit_match_business_day_lag.sql:205-260`).
- The match test compares 1 expected amount with 1 deposit amount
  (`…_business_day_lag.sql:265-276`). The best 1:1 fit is
  |948.37 − 978.12| = 29.75. The tolerance is
  GREATEST(5.00, 948.37 × 0.005) = 5.00. The test fails.
- A pair that fails the test consumes nothing
  (`…_business_day_lag.sql:278-283`). Both items stay open.
- Step 5 finds no confirmed link and no suggested link. After the lag
  window closes, it sets `late`
  (`…_business_day_lag.sql:379-391`).

## Goal

After the 1:1 pass, add a group pass. The group pass links a group of
adjacent open items to a set of open deposits when the sums agree. The
prod case must end as 2 `matched` items.

## Non-goals

- No schema change. No new column, table, or CHECK.
- No UI change. `get_deposit_match_report` returns `links` with
  `match_reason`
  (`supabase/migrations/20260903140000_deposit_match_report_bank_suggestions.sql:96-105`),
  and `src/types/depositMatch.ts:96` types it. No component reads
  `links` today. See "Decided trade-offs" for the confirm hook.
- No 1-item-to-2-deposits split. The prod data does not show it. It
  adds false-positive risk.
- No change to the 1:1 match logic or to the Step 5 status logic.

## Design

### Refresh scope (change to Step 2)

Step 2 deletes only the auto links of items inside
`p_start_date..p_end_date` (`…_business_day_lag.sql:186-193`). A group
can cross the range edge. Example: a refresh of Nov 1–Nov 7 deletes
the Nov 1 link, but keeps the Oct 31 link. The Oct 31 link still holds
a confirmed allocation on the Nov 2 deposit. The 1:1 filter then
excludes that deposit (`…_business_day_lag.sql:241-245`), and Nov 1
becomes `late`.

Fix: the function computes a scope of items before Step 2.

1. `v_scope_items` = the rule's existing items in
   `p_start_date - 2 .. p_end_date + 2`. A group spans at most 3 days,
   so the margin puts each adjacent day of a group in the scope, also on
   the first refresh, when no link exists yet.
2. Add each item of this rule that has an auto link on a bank
   transaction that an auto link of a scope item also uses. Repeat this
   step until it adds no new item (maximum 5 rounds). A 3to2 group is a
   chain (a-x, b-x, b-y, c-y), so one round does not always reach each
   item. Test case Q covers the chain.
3. Step 1 (the dispatch) runs after the closure. It covers the range,
   the margins, and the date of each scope item. Each scope item then
   has a current `expected_amount`. The new items of the margins go
   into the scope.
4. Step 2, the 1:1 pass, the group pass, and Step 5 use
   `id = ANY(v_scope_items)` in place of the date range.

### Where the group pass runs

The new step 3b runs after the 1:1 loop ends
(`…_business_day_lag.sql:324`) and before Step 5
(`…_business_day_lag.sql:326`). It reads the 2 arrays that the 1:1
loop fills: `v_assigned_items` and `v_assigned_txns`
(`…_business_day_lag.sql:202-203`, `:322-323`).

Step 3b runs in its own nested `BEGIN … EXCEPTION WHEN OTHERS` block.
On an error, Postgres rolls back only the group links. The 1:1 links
stay. The block does `RAISE WARNING` with the rule id and `SQLERRM`.
Without this block, an error reaches the rule-level handler
(`…_business_day_lag.sql:400-403`), which sets every item of the rule
to `rule_error`.

### Open items

An item is open for the group pass when all of these are true:

- It is in `v_scope_items`.
- `expected_amount > 0`.
- It is not in `v_assigned_items`. (The 1:1 pass gave it no link, also
  no suggested link.)
- It has no link at all. (A manual link excludes the item. This is the
  same test as `…_business_day_lag.sql:234`.)
- The bank passes the freshness gate for this item. This is the same
  gate as `…_business_day_lag.sql:246-258`: `v_bank.status =
  'connected'`, `data_current_through IS NOT NULL`, and
  `data_current_through >= deposit_match_lag_window_start(business_date,
  lag_days_max)`.

### Open deposits

A bank transaction is open for the group pass when all of these are
true:

- The same filters as the 1:1 join: same restaurant, same connected
  bank, `amount > 0`, `is_transfer IS NOT TRUE`, the descriptor regex
  (`…_business_day_lag.sql:217-232`).
- It is not in `v_assigned_txns`.
- It has no confirmed link (`…_business_day_lag.sql:241-245`).

### Group shapes

- **Item group:** 2 or 3 open items with consecutive calendar
  `business_date` values. Example: Oct 31 + Nov 1. A gap of 1 day
  breaks the group.
- **Deposit set:** 1 or 2 open deposits.
- **Window:** each deposit must be in the half-open window of at least
  1 item of the group. The window is
  `deposit_match_lag_window_start(business_date, lag_days_min)` to
  `deposit_match_lag_window_end(business_date, lag_days_max)`, the same
  as `…_business_day_lag.sql:227-230`.
- **Deposit cap:** for each item group, the query uses at most the 12
  open deposits nearest to the first `business_date`. The window
  bounds are computed once per item group, not once per row.

The shapes are 2→1, 2→2, 3→1, and 3→2. The 2→1 shape is the usual
weekend batch (Saturday and Sunday paid in 1 Monday deposit).

### Match test for a group

Let E be the sum of the expected amounts. Let D be the sum of the
deposits.

- **Gross:** `abs(E − D) <= GREATEST(amount_tolerance, E ×
  amount_tolerance_pct)`. This is the same formula as
  `…_business_day_lag.sql:265`, applied to E.
- **Net:** `(E − D) / E` is between `fee_pct_min / 100` and
  `fee_pct_max / 100`. This is the same formula as
  `…_business_day_lag.sql:269-276`, applied to E and D. E is always
  more than 0, because each open item has `expected_amount > 0`.

### Allocation

The links table requires `allocated_amount > 0`
(`supabase/migrations/20260901140000_deposit_match_tables.sql:83`). A
trigger caps the sum of confirmed allocations for each transaction at
the transaction amount (`…_tables.sql:261-306`). Thus a deposit can
split across items.

1. Each item gets a target share in proportion to its expected amount:
   `a_i = round(D × e_i / E, 2)`. The last item gets `D − sum(other
   a_i)`, so the shares sum to D exactly.
2. Deposits fill the items in a waterfall. Order the deposits by
   `transaction_date`, then `id`. Order the items by `business_date`.
   Each deposit fills the current item up to its share. The remainder
   goes to the next item.
3. Each non-zero piece becomes 1 link. The maximum is k + m − 1 links
   (4 links for the 3→2 shape). Each (item, deposit) pair gets at most
   1 piece, so `UNIQUE (item_id, bank_transaction_id)` holds
   (`…_tables.sql:89`). The pieces of a deposit sum to its amount, so
   the cap trigger holds.

Example case: D = E = 2,200.00, so the shares equal the expected amounts.

| Link | Item | Deposit | allocated_amount |
|---|---|---|---|
| 1 | Oct 31 | Nov 2 (978.12) | 948.37 |
| 2 | Nov 1 | Nov 2 (978.12) | 29.75 |
| 3 | Nov 1 | Nov 3 (1,221.88) | 1,221.88 |

**Why Step 5 needs no change.** Each item's diff is
`e_i − a_i = e_i × (E − D) / E`. For gross, `|e_i × (E − D) / E| <=
max(abs_tol × e_i / E, e_i × pct) <= GREATEST(abs_tol, e_i × pct)`.
This is the item tolerance in Step 5 (`…_business_day_lag.sql:336`).
For net, each item's implied fee is `(E − D) / E`, which is inside the
fee band of Step 5 (`…_business_day_lag.sql:348-349`, `:370`).

**Allocation guard.** The cent rounding can move 1 item by up to
$0.01. Before the pass accepts a group, it checks 2 conditions:

- Every share `a_i > 0`, also the last share.
- For each item, `e_i − a_i` is inside the Step 5 band. The check uses
  the exact Step 5 expressions: `v_tol`, `v_fee_lo`, `v_fee_hi`, and
  `v_diff BETWEEN (v_fee_lo − v_tol) AND (v_fee_hi + v_tol)`
  (`…_business_day_lag.sql:336-349`, `:370`).

A group that fails the guard is skipped. Thus Step 5 classifies an
accepted group as `matched` or `matched_net`.

### Selection order and conflicts

1. One SQL query lists every candidate group (item group × deposit
   set) that passes the match test and the allocation guard.
2. The order is: the fit score (`abs(E − D)` for gross,
   `abs(E × (1 − mid_fee) − D)` for net, the same as
   `…_business_day_lag.sql:209-215`), then fewer links, then the
   earliest first `business_date`, then the deposit ids.
3. The loop takes each group in that order. It skips a group if any
   item or deposit is already taken in this pass.

### Link state

- The state belongs to the group. The pass computes `v_state` once per
  group and writes it on every link of that group. A mixed state gives
  a partial `received_amount`, and Step 5 then sets `short`.
- `v_state = 'confirmed'` when no other candidate group from step 1 of
  the selection shares an item or a deposit with the chosen group. The
  test uses the full candidate list, also the groups that the loop
  skips.
- `v_state = 'suggested'` in all other cases. Step 5 then sets
  `needs_review` / `ambiguous_match` (`…_business_day_lag.sql:379-383`).
  This is the same rule as the 1:1 pass
  (`…_business_day_lag.sql:285-319`).

### Match reason

`match_reason` is TEXT with no CHECK (`…_tables.sql:86`). The new
values are `group_gross_fit` and `group_net_fee_fit`.

### Delivery

- A new migration does `CREATE OR REPLACE FUNCTION
  public.refresh_deposit_matches`. Its body is the body from
  `20260904150000_deposit_match_business_day_lag.sql:116-407`, plus
  the scope change and step 3b. The migration
  `20260905090000_deposit_match_toast_captured.sql` does not redefine
  this function.
- The migration keeps the same signature, `SECURITY DEFINER`, the
  `user_has_capability` check, and the grants
  (`…_business_day_lag.sql:409-410`).
- No backfill. The next refresh of the range applies the pass.

## Decided trade-offs

- **Confirm hook.** `useConfirmDepositMatchLink`
  (`src/hooks/useDepositMatch.ts:226`) confirms 1 link. A confirm of 1
  link of a suggested group gives a partial amount. No component calls
  this hook today, so the change does not break the app. A follow-up
  must make the hook confirm all links of a group before a UI uses it.
- **Wide window per group.** Each deposit must be in the window of at
  least 1 item. The design does not also check that each item gets a
  piece from a deposit in its own window. The waterfall ties pieces to
  deposit order, so this check gives little value for its cost.
- **Deposit cap of 12.** A group with its true deposit outside the 12
  nearest deposits stays unmatched. The 1:1 pass already consumes most
  deposits, so this case is rare.

## Risks

- **False positive.** Adjacent leftover days can sum near leftover
  deposits by chance. Controls: only items and deposits that the 1:1
  pass left open; the lag window; the tolerance; the uniqueness test
  that falls back to `suggested`.
- **CPU.** Item groups are O(n) for n open items. Each item group has
  at most 12 deposits, so at most 78 deposit sets. The date range scan
  uses `idx_bank_transactions_bank_date`.
- **Error path.** An error in step 3b rolls back only the group links,
  because of the nested block.

## Tests (pgTAP)

New file `supabase/tests/deposit_match_group_pass_test.sql`. It uses
the setup pattern from `supabase/tests/deposit_match_lag_window_test.sql`.
Dates that drive a time-based status use offsets from `CURRENT_DATE`.

1. Prod shape 2→2, gross: both items `matched`; 3 links; allocation
   sums are correct; reason `group_gross_fit`; state `confirmed`.
2. Weekend 2→1, gross: both items `matched`; 2 links.
3. Shape 3→2: all 3 items `matched`; at most 4 links.
4. Net 2→2 with the implied fee inside the band: both items
   `matched_net`; reason `group_net_fee_fit`.
5. Ambiguous: 2 deposit sets fit the same group. All links of the
   group are `suggested`; the items are `needs_review`.
6. No fit: the group sum is outside the tolerance. No group links.
7. The 1:1 pass wins: an item with a 1:1 match is not in a group.
8. A gap day: items 2 days apart do not form a group.
9. A manual link on 1 item excludes that item from groups.
10. Stale bank: the freshness gate blocks the group.
11. An item with `expected_amount <= 0` is not in a group, and the
    rule does not get `rule_error`.
12. Allocation guard: a group that passes the sum test but fails the
    per-item band is skipped.
13. A deposit confirmed by another rule is not in a group.
14. Partial range: a refresh that starts on the second day of a group
    keeps both items `matched`.
15. Idempotent: a second refresh gives the same links.
16. The existing deposit-match tests still pass.

## Verification in production

After deploy, the user refreshes the Deposit Match page for this
restaurant. Then a read query (SELECT) checks the result. Expected
result: Oct 31 and Nov 1 become `matched`, with 3 links to the deposits
of Nov 2 and Nov 3.
