# Availability Local Time, PR 1 (Database and Edge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store recurring availability as restaurant-local wall-clock time, and make the conflict RPC and the schedule generator read it.

**Architecture:** Add `start_time_local` and `end_time_local` beside the legacy UTC columns. A trigger keeps the two frames in step, so a stale client stays safe. One migration fills the new columns with the offset of each row's write date.

**Tech Stack:** PostgreSQL, pgTAP, Supabase edge functions (Deno), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-availability-local-time-design.md`

**Second plan:** `docs/superpowers/plans/2026-11-05-availability-local-time-frontend-plan.md`. The workflow takes every task in a plan file and opens one PR for each run. So each PR has its own plan file and its own run.

## Global Constraints

- Branch: `fix/availability-local-time`. Worktree: `.claude/worktrees/availability-local-time`.
- **Merge of this PR writes to production.** Autonomous work stops at an open PR with green CI. The owner merges. Spec section 8 is the gate.
- Keep the legacy `start_time` and `end_time` values and meaning. Nothing that a stale client reads changes meaning.
- `availability_exceptions` keep UTC values.
- Writing standard: `docs/STE100_STYLE.md`, for comments, commits, and the PR body.
- Stage explicit paths only. Never commit `progress.md`, and never commit `package-lock.json` from `npm install`.
- Use `new Date(year, month, day)` for DST fixtures in TypeScript tests. Do not use noon-UTC ISO strings.
- Run `npm run db:start` once before a pgTAP step. Stop nothing that you did not start.
- Bound every wait with the Bash tool `timeout`. Use no poll loop.
- After the deploy of PR 1, run the query of the false conflicts again on production, read-only. The 48 false conflicts of spec section 10 must be gone, and the 14 real conflicts must stay. This step comes after the autonomous work.

## Review Focus

1. **A legacy pair that looks overnight, but a local pair that does not.** 10:00 to 22:00 CDT is 15:00 to 03:00 UTC. It must not spill into D+1. Most production rows have this shape. Task 2 and Task 4 test it.
2. **A restaurant with a null or invalid `timezone`.** The write and the migration succeed with a zero offset. Task 1 tests it.
3. **The restaurant timezone changes after a save.** The local value stays, and the conflict result stays. Task 2 tests it.
4. **A new client sends the whole row back.** The row holds old legacy values and a new local value. The local value wins. Task 1 tests it.
5. **Two windows on one day.** `available_start_local` follows the same first-window rule as `available_start`. Task 2 tests it.

---

### Task 1: Local columns, offset helper, backfill, and sync trigger

**Files:**
- Create: `supabase/migrations/20261105120000_availability_local_time.sql`
- Create: `supabase/tests/availability_local_time.sql`
- Create: `tests/unit/availabilityLocalMigration.test.ts`
- Modify: `supabase/tests/user_has_restaurant_access.test.sql`, `supabase/tests/link_employee_to_user.sql` (only if they fail)

**Interfaces:**
- Produces:
  - Columns `employee_availability.start_time_local TIME`, `end_time_local TIME`, both nullable.
  - `public.availability_noon_offset(p_instant timestamptz, p_tz text) RETURNS interval`, `STABLE`. It gives the UTC offset at noon local on the local date of `p_instant`. CDT gives `-05:00`. `local = utc + offset`.
  - `public.sync_employee_availability_frames() RETURNS trigger`, on trigger `sync_employee_availability_frames`.
  - `public.backfill_employee_availability_local() RETURNS integer`. It gives the updated row count. `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, `service_role`. The contract PR deletes it. It exists so that pgTAP can test the backfill.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/availability_local_time.sql` in the `BEGIN; SELECT plan(N); ... finish(); ROLLBACK;` pattern. Fixtures: restaurants in `America/Chicago`, in `Not/AZone`, and with a null timezone, each with one employee.

`now()` cannot move in a test. So trigger tests compute the expected value with the helper. Fixed-date cases test the helper and the backfill.

```sql
-- Offset helper
SELECT is(availability_noon_offset('2026-07-15 17:00+00', 'America/Chicago'), '-05:00'::interval, 'CDT');
SELECT is(availability_noon_offset('2026-12-15 18:00+00', 'America/Chicago'), '-06:00'::interval, 'CST');
SELECT is(availability_noon_offset('2026-11-01 12:00+00', 'America/Chicago'), '-06:00'::interval, 'fall day uses noon');
SELECT is(availability_noon_offset('2026-03-08 12:00+00', 'America/Chicago'), '-05:00'::interval, 'spring day uses noon');
SELECT is(availability_noon_offset('2026-11-01 04:30+00', 'America/Chicago'), '-05:00'::interval, 'local date is Oct 31');
SELECT is(availability_noon_offset(now(), 'Not/AZone'), '00:00'::interval, 'invalid timezone');
SELECT is(availability_noon_offset(now(), NULL), '00:00'::interval, 'null timezone');
```

Add one case for each row of the INSERT and UPDATE tables in spec section 7.2. Also add these cases:

| Case | Write | Expected |
|---|---|---|
| Stale insert | legacy `15:00`, `03:00` | local = legacy + `availability_noon_offset(now(), tz)` |
| New insert | local `10:00`, `22:00` | legacy = local - offset |
| Closed day | local values, `is_available = false` | legacy values are not null |
| Incomplete pair | local start only | `throws_ok(..., '23502')` |
| Local set to null | `end_time_local = NULL` | `throws_ok(..., '23502')` |
| Legacy set to null | `end_time = NULL` | `throws_ok(..., '23502')` |
| Stale update, one column | `end_time` changes, `start_time` the same | `start_time_local` stays, `end_time_local` changes |
| Stale save, no change | same legacy values | local columns stay |
| Whole row back (Review Focus 4) | new `end_time_local`, old legacy values | local wins, legacy `end_time` follows it |
| Local equal | `end_time_local = start_time_local` | `throws_ok(..., '23514')` |
| Invalid and null timezone (Review Focus 2) | local `10:00`, `22:00` | legacy `10:00`, `22:00` |
| Hidden restaurant | `SET LOCAL ROLE authenticated` as an employee with no `user_restaurants` row | local = legacy + Chicago offset, not a zero offset |

Backfill cases. Disable `sync_employee_availability_frames` and `update_employee_availability_updated_at`, as the migration order does. Insert legacy-only rows with fixed `updated_at` values, then call `backfill_employee_availability_local()`:

| Anchor `updated_at` | Legacy | Expected local |
|---|---|---|
| `2026-07-15 17:00+00` | `15:00`, `03:00` | `10:00`, `22:00` |
| `2026-12-15 18:00+00` | `16:00`, `04:00` | `10:00`, `22:00` |
| `2026-11-01 18:00+00` | `05:00`, `07:00` | `23:00`, `01:00` |
| Any, `Not/AZone` | `15:00`, `03:00` | `15:00`, `03:00` |
| `updated_at` null, `created_at` in July | `15:00`, `03:00` | `10:00`, `22:00` |

Also check that the backfill keeps the legacy values and `updated_at`, and that a row with `is_available = false` gets local values.

- [ ] **Step 2: Write the failing order test**

`tests/unit/availabilityLocalMigration.test.ts` reads the migration file as text. Spec section 7.4 fixes this order. pgTAP cannot see it.

```typescript
const order = [
  'ADD COLUMN',
  'DROP NOT NULL',
  'DISABLE TRIGGER update_employee_availability_updated_at',
  'SELECT public.backfill_employee_availability_local()',
  'ENABLE TRIGGER update_employee_availability_updated_at',
  'CREATE TRIGGER sync_employee_availability_frames',
  'ADD CONSTRAINT',
];
const positions = order.map((s) => sql.indexOf(s));
expect(positions.every((p) => p >= 0)).toBe(true);
expect(positions).toEqual([...positions].sort((a, b) => a - b));
expect(sql.trimStart().startsWith('BEGIN;') || /^BEGIN;$/m.test(sql)).toBe(true);
expect(/^COMMIT;$/m.test(sql)).toBe(true);
```

- [ ] **Step 3: Run both tests to check that they fail**

Run: `npx vitest run tests/unit/availabilityLocalMigration.test.ts`
Expected: FAIL, the migration file does not exist.

Run: `npm run test:db`
Expected: FAIL in `availability_local_time.sql`, the function does not exist.

- [ ] **Step 4: Write the migration**

The body of the offset helper has a sign trap, so use this form:

```sql
v_noon := (p_instant AT TIME ZONE p_tz)::date + TIME '12:00';
RETURN COALESCE(v_noon - ((v_noon AT TIME ZONE p_tz) AT TIME ZONE 'UTC'), INTERVAL '0');
-- EXCEPTION WHEN invalid_parameter_value THEN RETURN INTERVAL '0';
```

Rules:

- Use `BEGIN;` and `COMMIT;`. The precedent is `20260522000000_fix_bulk_set_availability_local_to_utc.sql`.
- Keep the step order of spec section 7.4. The order test checks it.
- Step 1 of that order also runs `ALTER COLUMN ... DROP NOT NULL` on `start_time` and `end_time`. The trigger then raises `not_null_violation` in place of the column rule.
- Create the functions before the first step that calls them.
- The constraint is `CHECK (end_time_local <> start_time_local)`.
- The trigger function is `SECURITY DEFINER`, `SET search_path = public, pg_catalog`. It reads the timezone with `NEW.restaurant_id`.
- `TIME + INTERVAL` wraps at 24:00, so no modulo is necessary.
- Compare with `IS DISTINCT FROM`. Check each legacy column on its own.
- Run `REVOKE ALL ... FROM PUBLIC, anon` on the helper and the trigger function.
- The backfill anchor is `COALESCE(updated_at, created_at)`. Pass it to the helper with the restaurant timezone. No raw `AT TIME ZONE tz` goes in the backfill, because an invalid timezone aborts it.
- End with `NOTIFY pgrst, 'reload schema';` before `COMMIT;`.

- [ ] **Step 5: Run the tests to check that they pass**

Run: `npx supabase db reset`, then `npm run test:db`, then `npx vitest run tests/unit/availabilityLocalMigration.test.ts`
Expected: `availability_local_time.sql` passes. The order test passes. Change `user_has_restaurant_access.test.sql` and `link_employee_to_user.sql` only if they fail.

Other availability pgTAP files can fail here. Task 2 and Task 3 change them.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261105120000_availability_local_time.sql supabase/tests/availability_local_time.sql tests/unit/availabilityLocalMigration.test.ts
git commit -m "feat(availability): add local time columns with a sync trigger"
```

