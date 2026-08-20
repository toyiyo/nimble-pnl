# Design: journal entry dates in the restaurant day frame

Date: 2026-08-20
Branch: claude/friendly-kare-5ade92
Status: draft for Phase 2.5 review

## Problem

`bank_transactions.transaction_date` is `TIMESTAMPTZ`
(supabase/migrations/20251021195308_82a73d7e-12b8-49e6-b3ab-975a7b822f5c.sql:3-6).
`journal_entries.entry_date` is `DATE`
(supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:165).
Every write path casts the timestamp to a date in the UTC frame. A card swipe
at 21:00 America/Chicago is 02:00 UTC on the next day. The journal entry for
that swipe lands on the wrong local day. The income statement then shows the
expense one day late.

All production restaurants sit west of UTC. The `restaurants.timezone` column
holds an IANA name with default `'America/Chicago'`
(supabase/migrations/20251001022351_2147ffdb-edc4-4d22-8812-8120871aaf6f.sql:3).

## Production measurement (read-only, 2026-08-20)

Project `ncdujvdgqtaunuyigflp` was confirmed with `get_project_url` before the
first query. The time-of-day distribution of `transaction_date` splits the
data into three populations:

| Population | Rows | Meaning |
|---|---|---|
| Exactly `00:00:00` UTC | 3,991 | Date-only values. Statement imports write `transaction.date`, a plain date string (supabase/functions/process-bank-statement/index.ts:911). |
| Exactly `12:00:00` UTC | 2,552 | Stripe noon-anchored date-only values. The sync writes `transacted_at` epoch seconds (supabase/functions/stripe-sync-transactions/index.ts:278). |
| Other times | 1,775 | Real instants from Stripe `transacted_at`. |

Impact counts, with the restaurant timezone applied to real instants only:

| Measure | Count |
|---|---|
| Bank transactions whose UTC day differs from the local day | 208 (all `America/Chicago`) |
| `journal_entries` rows with `reference_type = 'bank_transaction'` | 4,908 |
| Of those, rows not on the UTC day today | 0 |
| Bank entries that need a re-date | 179 |
| Reclassification entries that need a re-date | 2 |
| Re-dates that land inside a closed fiscal period | 0 |
| Source transactions where the day shift crosses a month boundary | 3 |

The zero in row three confirms the current convention is uniformly UTC.

## Decision: a hybrid day convention

A blanket restaurant-local cast is wrong for this data. A date-only value
stored at midnight UTC already names the intended calendar day. `2025-01-15
00:00:00Z` cast with `America/Chicago` becomes `2025-01-14` — one day early
for 3,991 rows. The convention must branch on the shape of the stored value:

- Time-of-day is exactly `00:00:00` or `12:00:00` UTC → the value is a date
  anchor. The entry day is the UTC calendar day.
- Any other time-of-day → the value is a real instant. The entry day is the
  restaurant-local calendar day.

For every US timezone the two branches agree on noon-anchored rows, so the
`12:00:00` case only matters as protection for east-of-UTC zones, where a
local cast of noon UTC would shift the day forward.

A real instant that lands on exactly `00:00:00` or `12:00:00` UTC is
misclassified as an anchor. The window is one second twice a day, and the
result equals today's behavior. Accepted trade-off.

### One expression, one place

