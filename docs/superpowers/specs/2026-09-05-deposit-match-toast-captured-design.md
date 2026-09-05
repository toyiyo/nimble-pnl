# Deposit Match: filter the Toast adapter to CAPTURED payments

Date: 2026-09-05
Branch: `fix/deposit-match-toast-captured` (worktree
`.claude/worktrees/deposit-match-toast-captured`, off origin/main 9af6b452)
Status: draft, STE-aligned

## Problem

The Toast adapter sums every `toast_payments` row for the configured
payment type. It does not check `payment_status`. See the WHERE clause in
`supabase/migrations/20260901150000_deposit_match_adapters.sql:112-119`:

```sql
FROM public.toast_payments tp
WHERE tp.restaurant_id = p_restaurant_id
  AND tp.payment_date BETWEEN p_start AND p_end
  AND tp.payment_type = v_payment_type
```

DENIED payments never settle. The adapter adds them to the expected
deposit. The expected deposit then overstates the true payout.

## Evidence

Restaurant "Wetzel's - Cold Stone - Alamo Ranch"
(`7c0c76e3-e770-401b-a2a9-c1edd407efed`). We compared the Toast payout
report to `toast_payments` for June 24 through August 30, 2026. Eight
days did not match. On each day, the gap equals the sum of that day's
DENIED rows to the penny:

| Date | Gap | DENIED rows |
|------|-----|-------------|
| 06-30 | +9.98 | 9.98 |
| 07-13 | +29.39 | 29.39 |
| 07-17 | +21.63 | 21.63 |
| 08-09 | +11.88 | 11.88 |
| 08-11 | +17.82 | 5.94 × 3 |
| 08-14 | +38.60 | 6.79 + 31.81 |
| 08-21 | +10.27 | 10.27 |
| 08-22 | +19.43 | 19.43 |

Total overstatement: $159.00. When we removed the non-CAPTURED rows,
every day matched the Toast payout report exactly.

Production holds these `payment_status` values on CREDIT rows
(all restaurants, full history):

| payment_status | rows | amount |
|----------------|------|--------|
| CAPTURED | 24,120 | 1,501,719.59 |
| DENIED | 384 | 31,196.03 |
| AUTHORIZED | 90 | 4,705.10 |
| VOIDED | 63 | 4,064.57 |
| CANCELLED | 6 | 317.14 |
| ERROR | 4 | 187.46 |
| OPEN | 2 | 295.18 |
| PROCESSING_VOID | 1 | 44.28 |

Only CAPTURED rows settle to the bank.

## Decision

Add one condition to the adapter's WHERE clause:

```sql
AND tp.payment_status = 'CAPTURED'
```

Use an allow-list, not a deny-list. A deny-list such as
`NOT IN ('DENIED', 'VOIDED')` keeps CANCELLED, ERROR, OPEN,
PROCESSING_VOID, and AUTHORIZED rows. None of those settle. A future
unknown status would also pass a deny-list. The CAPTURED set is the set
that matched the payout report.

### AUTHORIZED rows

AUTHORIZED rows sit on the current business day only. Toast captures
them at the batch close. The sync then updates `payment_status` to
CAPTURED. The refresh engine recomputes the expected amounts after each
sync. The value corrects itself before the deposit arrives, because the
lag band is at least one business day.

### NULL payment_status

The filter `payment_status = 'CAPTURED'` excludes NULL rows. The column
is TEXT, nullable, no default
(`supabase/migrations/20251116100100_toast_integration.sql:80`). The
sync has a null fallback: `toastOrderProcessor.ts:198` writes
`payment.paymentStatus || payment.status || null`. A production query on
2026-09-05 found no NULL CREDIT rows (24,670 rows, all eight statuses
above). A NULL row has no settlement proof, so exclusion is the safe
default.

## Change

One new migration: `supabase/migrations/20260905090000_deposit_match_toast_captured.sql`
(pick a unique 14-digit prefix; check against merged main before push).

- Copy `public.deposit_match_source_toast` whole from
  `supabase/migrations/20260901150000_deposit_match_adapters.sql:89-123`.
  That migration is the only definition of the function. Do not edit the
  old file.
- Add `AND tp.payment_status = 'CAPTURED'` to the WHERE clause.
- Keep `SECURITY DEFINER`, `SET search_path = public, pg_temp`, STABLE,
  and the config guards unchanged.
- Repeat the REVOKE by name:
  `REVOKE ALL ON FUNCTION public.deposit_match_source_toast(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;`
  The public schema's default ACL grants EXECUTE to anon and
  authenticated, and CREATE OR REPLACE does not change an existing ACL —
  the repeat is defense for a fresh database where the ACL starts from
  the default.
- Add a provenance header that names the source migration.

## Tests

Extend `supabase/tests/deposit_match_adapters_test.sql`:

1. Add `payment_status` to the existing toast fixture rows
   (`supabase/tests/deposit_match_adapters_test.sql:23-27`): mark the
   CREDIT row and the CASH row CAPTURED. The current sum assertions
   (90.00, row_count 1) must not change.
2. Add fixture rows on the same date, in the same top-of-file fixture
   block: one DENIED CREDIT row, one VOIDED CREDIT row, one AUTHORIZED
   CREDIT row, and one CREDIT row with a NULL `payment_status`.
3. The existing assertions at
   `supabase/tests/deposit_match_adapters_test.sql:101-116` then prove
   the exclusion: the expected amount stays 90.00 and the row count
   stays 1. Do not add duplicate assertions. `plan(N)` stays 23.

The dispatcher test and the other adapter tests do not change.
`supabase/tests/deposit_match_lag_window_test.sql` needs no fixture
change — that test inserts no `toast_payments` rows, so the CAPTURED
filter cannot change its result. Its toast rule item
(`expected_amount = 200.00` at line 142) is a hardcoded fixture value,
and the refresh engine leaves it untouched when the dispatcher returns
zero rows.

## Scope limits

- Only the Toast adapter changes. The focus, square, revel, shift4, and
  clover adapters stay as they are.
- The Focus decline gap (declines never reach `focus_payments`) is a
  separate, unapproved work item. Do not build it here.
- No frontend change. The report RPC and the UI read the recomputed
  items without a code change.

## Effect after deploy

The next refresh recomputes the expected amounts. For the validated
restaurant, the eight overstated Toast days flip to matched. The
fee-band days (07-08, 07-30, 08-12) and the 08-29/08-30 pair are
separate report items and stay as they are.

## Risks

- Old databases could hold Toast rows with a NULL or unexpected status
  from an early sync version. The allow-list excludes them. That is the
  correct direction: an excluded settling row understates the expected
  amount and shows as `over`, which a user can review. An included
  non-settling row overstates it silently.
- The migration replaces a SECURITY DEFINER function. The copy-whole
  rule prevents a partial rewrite.