Add `user_has_restaurant_access.test.sql` and `link_employee_to_user.sql` to the `git add` if Step 5 changed them.

### Task 2: `check_availability_conflict` reads the local columns

**Files:**
- Create: `supabase/migrations/20261105120100_availability_conflict_local_time.sql`
- Modify: `supabase/tests/availability_conflict_local_tz.sql`, `availability_conflict_utc.sql`, `availability_overnight.sql`, `availability_conflict_structured.sql`

**Interfaces:**
- Consumes: the local columns from Task 1.
- Produces: `check_availability_conflict` with the two new return columns `available_start_local TIME`, `available_end_local TIME`, after the current return columns. PR 2 reads them.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/tests/availability_conflict_local_tz.sql`. All windows are written with local columns in `America/Chicago`, unless the row says different.

| Test | Window | Shift | Expected |
|---|---|---|---|
| July and December agree | Fri 10:00-22:00 | Fri 2026-07-17 and Fri 2026-12-18, 10:00-22:00 local | no conflict on both |
| Real conflict stays | Fri 10:00-22:00 | Fri 09:00-22:00 local | conflict on both dates |
| Legacy looks overnight (Review Focus 1) | Fri 10:00-22:00 | Sat 01:00-02:00 local, Sat has a closed row | conflict, no spill from Fri |
| True overnight | Fri 18:00-02:00 | Sat 01:00-02:00 local | no conflict |
| Midnight end | Fri 18:00-00:00 | Sat 09:00-10:00 local, no Sat rows | no conflict, no window for Sat |
| Past 24:00 UTC | 17:00-23:00 in `America/Los_Angeles`, and 20:00-23:00 in `America/New_York` | inside the window | no conflict |
| Timezone change (Review Focus 3) | Fri 10:00-22:00 | change `restaurants.timezone` to `America/New_York`, shift 10:00-22:00 New York | no conflict |
| Local fields, recurring | Fri 10:00-22:00 | Fri 09:00-22:00 | `available_start_local = '10:00'`, `available_end_local = '22:00'` |
| Local fields, exception | exception 15:00-23:00 UTC on a CST date | shift outside it | `available_start_local = '09:00'`, `available_start = '15:00'` |
| Two windows (Review Focus 5) | Fri 10:00-12:00 and 14:00-16:00 | outside both | `available_start_local` and `available_start` come from the same row |

Add a grants test:

```sql
SELECT ok(NOT has_function_privilege('anon', 'public.check_availability_conflict(uuid, uuid, timestamptz, timestamptz)', 'EXECUTE'), 'anon has no EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.check_availability_conflict(uuid, uuid, timestamptz, timestamptz)', 'EXECUTE'), 'authenticated has EXECUTE');
```

Copy the exact argument types from the base migration if they differ.

- [ ] **Step 2: Run the test to check that it fails**

Run: `npm run test:db`
Expected: FAIL in `availability_conflict_local_tz.sql`, the column `available_start_local` does not exist.

- [ ] **Step 3: Write the migration**

Base: `supabase/migrations/20260724120000_availability_conflict_tz_exception_fallback.sql`. Copy the function, then apply spec section 7.5:

- `DROP FUNCTION` and `CREATE FUNCTION` in one `BEGIN` and `COMMIT`.
- The recurring and previous-day loops read the local columns with no conversion.
- The previous-day test is `end <= start AND end <> TIME '00:00:00'`.
- The same-day loop keeps its current overnight behaviour.
- The exception branch keeps its UTC conversion. The `v_tz := 'UTC'` handler stays.
- For an exception, `available_start_local` and `available_end_local` hold `v_w_start_tod` and `v_w_end_tod`. Use the first-window rule of `v_last_start`.
- `available_start` and `available_end` keep their current values for stale clients.
- `SECURITY INVOKER`, `STABLE`, and the same `search_path`.
- `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`.
- `NOTIFY pgrst, 'reload schema';`

- [ ] **Step 4: Change the four existing pgTAP files to the local frame**

Change fixtures that insert legacy values so that they insert local values. Keep the assertions on `available_start` and `available_end`.

- [ ] **Step 5: Run the tests to check that they pass**

Run: `npx supabase db reset`, then `npm run test:db`
Expected: all availability conflict files pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261105120100_availability_conflict_local_time.sql supabase/tests/availability_conflict_local_tz.sql supabase/tests/availability_conflict_utc.sql supabase/tests/availability_overnight.sql supabase/tests/availability_conflict_structured.sql
git commit -m "fix(availability): read local time in the conflict check"
```

