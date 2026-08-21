# Journal Entry Date Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Journal entries for bank transactions carry the restaurant-local
calendar day, not the UTC day, for real timestamps; date-anchored values keep
the UTC day.

**Architecture:** One SQL helper `bank_txn_entry_day(timestamptz, text)`
holds the hybrid convention. Four SQL functions and one client hook call it.
A one-time migration re-dates existing rows. The design doc is
`docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md` —
read it first; it holds the decision rationale and the production
measurements.

**Tech Stack:** PostgreSQL (plpgsql, pgTAP), Supabase migrations, React
Query hook, Vitest.

## Global Constraints

- Write all prose (comments, commit messages) in ASD-STE100 style. See
  `docs/STE100_STYLE.md`.
- Migration file names start at `20260820210000_` and go up. They must sort
  after `20260819232450_`.
- The convention lives in `bank_txn_entry_day` only. Never write a second
  `AT TIME ZONE` cast for an entry day. Every closed-period guard uses the
  same helper output as its insert (lesson [2026-08-20], PR #766).
- Tests must not read the host clock for timezone assertions. Use fixed UTC
  instants and fixed expected dates (lesson [2026-08-19]).
- pgTAP suites use `BEGIN; SELECT plan(N); ... SELECT * FROM finish();
  ROLLBACK;`.
- Local database: run `npm run db:start` once, then `npm run db:reset` after
  each new migration. Run pgTAP with `npm run test:db`.
- Stage explicit paths only. Never `git add -A`. Never stage `progress.md`
  or `.env.local`.
- End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: The `bank_txn_entry_day` helper

**Files:**
- Create: `supabase/migrations/20260820210000_bank_txn_entry_day.sql`
- Test: `supabase/tests/65_bank_txn_entry_day.sql`

**Interfaces:**
- Produces: `public.bank_txn_entry_day(p_ts timestamptz, p_tz text) RETURNS
  date`. STABLE. `EXECUTE` granted to `authenticated`. Every later task
  calls it with exactly these argument types.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/65_bank_txn_entry_day.sql`:

```sql
-- File: supabase/tests/65_bank_txn_entry_day.sql
-- Description: pins the hybrid entry-day convention in bank_txn_entry_day.
-- A value at exactly 00:00:00 or 12:00:00 UTC is a date anchor and keeps
-- the UTC day. A real instant takes the restaurant-local day. See
-- docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

BEGIN;
SELECT plan(12);

-- The helper must not depend on the session TimeZone. Pin an east-of-UTC
-- zone so a hidden session cast fails these tests loudly.
SET LOCAL timezone TO 'Asia/Tokyo';

SELECT is(
  bank_txn_entry_day('2026-01-15 00:00:00+00'::timestamptz, 'America/Chicago'),
  '2026-01-15'::date,
  'midnight UTC anchor keeps the UTC day');

SELECT is(
  bank_txn_entry_day('2026-01-15 12:00:00+00'::timestamptz, 'America/Chicago'),
  '2026-01-15'::date,
  'noon UTC anchor keeps the UTC day');

SELECT is(
  bank_txn_entry_day('2026-01-16 02:30:00+00'::timestamptz, 'America/Chicago'),
  '2026-01-15'::date,
  'evening instant takes the restaurant-local day');

SELECT is(
  bank_txn_entry_day('2026-01-15 18:45:00+00'::timestamptz, 'America/Chicago'),
  '2026-01-15'::date,
  'midday instant keeps the same day');

SELECT is(
  bank_txn_entry_day(NULL::timestamptz, 'America/Chicago'),
  NULL::date,
  'NULL timestamp returns NULL');

SELECT is(
  bank_txn_entry_day('2026-01-16 02:30:00+00'::timestamptz, NULL),
  '2026-01-15'::date,
  'NULL timezone uses the America/Chicago column default');

SELECT is(
  bank_txn_entry_day('2026-01-16 02:30:00+00'::timestamptz, 'Not/AZone'),
  '2026-01-16'::date,
  'invalid timezone falls back to the UTC day');

SELECT is(
  bank_txn_entry_day('2026-01-15 20:30:00+00'::timestamptz, 'Asia/Tokyo'),
  '2026-01-16'::date,
  'east-of-UTC instant takes the next local day');

-- DST fall-back: 2026-11-01 ends CDT. 05:30Z on 2026-11-02 is 23:30 CST
-- on 2026-11-01.
SELECT is(
  bank_txn_entry_day('2026-11-02 05:30:00+00'::timestamptz, 'America/Chicago'),
  '2026-11-01'::date,
  'fall-back day uses the CST offset');

-- DST spring-forward: 2026-03-08 starts CDT. 04:30Z on 2026-03-09 is
-- 23:30 CDT on 2026-03-08.
SELECT is(
  bank_txn_entry_day('2026-03-09 04:30:00+00'::timestamptz, 'America/Chicago'),
  '2026-03-08'::date,
  'day after spring-forward uses the CDT offset');

SELECT ok(
  has_function_privilege('authenticated', 'bank_txn_entry_day(timestamptz, text)', 'EXECUTE'),
  'authenticated can EXECUTE bank_txn_entry_day');

-- Same instant, second session zone: the answer must not move.
SET LOCAL timezone TO 'UTC';
SELECT is(
  bank_txn_entry_day('2026-01-16 02:30:00+00'::timestamptz, 'America/Chicago'),
  '2026-01-15'::date,
  'result does not depend on the session TimeZone');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: suite 65 FAILS with `function bank_txn_entry_day(timestamp with
time zone, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260820210000_bank_txn_entry_day.sql`:

```sql
-- One expression for the journal entry day of a bank transaction.
--
-- bank_transactions.transaction_date is timestamptz. journal_entries.entry_date
-- is date. Production holds three value populations (measured 2026-08-20):
-- 3,991 rows at exactly 00:00:00 UTC (date-only statement imports), 2,552 at
-- exactly 12:00:00 UTC (Stripe noon-anchored dates), and ~1,775 real instants.
-- A date-anchored value already names its calendar day; a local cast would
-- move it one day early. A real instant belongs to the restaurant-local day.
-- This function holds that branch. Every entry insert AND every closed-period
-- guard must call it — never write the cast twice (PR #766 lesson).
-- See docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

CREATE OR REPLACE FUNCTION public.bank_txn_entry_day(p_ts timestamptz, p_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_ts IS NULL THEN
    RETURN NULL;
  END IF;

  -- A time of exactly 00:00:00 or 12:00:00 UTC marks a date-only source
  -- value. Keep its UTC day. Misclassification window for a real instant:
  -- one second twice a day, and the result equals the old behavior.
  IF (p_ts AT TIME ZONE 'UTC')::time IN ('00:00:00', '12:00:00') THEN
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END IF;

  BEGIN
    RETURN (p_ts AT TIME ZONE COALESCE(p_tz, 'America/Chicago'))::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    -- Garbage timezone string: keep the UTC day (the old behavior). Do not
    -- probe pg_timezone_names per call — the subtransaction guard is ~100x
    -- cheaper and only a bad zone pays for it (check_timeoff_conflict lesson).
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END;
END;
$$;

COMMENT ON FUNCTION public.bank_txn_entry_day(timestamptz, text) IS
  'Entry day for a bank transaction. Date anchors (00:00/12:00 UTC) keep the UTC day; real instants take the restaurant-local day.';

-- The opening-balance hook calls this through PostgREST.
GRANT EXECUTE ON FUNCTION public.bank_txn_entry_day(timestamptz, text) TO authenticated;
```

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: suite 65 passes 12/12. No other suite changes state.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210000_bank_txn_entry_day.sql supabase/tests/65_bank_txn_entry_day.sql
git commit -m "feat(ledger): add bank_txn_entry_day helper for local entry days"
```

---

### Task 2: `categorize_bank_transaction` uses the helper

**Files:**
- Create: `supabase/migrations/20260820210100_categorize_local_entry_day.sql`
- Test: `supabase/tests/66_categorize_local_entry_day.sql`
- Reference (copy source): `supabase/migrations/20260709120000_categorize_preserve_metadata_on_noop.sql`

**Interfaces:**
- Consumes: `bank_txn_entry_day(timestamptz, text)` from Task 1.
- Produces: same RPC signature as today. New behavior only: `entry_date`
  from the helper; the fiscal guard compares the helper output; the
  existing-entry UPDATE branch also sets `entry_date`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/66_categorize_local_entry_day.sql`:

```sql
-- File: supabase/tests/66_categorize_local_entry_day.sql
-- Description: categorize_bank_transaction derives entry_date with
-- bank_txn_entry_day. Covers: evening-instant bank entry, reclass entry,
-- the heal of an existing entry, and the closed-period guard on the
-- helper basis. See
-- docs/superpowers/specs/2026-08-20-journal-entry-date-timezone-design.md.

BEGIN;
SELECT plan(5);

SET LOCAL role TO postgres;
SET LOCAL timezone TO 'Asia/Tokyo';  -- session TZ must not leak into dates

-- Fixtures -----------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000006601'::uuid, 'entry-day-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000006610'::uuid, 'Entry Day Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000006601'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000006611'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000006612'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000006613'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, '6010', 'Repairs Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000006615'::uuid, '00000000-0000-0000-0000-000000006610'::uuid, 'fa_test_entry_day_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed period for the guard test below.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000006640'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   DATE '2026-01-01', DATE '2026-01-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES
  -- Evening instant: 03:30Z on Feb 2 = 21:30 CST on Feb 1.
  ('00000000-0000-0000-0000-000000006701'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-evening-1',
   TIMESTAMPTZ '2026-02-02 03:30:00+00', -50.00, 'Evening purchase', 'posted', false, false, false),
  -- Heal case: entry-less flag off; a wrong-day entry exists (seeded below).
  ('00000000-0000-0000-0000-000000006702'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-heal-1',
   TIMESTAMPTZ '2026-02-05 03:30:00+00', -60.00, 'Heal me', 'posted', false, false, false),
  -- Closed-period boundary: 23:30Z on Jan 31 = 17:30 CST on Jan 31, inside
  -- the closed period. The old raw-timestamptz guard let this row through.
  ('00000000-0000-0000-0000-000000006703'::uuid, '00000000-0000-0000-0000-000000006610'::uuid,
   '00000000-0000-0000-0000-000000006615'::uuid, 'txn-entry-day-closed-1',
   TIMESTAMPTZ '2026-01-31 23:30:00+00', -70.00, 'Late on closed last day', 'posted', false, false, false)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL;

-- Wrong-day entry for the heal case (UTC day 2026-02-05; local day is 02-04).
INSERT INTO journal_entries (
  restaurant_id, entry_date, entry_number, description,
  reference_type, reference_id, total_debit, total_credit
) VALUES (
  '00000000-0000-0000-0000-000000006610'::uuid, DATE '2026-02-05',
  'BANK-txn-entry-day-heal-1-SEED', 'Heal me',
  'bank_transaction', '00000000-0000-0000-0000-000000006702'::uuid,
  60.00, 60.00
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006601","role":"authenticated"}', true);

-- Tests --------------------------------------------------------------------

-- 1. Categorize the evening instant: entry lands on the local day.
SELECT lives_ok(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006701'::uuid,
      '00000000-0000-0000-0000-000000006612'::uuid)$$,
  'categorize succeeds for the evening instant');

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000006701'::uuid),
  DATE '2026-02-01',
  'bank entry lands on the restaurant-local day');

-- 2. Reclassify the same transaction: the reclass entry uses the same day.
SELECT lives_ok(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006701'::uuid,
      '00000000-0000-0000-0000-000000006613'::uuid)$$,
  'reclassification succeeds');

SELECT is(
  (SELECT je.entry_date
   FROM journal_entries je
   JOIN transaction_reclassifications tr ON tr.reclass_journal_entry_id = je.id
   WHERE tr.bank_transaction_id = '00000000-0000-0000-0000-000000006701'::uuid
   ORDER BY je.created_at DESC LIMIT 1),
  DATE '2026-02-01',
  'reclass entry lands on the restaurant-local day');

-- 3. Heal: categorize with an existing wrong-day entry updates entry_date.
SELECT categorize_bank_transaction(
  '00000000-0000-0000-0000-000000006702'::uuid,
  '00000000-0000-0000-0000-000000006612'::uuid);

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000006702'::uuid),
  DATE '2026-02-04',
  'existing entry heals to the restaurant-local day');

SELECT * FROM finish();
ROLLBACK;
```

Then append the closed-period guard test before `finish()` and bump the
plan to 6 (write it now, in the same file):

```sql
-- 4. Closed-period guard fires on the helper day, not the raw timestamptz.
SELECT throws_like(
  $$SELECT categorize_bank_transaction(
      '00000000-0000-0000-0000-000000006703'::uuid,
      '00000000-0000-0000-0000-000000006612'::uuid)$$,
  'Cannot categorize transaction in closed fiscal period%',
  'guard blocks a late instant on the closed period''s last day');
```

Final file has `SELECT plan(6);`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: suite 66 FAILS. Test 2 returns `2026-02-02` (UTC day). Test 4
does not raise (the raw-timestamptz guard misses the boundary row). The
heal test returns `2026-02-05`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260820210100_categorize_local_entry_day.sql`.
Copy the whole `CREATE OR REPLACE FUNCTION public.categorize_bank_transaction`
statement from `20260709120000_categorize_preserve_metadata_on_noop.sql`
(lines 25-255). Keep every part byte-identical except these five changes:

Change 1 — add two variables to the end of the DECLARE block:

```sql
  v_timezone text;
  v_entry_day date;
```

Change 2 — compute the day once, directly above the fiscal-period guard
(the `SELECT id INTO v_fiscal_period_id FROM fiscal_periods ...` block):

```sql
  -- One expression for the entry day; the guard below and both inserts use
  -- it. Never derive the day a second way (PR #766 lesson).
  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = v_transaction.restaurant_id;

  v_entry_day := bank_txn_entry_day(v_transaction.transaction_date, v_timezone);
```

Change 3 — the guard compares the helper day. Replace:

```sql
    AND v_transaction.transaction_date >= period_start
    AND v_transaction.transaction_date <= period_end
```

with:

```sql
    AND v_entry_day >= period_start
    AND v_entry_day <= period_end
```

Change 4 — both inserts pass the day. In the RECLASS insert and in the
BANK insert, replace the VALUES item
`v_transaction.restaurant_id, v_transaction.transaction_date,` with:

```sql
      v_transaction.restaurant_id, v_entry_day,
```

Change 5 — the existing-entry UPDATE branch heals the day. The function
has one `UPDATE journal_entries SET ...` branch for a found existing
entry (near the "journal entry already exists" check). Add
`entry_date = v_entry_day,` as the first SET item of that UPDATE. Do not
change the other SET items.

Add a header comment that names the design doc and states: this migration
changes only the entry-day derivation and the guard basis.

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: suite 66 passes 6/6. Suite `categorize_noop_preserves_metadata`
and every other suite stay green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210100_categorize_local_entry_day.sql supabase/tests/66_categorize_local_entry_day.sql
git commit -m "fix(ledger): categorize_bank_transaction writes the local entry day"
```

---

### Task 3: `bulk_categorize_bank_transactions` uses the helper

**Files:**
- Create: `supabase/migrations/20260820210200_bulk_categorize_local_entry_day.sql`
- Modify: `supabase/tests/22_bulk_categorize_bank_transactions.sql`
- Reference (copy source): `supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql`

**Interfaces:**
- Consumes: `bank_txn_entry_day(timestamptz, text)` from Task 1.
- Produces: same RPC signature as today
  (`p_restaurant_id`, `p_category_id`, `p_transaction_ids`,
  `p_skip_rebuild`). New behavior only, as in Task 2.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/22_bulk_categorize_bank_transactions.sql`:

1. Change `SELECT plan(34);` to `SELECT plan(35);`.
2. Directly above `SELECT * FROM finish();`, add:

```sql
-- ---------------------------------------------------------------------------
-- Local entry day: an evening instant lands on the restaurant-local day.
-- 03:30Z on 2026-02-02 = 21:30 CST on 2026-02-01 (restaurant timezone
-- defaults to America/Chicago).
-- ---------------------------------------------------------------------------
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES (
  '00000000-0000-0000-0000-000000000760'::uuid,
  '00000000-0000-0000-0000-000000000610'::uuid,
  '00000000-0000-0000-0000-000000000615'::uuid,
  'txn-bulk-evening-instant-1',
  TIMESTAMPTZ '2026-02-02 03:30:00+00', -33.00, 'Evening instant', 'posted', false, false, false
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL;

SELECT bulk_categorize_bank_transactions(
  p_restaurant_id   => '00000000-0000-0000-0000-000000000610'::uuid,
  p_category_id     => '00000000-0000-0000-0000-000000000612'::uuid,
  p_transaction_ids => ARRAY['00000000-0000-0000-0000-000000000760'::uuid],
  p_skip_rebuild    => true
);

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000000760'::uuid),
  DATE '2026-02-01',
  'bulk categorize writes the restaurant-local entry day');
```

If the RPC's parameter names differ from the ones above, read the
signature in `20260819231210_add_bulk_categorize_bank_transactions.sql`
and match them exactly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: suite 22 FAILS on the new assertion with `2026-02-02` (UTC day).
The other 34 tests stay green.

- [ ] **Step 3: Write the migration**

Create
`supabase/migrations/20260820210200_bulk_categorize_local_entry_day.sql`.
Copy the whole `CREATE OR REPLACE FUNCTION
public.bulk_categorize_bank_transactions` statement from
`20260819231210_add_bulk_categorize_bank_transactions.sql`. Keep every part
byte-identical except these five changes:

Change 1 — add to the DECLARE block:

```sql
  v_timezone text;
  v_entry_day date;
```

Change 2 — one timezone lookup per call, directly above the `FOR` loop
over the transaction ids (`p_restaurant_id` scopes the whole call):

```sql
  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
```

Change 3 — inside the loop, directly above the fiscal-period guard
(the `SELECT id INTO v_fiscal_period_id FROM fiscal_periods ...` block):

```sql
      v_entry_day := bank_txn_entry_day(v_transaction.transaction_date, v_timezone);
```

Then the guard compares the helper day. Replace:

```sql
        AND v_transaction.transaction_date >= period_start
        AND v_transaction.transaction_date <= period_end
```

with:

```sql
        AND v_entry_day >= period_start
        AND v_entry_day <= period_end
```

Change 4 — both inserts pass the day. In the RECLASS insert and in the
BANK insert, replace the VALUES item
`(v_transaction.transaction_date AT TIME ZONE 'UTC')::date,` with:

```sql
          v_entry_day,
```

Change 5 — the existing-entry UPDATE branch heals the day. The function
has one `UPDATE journal_entries SET ...` branch for a found existing
entry. Add `entry_date = v_entry_day,` as the first SET item of that
UPDATE. Do not change the other SET items.

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: suite 22 passes 35/35.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210200_bulk_categorize_local_entry_day.sql supabase/tests/22_bulk_categorize_bank_transactions.sql
git commit -m "fix(ledger): bulk categorize writes the local entry day"
```

---

### Task 4: `apply_rules_to_bank_transactions_internal` uses the helper

**Files:**
- Create: `supabase/migrations/20260820210300_sweep_local_entry_day.sql`
- Modify: `supabase/tests/categorization_background_rules.test.sql`
- Reference (copy source): `supabase/migrations/20260804090300_bounded_categorization_sweep.sql`

**Interfaces:**
- Consumes: `bank_txn_entry_day(timestamptz, text)` from Task 1.
- Produces: same function signature as today
  (`apply_rules_to_bank_transactions_internal(uuid, integer, boolean)`).
  Grants unchanged (service_role only; the migration must re-state the
  existing REVOKE/GRANT statements if the copy source carries them).

- [ ] **Step 1: Write the failing test**

In `supabase/tests/categorization_background_rules.test.sql`:

1. Change `SELECT plan(27);` to `SELECT plan(28);`.
2. Directly above `SELECT * FROM finish();`, add (rule H matches
   description `VENDOR-H` in restaurant H; the restaurant's timezone is the
   `America/Chicago` default):

```sql
-- ============================================================
-- Test (o): the internal bank engine writes the restaurant-local entry day.
-- 03:30Z on 2026-02-02 = 21:30 CST on 2026-02-01.
-- ============================================================
ALTER TABLE public.bank_transactions DISABLE TRIGGER auto_categorize_bank_transaction;

INSERT INTO public.bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id,
   transaction_date, description, amount, is_categorized)
VALUES
  ('c1a00008-0000-0000-0000-000000000102',
   'c1a00008-0000-0000-0000-000000000801',
   'c1a00008-0000-0000-0000-0000000000b8',
   'cbt-stripe-txn-h02',
   TIMESTAMPTZ '2026-02-02 03:30:00+00',
   'Payment to VENDOR-H Corp evening run',
   -75.00,
   false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bank_transactions ENABLE TRIGGER auto_categorize_bank_transaction;

SET LOCAL "request.jwt.claims" TO '';

SELECT apply_rules_to_bank_transactions_internal(
  'c1a00008-0000-0000-0000-000000000801'::uuid, 100);

SELECT is(
  (SELECT entry_date FROM public.journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = 'c1a00008-0000-0000-0000-000000000102'),
  DATE '2026-02-01',
  '(o) internal bank engine writes the restaurant-local entry day');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: the suite FAILS on test (o) with `2026-02-02` (UTC day). The
other 27 tests stay green.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260820210300_sweep_local_entry_day.sql`.
Copy the whole `CREATE OR REPLACE FUNCTION
public.apply_rules_to_bank_transactions_internal` statement from
`20260804090300_bounded_categorization_sweep.sql` (the two later
migrations, `20260804090700` and `20260804091000`, only call it — do not
copy from them). Keep every part byte-identical except these five changes:

Change 1 — add to the DECLARE block:

```sql
  v_timezone text;
  v_entry_day date;
```

Change 2 — one timezone lookup per call, directly above the
`FOR v_transaction IN` loop:

```sql
  SELECT timezone INTO v_timezone
  FROM restaurants
  WHERE id = p_restaurant_id;
```

Change 3 — inside the loop's `BEGIN` block, directly above the
fiscal-period `SELECT id INTO v_fiscal_period_id`:

```sql
      v_entry_day := bank_txn_entry_day(v_transaction.transaction_date, v_timezone);
```

Then replace the guard comparisons:

```sql
        AND v_transaction.transaction_date >= period_start
        AND v_transaction.transaction_date <= period_end
```

with:

```sql
        AND v_entry_day >= period_start
        AND v_entry_day <= period_end
```

Change 4 — the insert passes the day. Replace the VALUES item
`v_transaction.transaction_date,` with:

```sql
          v_entry_day,
```

Change 5 — the existing-entry UPDATE branch heals the day. The function
has one `UPDATE journal_entries SET ...` branch for a found existing
entry. Add `entry_date = v_entry_day,` as the first SET item of that
UPDATE. Do not change the other SET items.

After the function body, re-state the privilege statements exactly as the
copy source has them (REVOKE from PUBLIC/authenticated/anon, GRANT to
service_role) so the replace does not widen access. Check the copy source
for them; `CREATE OR REPLACE` keeps existing ACLs, so add them only if the
copy source itself carries them.

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: `categorization_background_rules` passes 28/28.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210300_sweep_local_entry_day.sql supabase/tests/categorization_background_rules.test.sql
git commit -m "fix(ledger): rule sweep writes the local entry day"
```

---

### Task 5: `backfill_bank_transaction_journal_entries` uses the helper

**Files:**
- Create: `supabase/migrations/20260820210400_backfill_local_entry_day.sql`
- Modify: `supabase/tests/23_backfill_bank_transaction_journal_entries.sql`
- Reference (copy source): `supabase/migrations/20260819232450_backfill_bank_transaction_journal_entries.sql`

**Interfaces:**
- Consumes: `bank_txn_entry_day(timestamptz, text)` from Task 1.
- Produces: same function signature
  (`backfill_bank_transaction_journal_entries() RETURNS jsonb`).

- [ ] **Step 1: Write the failing test**

In `supabase/tests/23_backfill_bank_transaction_journal_entries.sql`:

1. Change `SELECT plan(19);` to `SELECT plan(20);`.
2. Add one row to the candidate `INSERT INTO bank_transactions` VALUES
   list (before the `ON CONFLICT` clause):

```sql
  -- Local entry day: evening instant. 03:30Z on 2026-02-02 = 21:30 CST on
  -- 2026-02-01 (R_BF_MAIN timezone defaults to America/Chicago).
  ('00000000-0000-0000-0000-000000000910'::uuid, '00000000-0000-0000-0000-000000000810'::uuid, '00000000-0000-0000-0000-000000000815'::uuid,
   'txn-backfill-evening-1', TIMESTAMPTZ '2026-02-02 03:30:00+00', -44.00, 'Evening instant, entry-less', 'posted', true, false, false,
   '00000000-0000-0000-0000-000000000812'::uuid, NULL),
```

3. Directly above `SELECT * FROM finish();`, add:

```sql
SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000000910'::uuid),
  DATE '2026-02-01',
  'backfill writes the restaurant-local entry day');
```

4. The suite counts created entries in its earlier assertions. Find every
   assertion that counts backfill results (for example an
   `entries_created` count from the first call) and raise the expected
   count by one for the new eligible row. Read each failing assertion's
   description; change only counts that include eligible rows.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: suite 23 FAILS on the new assertion with `2026-02-02`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260820210400_backfill_local_entry_day.sql`.
Copy the whole `CREATE OR REPLACE FUNCTION
public.backfill_bank_transaction_journal_entries` statement from
`20260819232450_backfill_bank_transaction_journal_entries.sql`. Keep every
part byte-identical except these four changes:

Change 1 — the candidate table carries the timezone. In the
`CREATE TEMP TABLE tmp_backfill_candidates ON COMMIT DROP AS SELECT` list,
after `bt.transaction_date,` add:

```sql
    r.timezone,
```

and after the `JOIN chart_of_accounts cat ...` join block add:

```sql
  JOIN restaurants r
    ON r.id = bt.restaurant_id
```

Change 2 — the closed-period guard uses the helper. Replace both cast
lines inside the `NOT EXISTS (SELECT 1 FROM fiscal_periods fp ...)`:

```sql
        AND (bt.transaction_date AT TIME ZONE 'UTC')::date >= fp.period_start
        AND (bt.transaction_date AT TIME ZONE 'UTC')::date <= fp.period_end
```

with:

```sql
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
```

Change 3 — the insert uses the helper. Replace:

```sql
      (c.transaction_date AT TIME ZONE 'UTC')::date,
```

with:

```sql
      bank_txn_entry_day(c.transaction_date, c.timezone),
```

Change 4 — rewrite the two stale comments that explain the UTC cast (the
one above the guard and the one above the insert). State the new rule in
one sentence each: the guard and the insert derive the day from
`bank_txn_entry_day`, the single convention expression.

- [ ] **Step 4: Apply and run the test to verify it passes**

Run: `npm run db:reset && npm run test:db`
Expected: suite 23 passes 20/20.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210400_backfill_local_entry_day.sql supabase/tests/23_backfill_bank_transaction_journal_entries.sql
git commit -m "fix(ledger): backfill writes the local entry day"
```

---

### Task 6: One-time re-date of existing entries

**Files:**
- Create: `supabase/migrations/20260820210500_redate_bank_journal_entries.sql`
- Test: `supabase/tests/67_redate_bank_journal_entries.sql`

**Interfaces:**
- Consumes: `bank_txn_entry_day(timestamptz, text)` from Task 1.
- Produces: a data-only migration. No schema or function changes.

- [ ] **Step 1: Write the test**

A data-only migration cannot follow the red-green cycle: the migration is
one statement, and the test must inline that statement to prove it. The
test seeds wrong-day entries, runs the same two UPDATE statements the
migration runs, and asserts the moves, the skips, and the report-level
effect. Keep the statements byte-identical between the test and the
migration.

Create `supabase/tests/67_redate_bank_journal_entries.sql`:

```sql
-- File: supabase/tests/67_redate_bank_journal_entries.sql
-- Description: proves the one-time re-date statement shape used by
-- migration 20260820210500_redate_bank_journal_entries.sql. Seeds a
-- wrong-day bank entry, a wrong-day reclass entry, a date-anchored entry,
-- and a closed-period collision; runs the same UPDATEs; asserts the moves
-- and the skips. Also proves the report-level effect: a mid-window as-of
-- balance changes after the re-date.

BEGIN;
SELECT plan(8);

SET LOCAL role TO postgres;
SET LOCAL timezone TO 'Asia/Tokyo';

-- Fixtures -----------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000006710'::uuid, 'Redate Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000006711'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000006712'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000006715'::uuid, '00000000-0000-0000-0000-000000006710'::uuid, 'fa_test_redate_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed period that must protect entry 6904 below.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000006740'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-03-01', DATE '2026-03-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES
  -- 6801: evening instant, entry on the wrong UTC day.
  ('00000000-0000-0000-0000-000000006801'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-evening-1',
   TIMESTAMPTZ '2026-02-02 03:30:00+00', -50.00, 'Evening instant', 'posted', true, false, false),
  -- 6802: date anchor, entry already right.
  ('00000000-0000-0000-0000-000000006802'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-anchor-1',
   TIMESTAMPTZ '2026-02-10 00:00:00+00', -20.00, 'Date anchor', 'posted', true, false, false),
  -- 6803: evening instant with a reclass entry.
  ('00000000-0000-0000-0000-000000006803'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-reclass-1',
   TIMESTAMPTZ '2026-02-16 02:15:00+00', -30.00, 'Reclassed instant', 'posted', true, false, false),
  -- 6804: the new day (2026-03-31) falls inside the closed period; the
  -- old day (2026-04-01, UTC) does not. The re-date must skip it.
  ('00000000-0000-0000-0000-000000006804'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   '00000000-0000-0000-0000-000000006715'::uuid, 'txn-redate-closed-1',
   TIMESTAMPTZ '2026-04-01 03:30:00+00', -40.00, 'Closed-period collision', 'posted', true, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO journal_entries (
  id, restaurant_id, entry_date, entry_number, description,
  reference_type, reference_id, total_debit, total_credit
) VALUES
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-02', 'BANK-txn-redate-evening-1-SEED', 'Evening instant',
   'bank_transaction', '00000000-0000-0000-0000-000000006801'::uuid, 50.00, 50.00),
  ('00000000-0000-0000-0000-000000006902'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-10', 'BANK-txn-redate-anchor-1-SEED', 'Date anchor',
   'bank_transaction', '00000000-0000-0000-0000-000000006802'::uuid, 20.00, 20.00),
  ('00000000-0000-0000-0000-000000006903'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-02-16', 'RECLASS-txn-redate-reclass-1-SEED', 'Reclassed instant',
   'reclassification', gen_random_uuid(), 30.00, 30.00),
  ('00000000-0000-0000-0000-000000006904'::uuid, '00000000-0000-0000-0000-000000006710'::uuid,
   DATE '2026-04-01', 'BANK-txn-redate-closed-1-SEED', 'Closed-period collision',
   'bank_transaction', '00000000-0000-0000-0000-000000006804'::uuid, 40.00, 40.00);

-- Lines for 6901 so the report-effect assertion has an amount to sum.
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006712'::uuid, 50.00, 0, 'Supplies'),
  ('00000000-0000-0000-0000-000000006901'::uuid, '00000000-0000-0000-0000-000000006711'::uuid, 0, 50.00, 'Cash payment');

INSERT INTO transaction_reclassifications (
  restaurant_id, bank_transaction_id, original_category_id,
  new_category_id, reclass_journal_entry_id, reason
) VALUES (
  '00000000-0000-0000-0000-000000006710'::uuid,
  '00000000-0000-0000-0000-000000006803'::uuid,
  '00000000-0000-0000-0000-000000006712'::uuid,
  '00000000-0000-0000-0000-000000006712'::uuid,
  '00000000-0000-0000-0000-000000006903'::uuid,
  'redate test');

-- Report-level effect, BEFORE: the mid-window as-of day (2026-02-01) sees
-- no expense yet, because the entry still sits on 2026-02-02.
SELECT is(
  compute_account_balance('00000000-0000-0000-0000-000000006712'::uuid, DATE '2026-02-01'),
  0.00::numeric,
  'before the re-date, the mid-window balance excludes the entry');

-- The migration statements ---------------------------------------------------
-- Keep these two UPDATEs byte-identical to
-- supabase/migrations/20260820210500_redate_bank_journal_entries.sql.

UPDATE journal_entries je
SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
    updated_at = now()
FROM bank_transactions bt
JOIN restaurants r ON r.id = bt.restaurant_id
WHERE je.reference_type = 'bank_transaction'
  AND je.reference_id = bt.id
  AND je.restaurant_id = bt.restaurant_id
  AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
  AND NOT EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.restaurant_id = je.restaurant_id
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
      AND fp.is_closed = true
  );

