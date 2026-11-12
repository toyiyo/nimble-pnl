# Design: Deposit Match group pass (multi-day deposits)

Date: 2026-11-11
Branch: `feature/deposit-match-pair`
Base: `origin/main` at `18a92670e`

## Problem

The engine links 1 POS item to 1 bank deposit. Shift4 sometimes pays
2 adjacent business days as 2 deposits. No single deposit matches a
single day. The sum of the days matches the sum of the deposits.

Production case: restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`,
focus rule `b2dfa8b6-e895-4166-8066-56d74365fce3` (gross, lag 1–3
business days, tolerance $5.00 or 0.5%, descriptor `SHIFT4`).

| Side | Date | Amount |
|---|---|---|
| POS item | Sat Oct 31 | 971.56 |
| POS item | Sun Nov 1 | 1,263.05 |
| Deposit | Mon Nov 2 | 1,000.72 |
| Deposit | Tue Nov 3 | 1,233.89 |
| **Sum** | | **2,234.61 on both sides** |

The 2 deposits have no links in production (query on 2026-11-11). The
2 items show `late` / `past_lag_max`. No money is missing. The engine
cannot express this case.

### Why the engine cannot match this case

- The candidate loop scores 1 item against 1 transaction
  (`supabase/migrations/20260904150000_deposit_match_business_day_lag.sql:205-260`).
- The match test compares 1 expected amount with 1 deposit amount
  (`…_business_day_lag.sql:265-276`). The best 1:1 fit is
  |971.56 − 1,000.72| = 29.16. The tolerance is
  GREATEST(5.00, 971.56 × 0.005) = 5.00. The test fails.
- A pair that fails the test consumes nothing
  (`…_business_day_lag.sql:278-283`). Both items stay open.
- Step 5 finds no confirmed link and no suggested link. After the lag
  window closes, it sets `late`
  (`…_business_day_lag.sql:376-392`).

## Goal

After the 1:1 pass, add a group pass. The group pass links a group of
adjacent open items to a set of open deposits when the sums agree. The
prod case must end as 2 `matched` items.

## Non-goals

- No schema change. No new column, table, or CHECK.
- No UI change. The UI does not read `links` or `match_reason`. A grep
  of `src/` for `match_reason` and `gross_fit` finds nothing.
- No 1-item-to-2-deposits split. The prod data does not show it. It
  adds false-positive risk.
- No change to Step 5 or to the 1:1 pass.

## Design

### Where the pass runs

The new step 3b runs after the 1:1 loop ends
(`…_business_day_lag.sql:324`) and before Step 5
(`…_business_day_lag.sql:326`). It reads the 2 arrays that the 1:1
loop fills: `v_assigned_items` and `v_assigned_txns`
(`…_business_day_lag.sql:202-203`, `:322-323`). Step 2 already deletes
every auto link in range before each run
(`…_business_day_lag.sql:186-193`). Thus group links are also
idempotent.

### Open items

An item is open for the group pass when all of these are true:

- It belongs to this rule, in the refresh range.
- It is not in `v_assigned_items`. (The 1:1 pass gave it no link, also
  no suggested link.)
- It has no link at all. (A manual link excludes the item. This is the
  same test as `…_business_day_lag.sql:233`.)
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
- It has no confirmed link
  (`…_business_day_lag.sql:240-244`).

### Group shapes

- **Item group:** 2 or 3 open items with consecutive calendar
  `business_date` values. Example: Oct 31 + Nov 1. A gap of 1 day
  breaks the group.
- **Deposit set:** 1 or 2 open deposits.
- **Window:** each deposit must be in the combined window, from
  `deposit_match_lag_window_start(first_date, lag_days_min)` to
  `deposit_match_lag_window_end(last_date, lag_days_max)`. The window
  is half-open, the same as `…_business_day_lag.sql:227-230`.

The shapes are 2→1, 2→2, 3→1, and 3→2. The 2→1 shape is the usual
weekend batch (Saturday and Sunday paid in 1 Monday deposit).

### Match test for a group

Let E be the sum of the expected amounts. Let D be the sum of the
deposits.

- **Gross:** `abs(E − D) <= GREATEST(amount_tolerance, E ×
  amount_tolerance_pct)`. This is the same formula as
  `…_business_day_lag.sql:265`, applied to E.
- **Net:** E ≠ 0, and `(E − D) / E` is between `fee_pct_min / 100` and
  `fee_pct_max / 100`. This is the same formula as
  `…_business_day_lag.sql:269-276`, applied to E and D.

### Allocation

The links table requires `allocated_amount > 0`. A trigger caps the sum
of confirmed allocations for each transaction at the transaction amount
(`supabase/migrations/20260901140000_deposit_match_tables.sql:261-306`).
Thus a deposit can split across items.

1. Each item gets a target share in proportion to its expected amount:
   `a_i = round(D × e_i / E, 2)`. The last item gets `D − sum(other
   a_i)`, so the shares sum to D exactly.
2. Deposits fill the items in a waterfall. Order the deposits by
   `transaction_date`, then `id`. Order the items by `business_date`.
   Each deposit fills the current item up to its share. The remainder
   goes to the next item.
3. Each non-zero piece becomes 1 link. The maximum is k + m − 1 links
   (4 links for the 3→2 shape).

Prod case: D = E = 2,234.61, so the shares equal the expected amounts.

| Link | Item | Deposit | allocated_amount |
|---|---|---|---|
| 1 | Oct 31 | Nov 2 (1,000.72) | 971.56 |
| 2 | Nov 1 | Nov 2 (1,000.72) | 29.16 |
| 3 | Nov 1 | Nov 3 (1,233.89) | 1,233.89 |

**Why Step 5 needs no change.** Each item's diff is
`e_i − a_i = e_i × (E − D) / E`. For gross, `|e_i × (E − D) / E| <=
e_i / E × GREATEST(abs_tol, E × pct)`. This value is not more than
`GREATEST(abs_tol, e_i × pct)`, which is the item tolerance in Step 5
(`…_business_day_lag.sql:336`). For net, each item's implied fee is
`(E − D) / E`, which is inside the fee band of Step 5
(`…_business_day_lag.sql:347-348`, `:370`).

**Rounding guard.** The cent rounding can move 1 item by up to $0.01.
Before the pass accepts a group, it checks the diff of each item
against the Step 5 band. A group that fails this check is skipped. Thus
Step 5 always classifies an accepted group as `matched` or
`matched_net`.

### Selection order and conflicts

1. One SQL query lists every candidate group (item group × deposit set)
   that passes the match test.
2. The order is: the fit score (`abs(E − D)` for gross,
   `abs(E × (1 − mid_fee) − D)` for net, the same as
   `…_business_day_lag.sql:209-215`), then fewer links, then the
   earliest first `business_date`, then the deposit ids.
3. The loop takes each group in that order. It skips a group if any
   item or deposit is already taken in this pass.

### Link state

- `confirmed` when no other matching group shares an item or a deposit
  with the chosen group.
- `suggested` in all other cases. Step 5 then sets `needs_review` /
  `ambiguous_match` (`…_business_day_lag.sql:378-382`). This is the
  same rule as the 1:1 pass (`…_business_day_lag.sql:285-319`).

### Match reason

`match_reason` is TEXT with no CHECK
(`supabase/migrations/20260901140000_deposit_match_tables.sql:83-89`).
The new values are `group_gross_fit` and `group_net_fee_fit`.

### Delivery

- A new migration does `CREATE OR REPLACE FUNCTION
  public.refresh_deposit_matches`. Its body is the body from
  `20260904150000_deposit_match_business_day_lag.sql:116-407` plus step
  3b. The migration `20260905090000_deposit_match_toast_captured.sql`
  does not redefine this function.
- The migration keeps the same signature, `SECURITY DEFINER`, the
  `user_has_capability` check, and the grants
  (`…_business_day_lag.sql:409-410`).
- No backfill. The next refresh of the range applies the pass.

## Risks

- **False positive.** Adjacent leftover days can sum near leftover
  deposits by chance. Controls: only items and deposits that the 1:1
  pass left open; the lag window; the tolerance; the uniqueness test
  that falls back to `suggested`.
- **CPU.** The pass looks at leftover rows only. Item groups are O(n)
  for n open items. Deposit sets are O(d²) for d open deposits in the
  window. Each rule usually has few leftovers.
- **Error path.** An error in step 3b goes to the existing `EXCEPTION
  WHEN OTHERS` handler (`…_business_day_lag.sql:400`). The rule's items
  become `incomplete` / `rule_error`. The other rules still run.

## Tests (pgTAP)

New file `supabase/tests/deposit_match_group_pass_test.sql`. It uses
the setup pattern from `supabase/tests/deposit_match_lag_window_test.sql`.
Dates that drive a time-based status use offsets from `CURRENT_DATE`.

1. Prod shape 2→2, gross: both items `matched`; 3 links; allocation
   sums are correct; reason `group_gross_fit`; state `confirmed`.
2. Weekend 2→1, gross: both items `matched`; 2 links.
3. Net 2→2 with the implied fee inside the band: both items
   `matched_net`; reason `group_net_fee_fit`.
4. Ambiguous: 2 deposit sets fit the same group. The links are
   `suggested`; the items are `needs_review`.
5. No fit: the group sum is outside the tolerance. No group links.
6. The 1:1 pass wins: an item with a 1:1 match is not in a group.
7. A gap day: items 2 days apart do not form a group.
8. A manual link on 1 item excludes that item from groups.
9. Stale bank: the freshness gate blocks the group.
10. Idempotent: a second refresh gives the same links.
11. The existing deposit-match tests still pass.

## Verification in production

After deploy, refresh rule `b2dfa8b6-…` for Oct 29 – Nov 7. Expected
result: Oct 31 and Nov 1 become `matched`, with 3 links to the deposits
of Nov 2 and Nov 3. This is a read check (SELECT) after the user runs
the refresh from the app.