### Task 3: `bulk_set_employee_availability` accepts local keys

**Files:**
- Create: `supabase/migrations/20261105120200_bulk_set_availability_local_keys.sql`
- Modify: `supabase/tests/bulk_set_employee_availability.test.sql`

**Interfaces:**
- Consumes: the sync trigger from Task 1.
- Produces: the RPC accepts `start_time_local` and `end_time_local` keys in each JSONB element. PR 2 sends them.

- [ ] **Step 1: Write the failing tests**

| Test | Element | Expected |
|---|---|---|
| Local keys | `start_time_local: 10:00`, `end_time_local: 22:00` | local `10:00`, `22:00`, legacy not null |
| Legacy keys | `start_time: 15:00`, `end_time: 03:00` | local = legacy + today offset |
| Both frames | local `10:00` and legacy `01:00` | local `10:00` |
| Closed day | local placeholders, `is_available: false` | row exists, four values not null |
| Incomplete pair | `is_available: true`, `start_time_local` only | `throws_ok(..., '23502')` |

- [ ] **Step 2: Run the test to check that it fails**

Run: `npm run test:db`
Expected: FAIL, the local keys give a `not_null_violation`.

- [ ] **Step 3: Write the migration**

Base: `supabase/migrations/20260521133930_bulk_set_employee_availability.sql`. Use `CREATE OR REPLACE` with the same signature, `SECURITY DEFINER`, and `search_path`. Add `start_time_local` and `end_time_local` to the `INSERT` column list, from `(a->>'start_time_local')::time` and `(a->>'end_time_local')::time`. The function deletes and inserts, so only the INSERT rows of the trigger apply. Keep the grants of the base file.

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx supabase db reset`, then `npm run test:db`
Expected: the full pgTAP suite passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261105120200_bulk_set_availability_local_keys.sql supabase/tests/bulk_set_employee_availability.test.sql
git commit -m "feat(availability): accept local keys in the bulk RPC"
```