UPDATE journal_entries je
SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
    updated_at = now()
FROM transaction_reclassifications tr
JOIN bank_transactions bt ON bt.id = tr.bank_transaction_id
JOIN restaurants r ON r.id = bt.restaurant_id
WHERE je.id = tr.reclass_journal_entry_id
  AND je.reference_type = 'reclassification'
  AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
  AND NOT EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.restaurant_id = je.restaurant_id
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
      AND fp.is_closed = true
  );

-- Assertions -----------------------------------------------------------------
SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006901'::uuid),
  DATE '2026-02-01',
  'bank entry moves to the restaurant-local day');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006902'::uuid),
  DATE '2026-02-10',
  'date-anchored entry does not move');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006903'::uuid),
  DATE '2026-02-15',
  'reclass entry moves via transaction_reclassifications');

SELECT is(
  (SELECT entry_date FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000006904'::uuid),
  DATE '2026-04-01',
  'closed-period collision keeps its old day');

-- Report-level effect, AFTER: the same as-of day now includes the entry.
SELECT is(
  compute_account_balance('00000000-0000-0000-0000-000000006712'::uuid, DATE '2026-02-01'),
  50.00::numeric,
  'after the re-date, the mid-window balance includes the entry');

-- Idempotence: a second run changes no row.
CREATE TEMP TABLE redate_before AS
  SELECT id, entry_date FROM journal_entries
  WHERE restaurant_id = '00000000-0000-0000-0000-000000006710'::uuid;

UPDATE journal_entries je
SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
    updated_at = now()
FROM bank_transactions bt
JOIN restaurants r ON r.id = bt.restaurant_id
WHERE je.reference_type = 'bank_transaction'
  AND je.reference_id = bt.id
  AND je.restaurant_id = bt.restaurant_id
  AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
  AND NOT EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.restaurant_id = je.restaurant_id
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
      AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
      AND fp.is_closed = true
  );

