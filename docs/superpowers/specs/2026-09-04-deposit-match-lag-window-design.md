# Design: Deposit Match lag window in business days

Date: 2026-09-04
Branch: `fix/deposit-match-lag-window`
Base: `main` at `a1016447`

## Problem

Production shows zero matched deposits for restaurant
`7c0c76e3-e770-401b-a2a9-c1edd407efed` ("Wetzel's - Cold Stone - Alamo
Ranch"). The ledger shows five `Late` days and $0.00 deposited against a
$10,436.33 POS card total. Two defects cause this.

### Defect 1: the window upper bound cuts off intraday deposits

The candidate join compares a TIMESTAMPTZ to a DATE
(`supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:150-151`):

```sql
AND bt.transaction_date BETWEEN (i.business_date + v_rule.lag_days_min)
  AND (i.business_date + v_rule.lag_days_max)
```

Postgres casts the DATE upper bound to midnight at the START of the last
lag day. A deposit with an intraday timestamp on that day falls outside
the window. Shift4 posts deposits near 12:30 UTC. Every deposit that
lands on the last lag day is excluded.

Proof from production, for the Aug 29 item ($2,744.45 expected):

- Engine predicates with the current bound: **0 candidates**.
- Same predicates with an end-of-day bound: **1 exact hit, $2,744.45**.

The pgTAP seeds use bare date strings for `transaction_date`
(`supabase/tests/deposit_match_refresh_engine_test.sql`), which cast to
midnight. This is why the tests did not catch the defect.

### Defect 2: the lag counts calendar days, but processors settle in business days

The rule for this restaurant has `lag_days_min = 1`, `lag_days_max = 2`.
Shift4 settles T+2 in business days and rolls weekends to Monday.
Observed production offsets in calendar days: Thu→Mon = +4, Fri→Mon = +3,
Sat→Mon = +2, Sun→Tue = +2. A calendar lag of 1–2 can never catch the
Thursday and Friday batches.

All eight observed production deposits fit a **business-day** lag of 1–2:

| Business date | Deposit date | Business days |
|---|---|---|
| Tue Aug 25 | Thu Aug 27 | 2 |
| Wed Aug 26 | Fri Aug 28 | 2 |
| Thu Aug 27 | Mon Aug 31 | 2 |
| Fri Aug 28 | Mon Aug 31 | 1 |
| Sat Aug 29 | Mon Aug 31 | 1 |
| Sun Aug 30 | Tue Sep 1 | 2 |
| Mon Aug 31 | Wed Sep 2 | 2 |
| Tue Sep 1 | Thu Sep 3 | 2 |

## Decision

Change the engine to count the lag in business days (Monday to Friday).
Do not add per-user configuration. The user asked for automation, not
more settings. The stored defaults (`lag_days_min = 1`,
`lag_days_max = 2` for every source,
`src/lib/depositMatchUi.ts:202-274`) stay numerically the same — only
the unit changes. No data migration is necessary. The next refresh
recomputes all matches.

## SQL changes

One new migration: `supabase/migrations/20260904150000_deposit_match_business_day_lag.sql`.

### New helper function

```sql
CREATE OR REPLACE FUNCTION public.deposit_match_business_days_after(
  p_date date, p_days integer
) RETURNS date
LANGUAGE sql IMMUTABLE STRICT
AS $$ ... $$;
```

Behavior:

- `p_days <= 0` returns `p_date` unchanged.
- Otherwise, return the `p_days`-th weekday strictly after `p_date`.
  Use `generate_series` with a filter
  `extract(isodow FROM day) < 6`.
- Examples: `('2026-08-28' /* Fri */, 1) = '2026-08-31'` (Mon),
  `('2026-08-27' /* Thu */, 2) = '2026-08-31'` (Mon),
  `('2026-08-29' /* Sat */, 1) = '2026-08-31'` (Mon).

Mark it `IMMUTABLE` so the planner can inline it. Grant `EXECUTE` to
`authenticated` and revoke from `PUBLIC` and `anon`, the same pattern the
engine migration uses at
`20260901160000_deposit_match_refresh_engine.sql:306-307`.

### Bound the lag columns

The lag columns carry no CHECK constraint
(`supabase/migrations/20260901140000_deposit_match_tables.sql:25-26`).
The helper builds a `generate_series` over the lag span. An unbounded
value would make the series huge on every candidate row. Add these
constraints in the new migration:

```sql
ALTER TABLE public.deposit_match_rules
  ADD CONSTRAINT deposit_match_rules_lag_min_range
    CHECK (lag_days_min BETWEEN 0 AND 30),
  ADD CONSTRAINT deposit_match_rules_lag_max_range
    CHECK (lag_days_max BETWEEN 0 AND 30),
  ADD CONSTRAINT deposit_match_rules_lag_order
    CHECK (lag_days_max >= lag_days_min);
```

Every production rule holds lag 1–2, so the constraints add cleanly.
The helper runs once per candidate row with a series of at most ~45
rows, which is cheap.

### Replace `refresh_deposit_matches` only

`CREATE OR REPLACE` with the full header restated: `SECURITY DEFINER`,
`SET search_path = public, pg_temp`, and the `REVOKE`/`GRANT` pair.
**Warning:** do not touch `get_deposit_match_report`. Its current
definition lives in
`supabase/migrations/20260903140000_deposit_match_report_bank_suggestions.sql`,
not in the engine migration. A replace from the older text would delete
the bank-suggestion payload.

The engine has four lag-sensitive sites. Change all four.

**Site 1 — candidate join window**
(`20260901160000_deposit_match_refresh_engine.sql:150-151`). Replace the
`BETWEEN` with half-open TIMESTAMPTZ bounds, pinned to UTC the same way
the file already pins the freshness gate (comment at lines 169-175):

```sql
AND bt.transaction_date >=
  (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_min))::timestamp
    AT TIME ZONE 'UTC'
AND bt.transaction_date <
  (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_max)
    + 1)::timestamp AT TIME ZONE 'UTC'
```

The `+ 1` day and the `<` comparison fix defect 1: the window now covers
the full last lag day, including intraday timestamps.

**Site 2 — candidate freshness gate**
(`20260901160000_deposit_match_refresh_engine.sql:175`). Keep the same
shape, converted to business days:

```sql
AND v_bank.data_current_through >=
  (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_max))::timestamp
    AT TIME ZONE 'UTC'
```

Do not require full-window bank data here. A deposit that syncs early can
match early. The refresh clears and rebuilds auto links each run, so an
early match self-corrects on the next run.

**Site 3 — second-candidate ambiguity count**
(`20260901160000_deposit_match_refresh_engine.sql:215-216`). Apply the
same half-open business-day bounds as site 1. The two windows must stay
identical, or the ambiguity count diverges from the candidate set.

**Site 4 — expected-by date and the status ladder**
(`20260901160000_deposit_match_refresh_engine.sql:262-266,285`).

```sql
v_expected_by := public.deposit_match_business_days_after(
  v_item.business_date, v_rule.lag_days_max);
```

Reorder the unmatched branch of the status ladder. The current order
declares `incomplete/bank_stale` before it checks the window, and the old
stale cutoff (`data_current_through < v_expected_by::timestamp AT TIME
ZONE 'UTC'`, lines 263-266) lets `late` fire from partial bank data. New
order for an item with no received amount and no suggested link:

1. Bank not connected, or `data_current_through IS NULL` →
   `incomplete` / `bank_stale`. (A dead bank is a problem the user must
   see at any time.)
2. `CURRENT_DATE <= v_expected_by` → `pending` / `within_lag_window`.
   (Nothing is due yet; a healthy bank shows pending, not incomplete.)
3. `data_current_through < ((v_expected_by + 1)::timestamp AT TIME ZONE
   'UTC')` → `incomplete` / `bank_stale`. (The window closed, but the
   bank feed does not cover the full last day yet. Declare `late` only
   from complete data.)
4. Otherwise → `late` / `past_lag_max`.

The matched/short/over branch and the suggested-link branch
(`needs_review`) stay unchanged.

Production timing check: the daily bank sync lands near 01:02 UTC. A
deposit due on day D syncs on D+1 at 01:02, and `data_current_through`
then passes the `(v_expected_by + 1)` cutoff. `late` is at most one sync
cycle behind reality, and never a false positive.

Two known behavior notes, both accepted:

- A connected bank whose sync falls behind now shows `pending` inside
  the window, where the old order showed `incomplete`. Nothing is due
  inside the window, and the item flips to `incomplete` / `bank_stale`
  when the window closes without data.
- A deposit stamped with a non-UTC offset near local midnight can land
  in the next UTC day and leave the window. This edge exists in the
  current code too. The business-day window is wider, so the risk
  shrinks.

The self-correction argument for the site 2 gate is proved by the code:
step 2 deletes every auto link in the range on each run
(`20260901160000_deposit_match_refresh_engine.sql:114-121`), so an early
match is re-derived from full data on the next refresh.

### Column comments

Add `COMMENT ON COLUMN` for `deposit_match_rules.lag_days_min` and
`lag_days_max` stating the unit is business days. The columns
(`supabase/migrations/20260901140000_deposit_match_tables.sql:25-26`)
keep their type and constraints.

## Frontend changes

Logic does not change. `useDepositMatch.ts:132` and
`src/types/depositMatch.ts:215-216` keep their shapes.

1. `src/components/deposit-match/SetupDialog.tsx:520-522,532-534`:
   change the labels "Lag days, min" and "Lag days, max" to
   "Lag business days, min" and "Lag business days, max". Keep the
   input ids. Check that the longer uppercase labels do not wrap in the
   half-width grid column; shorten to "Lag, business days (min)" only
   if they wrap. Add `min={0}` and `max={30}` to both number inputs, so
   the form mirrors the new CHECK constraints.
2. Add one helper line under the Settlement section header: "The lag
   counts business days, Monday to Friday. Weekend sales settle on the
   next business days." Style it
   `text-[12px] text-muted-foreground`. Place it above the conditional
   amber `note` paragraph (`SetupDialog.tsx:515-517`), so the fixed
   context does not read as part of the warning.
3. `src/lib/depositMatchUi.ts`: change the comment blocks that describe
   the lag values, so they state the unit is business days. The correct
   sites are the top-of-object comment at lines 195-197 and the
   per-source inline comments near lines 226-233, 237, 247-253, and
   255-257. Do not change the `measured` JSDoc at line 176. The numeric
   defaults stay 1–2.

## Test plan

### pgTAP

New file `supabase/tests/deposit_match_lag_window_test.sql`. Pin every
business date to a named weekday. Known anchors: 2026-08-10 is a Monday,
2026-08-14 is a Friday. Cases:

1. Helper unit checks: `p_days = 0` returns the input; Fri + 1 = Mon;
   Thu + 2 = Mon; Sat + 1 = Mon; Sun + 2 = Tue; Mon + 2 = Wed.
2. **Intraday regression (defect 1):** a deposit with
   `transaction_date = <lag_max business day> 12:30:00+00` matches.
3. **Weekend rollover (defect 2):** business date Friday, deposit the
   next Monday (bare date), rule lag 1–2 → matched. Business date
   Thursday, deposit Monday → matched.
4. Out-of-window: a deposit 3 business days out with lag 1–2 does not
   match; with full-window bank data and `CURRENT_DATE` past
   `expected_by`, the item is `late` / `past_lag_max`.
5. Ladder order: window still open and bank healthy → `pending`;
   window closed and `data_current_through` short of the full last
   day → `incomplete` / `bank_stale`, not `late`.
6. Ambiguity-window parity: seed two candidate deposits for one item,
   the second with an intraday timestamp on the last lag business day.
   The engine must count the second candidate and write the link as
   `suggested`, not `confirmed`. This guards the site 1 and site 3
   windows against divergence.
7. New CHECK constraints: an insert with `lag_days_max = 45` fails; an
   insert with `lag_days_min > lag_days_max` fails.
8. `prosecdef` is true and the search path is `public, pg_temp` for
   `refresh_deposit_matches` after the replace.
9. `get_deposit_match_report` still returns `suggested_sources` in the
   banks payload (guards against a replace from stale function text).

Review the existing seeds in
`supabase/tests/deposit_match_refresh_engine_test.sql` under the new
semantics. Rule A uses business dates Mon 2026-08-10 and Tue 2026-08-11
with lag 0–2 and deposits on Aug 11 and Aug 12 — all inside the
business-day windows, so the greedy-order regression stands. Late-path
expectations later in that file must be re-checked against the new
ladder order and adjusted where the old order was asserted.

### E2E

`tests/e2e/deposit-match.spec.ts:51-52` seeds
`businessDate = today - 3` and asserts `Late`. Under business-day lag,
`expected_by = today - 3 + 2 business days` lands on or after today when
the test runs on a Sunday, Monday, or Tuesday, and the item shows
`pending`. Change the seed to `today - 7`: the worst case
(`+2` business days = `+4` calendar days) puts `expected_by` at
`today - 3`, so `Late` holds on every day of the week. Update the
comment at lines 40-50. The rest of the flow, including the bank-picker
suggestion steps, stays as is.

### Unit tests

Update `tests/unit/depositMatchUi.test.ts` only if a comment or exported
copy string changes. The defaults keep their values.

## Rollout

- No data migration. Rules keep `lag 1–2`. The next
  `refresh_deposit_matches` run recomputes every item in its range.
- The five `Late` items for the affected restaurant re-match on the
  next page load, because the page triggers the refresh RPC.
- Existing `accepted`/`disputed` resolutions persist; the refresh does
  not clear resolutions.