### Task 4: `generate-schedule` reads the local columns

**Files:**
- Modify: `supabase/functions/_shared/availability-tz.ts:163`
- Modify: `supabase/functions/generate-schedule/index.ts:165-166,302-311`
- Test: `tests/unit/availability-tz.test.ts` (lines 11-215 change, cases from line 216 stay)
- Test: `tests/unit/generate-schedule-integration.test.ts`, `tests/unit/generate-schedule-client-safe.test.ts` (only if they call the old signature)

**Interfaces:**
- Consumes: the local columns.
- Produces: `convertRecurringToLocal(rows: RawRecurringAvail[]): LocalAvail[]`. `RawRecurringAvail` has `start_time_local: string | null` and `end_time_local: string | null`. The timezone and `weekStart` parameters are deleted.

- [ ] **Step 1: Write the failing tests**

```typescript
const row = (start: string, end: string, dow = 5) => ({
  employee_id: 'e1', day_of_week: dow, is_available: true,
  start_time_local: start, end_time_local: end,
});

it('keeps a same-day window on its stored day', () => {
  expect(convertRecurringToLocal([row('10:00:00', '22:00:00')])).toEqual([
    expect.objectContaining({ day_of_week: 5, start_time: '10:00:00', end_time: '22:00:00' }),
  ]);
});

it('splits an overnight window into D and D+1', () => {
  const out = convertRecurringToLocal([row('18:00:00', '02:00:00')]);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ day_of_week: 5, start_time: '18:00:00', end_time: '24:00:00' });
  expect(out[1]).toMatchObject({ day_of_week: 6, start_time: '00:00:00', end_time: '02:00:00' });
});

it('wraps Saturday to Sunday', () => {
  expect(convertRecurringToLocal([row('18:00:00', '02:00:00', 6)])[1]).toMatchObject({ day_of_week: 0 });
});

it('makes no D+1 row for a midnight end', () => {
  const out = convertRecurringToLocal([row('18:00:00', '00:00:00')]);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ day_of_week: 5, end_time: '24:00:00' });
});

it('never writes to D-1', () => {
  const days = convertRecurringToLocal([row('20:00:00', '23:00:00')]).map((r) => r.day_of_week);
  expect(days).toEqual([5]);
});
```