SELECT is(
  (SELECT count(*)::int FROM journal_entries je
   JOIN redate_before b ON b.id = je.id
   WHERE je.entry_date IS DISTINCT FROM b.entry_date),
  0,
  'a second run is a no-op');

-- Compute_account_balance signature check (guards a signature drift that
-- would break the report assertions silently).
SELECT ok(
  has_function_privilege('postgres', 'compute_account_balance(uuid, date)', 'EXECUTE'),
  'compute_account_balance(uuid, date) exists');

SELECT * FROM finish();
ROLLBACK;
```

Check the fixture expectations: `2026-02-16 02:15:00+00` is 20:15 CST on
2026-02-15, so the reclass entry must land on `2026-02-15`.
`2026-04-01 03:30:00+00` is 22:30 CDT on 2026-03-31, inside the closed
March period, so the skip must hold.

- [ ] **Step 2: Run the test to verify the statements**

Run: `npm run test:db`
Expected: suite 67 passes — this task proves the migration statements,
not a code change. If an assertion fails, fix the statement in the test
first, then copy the fixed statement into the migration in Step 3.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260820210500_redate_bank_journal_entries.sql`
with a header comment (production expectation: 179 bank entries + 2
reclass entries move; 0 closed-period skips; counts drift with the cron —
the statements compute their own row set) and a DO block that runs the two
UPDATE statements from the test **byte-identical**, each followed by
`GET DIAGNOSTICS` and a `RAISE NOTICE` with the row count:

