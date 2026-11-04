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