A prior period guard diverged from its insert because the two casts were
written twice (lesson [2026-08-20], PR #766). To prevent that class, the
convention lives in one SQL function:

```sql
CREATE OR REPLACE FUNCTION public.bank_txn_entry_day(p_ts timestamptz, p_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_ts IS NULL THEN
    RETURN NULL;
  END IF;
  IF (p_ts AT TIME ZONE 'UTC')::time IN ('00:00:00', '12:00:00') THEN
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END IF;
  BEGIN
    RETURN (p_ts AT TIME ZONE COALESCE(p_tz, 'America/Chicago'))::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END;
END;
$$;
```

The `BEGIN … EXCEPTION` guard follows the lesson from `check_timeoff_conflict`
([2026-07-23]): do not probe `pg_timezone_names` per call; a plain cast is
~100× cheaper and only an invalid zone pays for the subtransaction. The
fallback for a garbage timezone is the UTC day — today's behavior. The
`COALESCE` default matches the column default `'America/Chicago'`.

Every caller passes `restaurants.timezone` for the transaction's restaurant.

## Write paths to change (one release)

Four functions write `entry_date` from `transaction_date`. Each gets a
`CREATE OR REPLACE` migration that swaps the cast for
`bank_txn_entry_day(v_transaction.transaction_date, v_timezone)` and aligns
its period guard to the same expression.

1. **`categorize_bank_transaction`** — current definition in
   supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql.
   Two inserts pass the raw timestamptz: the reclassification insert (line
   172) and the bank insert (line 213). Both take the implicit session-TZ
   cast; Supabase sessions run UTC. The closed-period guard compares the raw
   timestamptz with the `DATE` bounds (lines 135-136) — a mixed-basis
   comparison. The existing-entry UPDATE branch (line 202) does not touch
   `entry_date`; it must now also set `entry_date` so a recategorize call
   heals an old row.
2. **`bulk_categorize_bank_transactions`** — current definition in
   supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql.
   Two inserts use the explicit UTC cast (lines 187, 238). The closed-period
   guard compares the raw timestamptz with the bounds (lines 169-171). The
   existing-entry UPDATE branch (line 226) must also set `entry_date`.
3. **`apply_rules_to_bank_transactions_internal`** — current definition in
   supabase/migrations/20260804090300_bounded_categorization_sweep.sql (the
   two later migrations only call it). One insert passes the raw timestamptz
   (line 478). The closed-period guard is mixed-basis (lines 395-396). The
   existing-entry UPDATE branch (line 464) must also set `entry_date`.
4. **`backfill_bank_transaction_journal_entries`** — current definition in
   supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql.
   One insert uses the explicit UTC cast (line 115). Its closed-period guard
   already matches its insert (lines 93-94); both move to the helper.

The trigger `auto_apply_bank_categorization_rules`
(supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:224)
sets only `category_id` on the transaction row and writes no journal entry.
No other current function writes `entry_date` from a bank transaction.
`post_asset_depreciation`
(supabase/migrations/20260122000000_create_assets_equipment.sql:449) takes a
`DATE` parameter directly and is out of scope.

### Guard basis rule

Every closed-period comparison inside these functions must use the exact
helper output, not the raw timestamptz and not a second hand-written cast
(lesson [2026-08-20]: "a guard and a write derive a day from the same
timestamptz, both must use one expression"). The guard change also fixes a
latent guard bug: today a 23:30Z row on the last day of a closed period
passes the raw-timestamptz guard in `categorize_bank_transaction`.

## One-time re-date migration

A second migration re-dates existing rows:

1. Bank entries: join `journal_entries` (`reference_type =
   'bank_transaction'`) to `bank_transactions` on `reference_id` and to
   `restaurants` for the timezone. Set `entry_date =
   bank_txn_entry_day(...)` where the values differ.
2. Reclassification entries: reclass rows carry a random `reference_id`
   (20260709120000_categorize_preserve_metadata_on_noop.sql:166), so the join
   goes through `transaction_reclassifications.reclass_journal_entry_id` and
   `bank_transaction_id` (same file, lines 191-197).
3. Skip a row when the new day falls inside a closed fiscal period, with the
   comparison on the helper output. Production count of such rows is 0
   today; the guard protects other environments and future reruns.
4. Do not call `rebuild_account_balances`. `compute_account_balance` sums
   lines with `entry_date <= p_as_of_date`, default `CURRENT_DATE`
   (supabase/migrations/20251019021231_942cf575-c06d-491f-9f5f-77c57b85d1a2.sql:25-54).
   West-of-UTC re-dates move a date backward one day, so no historical row
   crosses the `CURRENT_DATE` bound and every stored balance is unchanged.
   East-of-UTC zones have no affected rows (all 208 shifts are
   `America/Chicago`).

Expected production effect: 181 rows updated (179 + 2), 3 of them across a
month boundary. The statement touches at most a few thousand joined rows;
no `statement_timeout` risk.

## What does not change (non-goals)

- `bank_transactions.transaction_date` values. The source data stays as
  stored; only the derived `entry_date` convention changes.
- The ingest paths (stripe-sync-transactions, process-bank-statement).
- POS sales, `unified_sales`, and their categorization paths — no
  `entry_date` write from a `timestamptz` exists there.
- Asset depreciation entries (`DATE` parameter, no cast).
- UI date rendering for bank transactions. The Transactions page shows the
  source timestamp; that display is a separate product surface.
- `fiscal_periods.period_start/period_end` semantics (already local days).

## Tests

- New pgTAP suite for `bank_txn_entry_day`: midnight anchor, noon anchor,
  real evening instant (day shift), real midday instant (no shift), NULL
  timezone, invalid timezone string, DST boundary instants
  (`America/Chicago` spring-forward and fall-back days).
- New pgTAP suite for the re-date migration path: seed a UTC-dated entry
  from an evening instant, run the re-date statement shape, assert the new
  day; seed a date-anchored row, assert no change; seed a closed-period
  collision, assert the skip.
- Extend `supabase/tests/22_bulk_categorize_bank_transactions.sql` and
  `supabase/tests/23_backfill_bank_transaction_journal_entries.sql` with one
  evening-instant fixture each, asserting the local-day `entry_date`.
- Extend the categorize suite with an evening-instant fixture and with a
  recategorize-heals-entry_date assertion.
- Per lesson [2026-08-19], any test that asserts restaurant-timezone
  behavior must not read the host clock; all fixtures use explicit UTC
  instants and fixed expected dates.

## E2E position

The change is a SQL-only re-derivation of one column; no route, dialog, or
request path changes. The seam is covered by pgTAP at the function boundary.
Planned position: justified exception under the Phase 8 gate, with the
categorization E2E flow already exercising the RPCs end to end. Phase 8
re-evaluates this claim against the final diff.

## Decided trade-offs

- A 1-second misclassification window at exactly `00:00:00`/`12:00:00` UTC
  for real instants: result equals current behavior; accepted.
- Noon-anchor recognition also treats a genuine noon-UTC instant as an
  anchor. For west-of-UTC zones both branches give the same day; accepted.
- The helper is `STABLE`, not `IMMUTABLE`: the tz database can change
  between calls. No index uses the function, so this costs nothing.
- Rules created by `apply_rules_to_bank_transactions_internal` run under
  cron without `auth.uid()`; the function change keeps its permission
  posture untouched.