```sql
DO $$
DECLARE
  v_bank_rows int;
  v_reclass_rows int;
BEGIN
  UPDATE journal_entries je
  SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
      updated_at = now()
  FROM bank_transactions bt
  JOIN restaurants r ON r.id = bt.restaurant_id
  WHERE je.reference_type = 'bank_transaction'
    AND je.reference_id = bt.id
    AND je.restaurant_id = bt.restaurant_id
    AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.restaurant_id = je.restaurant_id
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
        AND fp.is_closed = true
    );
  GET DIAGNOSTICS v_bank_rows = ROW_COUNT;

  UPDATE journal_entries je
  SET entry_date = bank_txn_entry_day(bt.transaction_date, r.timezone),
      updated_at = now()
  FROM transaction_reclassifications tr
  JOIN bank_transactions bt ON bt.id = tr.bank_transaction_id
  JOIN restaurants r ON r.id = bt.restaurant_id
  WHERE je.id = tr.reclass_journal_entry_id
    AND je.reference_type = 'reclassification'
    AND je.entry_date IS DISTINCT FROM bank_txn_entry_day(bt.transaction_date, r.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_periods fp
      WHERE fp.restaurant_id = je.restaurant_id
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) >= fp.period_start
        AND bank_txn_entry_day(bt.transaction_date, r.timezone) <= fp.period_end
        AND fp.is_closed = true
    );
  GET DIAGNOSTICS v_reclass_rows = ROW_COUNT;

  RAISE NOTICE 'redate_bank_journal_entries: % bank entries, % reclass entries', v_bank_rows, v_reclass_rows;
END;
$$;
```