Match the field names of `LocalAvail` in `availability-tz.ts` if they differ. Add a closed-day case that gives the same shape as `convertOne` gives today. Add a row with null local values, which gives no output.

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/availability-tz.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the change**

Apply spec section 7.7. Change the select at `index.ts:165-166` and the call at `:302-311`. Trust the stored `day_of_week`. Delete `dateForDayOfWeek` if nothing uses it. `convertOne` and `convertExceptionsToLocal` stay.

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/availability-tz.test.ts tests/unit/generate-schedule-integration.test.ts tests/unit/generate-schedule-client-safe.test.ts`
Expected: PASS. The exception cases from line 216 pass with no change.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/availability-tz.ts supabase/functions/generate-schedule/index.ts tests/unit/availability-tz.test.ts
git commit -m "fix(schedule): read local availability in the generator"
```

Add the two `generate-schedule` test files to the `git add` if Step 3 changed them.

### Task 5: Read-only dry run and a migration rehearsal

**Files:**
- Create: `docs/superpowers/plans/2026-11-05-availability-local-time-dry-run.sql`

**Interfaces:**
- Produces: one file with `SELECT` statements only. The owner gate of spec section 8 uses it. The helper does not exist on production before the merge, so the file computes the offset inline.

- [ ] **Step 1: Write the dry-run file**

The file holds these four `SELECT` statements. `LEFT JOIN pg_timezone_names` to find an invalid timezone. That read is slow, but it runs one time here.

A raw `AT TIME ZONE` aborts the read on an invalid timezone. So use `CASE WHEN tz.name IS NULL THEN INTERVAL '0' ELSE <offset> END`. A null timezone takes the same path. This matches the helper of Task 1.

1. The total rows, the available rows, and the closed rows.
2. For each old pair and new pair: the count of rows, grouped by `start_time`, `end_time`, new local start, new local end.
3. The rows that can have a mixed write history: any time change in the
   restaurant timezone between `created_at` and `updated_at`. An edit between
   the two dates can write the start with one offset and the end with another.
   The backfill uses one offset, so one time can be one hour wrong. Put these
   rows on the owner review list. Production has 1 such row on 2026-11-23.
4. The rows with an anchor on the day of a time change, and the rows in a restaurant with an invalid timezone.

- [ ] **Step 2: Check that the file has no write**

Run: `grep -n -i -E "\b(insert|update|delete|alter|drop|create|truncate)\b" docs/superpowers/plans/2026-11-05-availability-local-time-dry-run.sql`
Expected: no output. A column name such as `updated_at` does not match `\bupdate\b`.

- [ ] **Step 3: Rehearse the migration on local data**

This is the only test that runs the real migration over rows that exist before it.

1. Run: `npx supabase db reset --version 20261031120100`
2. Insert three legacy rows in the local database: a July `updated_at`, a December `updated_at`, and a `2026-11-01` `updated_at`.
3. Disable `update_employee_availability_updated_at` for that insert, then enable it.
4. Run: `npx supabase migration up`
5. Query the three rows.

Expected: the local values match the table in Task 1. The legacy values and `updated_at` are unchanged.

- [ ] **Step 4: Run the full check**

Run: `npx supabase db reset`, then `npm run test:db`, `npm run test`, `npm run typecheck`, `npm run lint`
Expected: all pass. PR 1 changes no frontend code, and the frontend still reads legacy columns.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-11-05-availability-local-time-dry-run.sql
git commit -m "docs: add the read-only dry run for the availability backfill"
```