Do not call `rebuild_account_balances` — the design doc explains why
(backward moves cannot cross the `CURRENT_DATE` bound).

- [ ] **Step 4: Apply and run the full suite**

Run: `npm run db:reset && npm run test:db`
Expected: all suites pass; the reset log shows the two NOTICE counts
(0 and 0 on an empty local database).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820210500_redate_bank_journal_entries.sql supabase/tests/67_redate_bank_journal_entries.sql
git commit -m "fix(ledger): re-date existing bank journal entries to local days"
```

---

### Task 7: Opening-balance hook derives its day from the helper

**Files:**
- Modify: `src/hooks/useCalculateOpeningBalance.tsx:68-77`
- Modify: `src/integrations/supabase/types.ts` (Functions section,
  alphabetical position near `builtin_role_id_for`)
- Test: `tests/unit/useCalculateOpeningBalance.test.ts`

**Interfaces:**
- Consumes: the `bank_txn_entry_day` RPC (Task 1 granted `authenticated`).
- Produces: no interface change; `mutationFn` still takes `restaurantId:
  string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useCalculateOpeningBalance.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useCalculateOpeningBalance } from '@/hooks/useCalculateOpeningBalance';

// A chainable thenable: every method returns the chain; awaiting it
// resolves to the canned response.
function chain(response: unknown) {
  const proxy: any = new Proxy(() => proxy, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) =>
          Promise.resolve(response).then(resolve);
      }
      return () => proxy;
    },
  });
  return proxy;
}

const EARLIEST_TS = '2026-02-02T03:30:00+00:00';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children,
  );
}

describe('useCalculateOpeningBalance entry day', () => {
  let insertedEntry: Record<string, unknown> | null;
  let upsertedBoundary: Record<string, unknown> | null;
  let tableCalls: Record<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedEntry = null;
    upsertedBoundary = null;
    tableCalls = {};

    mocks.from.mockImplementation((table: string) => {
      tableCalls[table] = (tableCalls[table] ?? 0) + 1;
      const n = tableCalls[table];
      if (table === 'bank_account_balances') {
        return chain({
          data: [{ current_balance: 1000, as_of_date: '2026-08-01' }],
          error: null,
        });
      }
      if (table === 'bank_transactions' && n === 1) {
        return chain({
          data: [{ amount: 200, transaction_date: EARLIEST_TS }],
          error: null,
        });
      }
      if (table === 'bank_transactions') {
        return chain({ data: { transaction_date: EARLIEST_TS }, error: null });
      }
      if (table === 'chart_of_accounts' && n === 1) {
        return chain({ data: { id: 'cash-id', account_name: 'Cash' }, error: null });
      }
      if (table === 'chart_of_accounts') {
        return chain({ data: { id: 'equity-id', account_name: 'Equity' }, error: null });
      }
      if (table === 'restaurants') {
        return chain({ data: { timezone: 'America/New_York' }, error: null });
      }
      if (table === 'journal_entries' && n === 1) {
        return chain({ data: null, error: null });
      }
      if (table === 'journal_entries') {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedEntry = payload;
            return chain({ data: { id: 'je-id' }, error: null });
          },
        };
      }
      if (table === 'journal_entry_lines') {
        return { insert: () => chain({ error: null }) };
      }
      if (table === 'reconciliation_boundaries') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upsertedBoundary = payload;
            return chain({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === 'bank_txn_entry_day') {
        return Promise.resolve({ data: '2026-02-01', error: null });
      }
      if (fn === 'rebuild_account_balances') {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });
  });

  it('derives the opening date from the bank_txn_entry_day RPC', async () => {
    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await result.current.mutateAsync('rest-1');

    expect(mocks.rpc).toHaveBeenCalledWith('bank_txn_entry_day', {
      p_ts: EARLIEST_TS,
      p_tz: 'America/New_York',
    });
    expect(insertedEntry?.entry_date).toBe('2026-02-01');
    expect(upsertedBoundary?.balance_start_date).toBe('2026-02-01');
  });

  it('falls back to today when no transaction exists', async () => {
    // Pin only Date so the fallback assertion does not race the host
    // clock. Real timers stay live for React Query.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z'));

    mocks.from.mockImplementation((table: string) => {
      tableCalls[table] = (tableCalls[table] ?? 0) + 1;
      const n = tableCalls[table];
      if (table === 'bank_account_balances') {
        return chain({
          data: [{ current_balance: 1000, as_of_date: '2026-08-01' }],
          error: null,
        });
      }
      if (table === 'bank_transactions' && n === 1) {
        return chain({ data: [], error: null });
      }
      if (table === 'bank_transactions') {
        return chain({ data: null, error: null });
      }
      if (table === 'chart_of_accounts' && n === 1) {
        return chain({ data: { id: 'cash-id', account_name: 'Cash' }, error: null });
      }
      if (table === 'chart_of_accounts') {
        return chain({ data: { id: 'equity-id', account_name: 'Equity' }, error: null });
      }
      if (table === 'journal_entries' && n === 1) {
        return chain({ data: null, error: null });
      }
      if (table === 'journal_entries') {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedEntry = payload;
            return chain({ data: { id: 'je-id' }, error: null });
          },
        };
      }
      if (table === 'journal_entry_lines') {
        return { insert: () => chain({ error: null }) };
      }
      if (table === 'reconciliation_boundaries') {
        return { upsert: () => chain({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });
    await result.current.mutateAsync('rest-1');

    const rpcNames = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(rpcNames).not.toContain('bank_txn_entry_day');
    expect(insertedEntry?.entry_date).toBe('2026-08-20');
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
```

Note the no-transaction variant never queries `restaurants`; the mock
throws on an unexpected table, which pins that.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/useCalculateOpeningBalance.test.ts`
Expected: FAIL. The first test asserts the `bank_txn_entry_day` RPC call;
the current hook never calls it and inserts `entry_date` as the raw
timestamptz string.

- [ ] **Step 3: Change the hook**

In `src/hooks/useCalculateOpeningBalance.tsx`, replace Step 6 (lines
68-77):

```typescript
      // Step 6: Get earliest transaction date for the journal entry date.
      // bank_txn_entry_day holds the entry-day convention (date anchors keep
      // the UTC day; real instants take the restaurant-local day). The
      // client never derives the day itself.
      const { data: earliestTxn } = await supabase
        .from('bank_transactions')
        .select('transaction_date')
        .eq('restaurant_id', restaurantId)
        .order('transaction_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      let openingDate = new Date().toISOString().split('T')[0];
      if (earliestTxn?.transaction_date) {
        const { data: restaurant, error: tzError } = await supabase
          .from('restaurants')
          .select('timezone')
          .eq('id', restaurantId)
          .single();
        if (tzError) throw tzError;

        const { data: entryDay, error: entryDayError } = await supabase.rpc(
          'bank_txn_entry_day',
          { p_ts: earliestTxn.transaction_date, p_tz: restaurant.timezone },
        );
        if (entryDayError) throw entryDayError;
        openingDate = entryDay ?? openingDate;
      }
```

In `src/integrations/supabase/types.ts`, add to the `Functions` section in
alphabetical position (before `builtin_role_id_for`):

```typescript
      bank_txn_entry_day: {
        Args: { p_ts: string; p_tz: string | null }
        Returns: string
      }
```

- [ ] **Step 4: Run the tests and the type check to verify they pass**

Run: `npx vitest run tests/unit/useCalculateOpeningBalance.test.ts && npm run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCalculateOpeningBalance.tsx src/integrations/supabase/types.ts tests/unit/useCalculateOpeningBalance.test.ts
git commit -m "fix(ledger): opening balance derives its day from bank_txn_entry_day"
```

---

## Task Dependencies

- Task 1 blocks every other task.
- Tasks 2, 3, 4, 5 are independent of one another; run them in order for
  clean migration timestamps.
- Task 6 needs Task 1 only, but run it after Tasks 2-5 so the migration
  timeline reads: convention lands, then data moves.
- Task 7 needs Task 1 only.

## Production Rollout Note (for the PR body)

The migrations deploy in one release. The re-date migration prints its row
counts as NOTICEs. Expected production effect at measurement time: 179
bank entries + 2 reclass entries move, 0 closed-period skips; counts drift
with the backfill cron. Reports (TrialBalance, BalanceSheet,
IncomeStatement) show corrected numbers for date ranges that cut through
an affected day — this is the intended fix.
