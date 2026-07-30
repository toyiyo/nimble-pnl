# Timezone-Aware Publish/Unpublish Week Bucketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `publish_schedule` and `unpublish_schedule` bucket shifts by the restaurant's IANA timezone instead of the database session timezone, so a late-night closing shift is published with the week it actually belongs to.

**Architecture:** One new migration re-declares both PL/pgSQL functions in full (they have exactly one previous definition, so there is no lineage to preserve), resolving `restaurants.timezone` into a `v_tz` local and replacing three `start_time::date` predicates with `(start_time AT TIME ZONE v_tz)::date` — the same expression `get_open_shifts` already uses. The re-declaration also adds `SET search_path` and an `EXECUTE` privilege boundary. A new pgTAP suite pins the behavior at both week edges, in a zone behind UTC and a zone ahead of it.

**Tech Stack:** PostgreSQL 15 / PL/pgSQL, Supabase migrations, pgTAP, Playwright (comment-only touch).

**Design doc:** `docs/superpowers/specs/2026-07-28-publish-schedule-tz-bucketing-design.md`

## Global Constraints

- **Worktree:** all work happens in `.claude/worktrees/publish-schedule-tz-bucketing` on branch `fix/publish-schedule-tz-bucketing`. Never edit the primary checkout at `/Users/josedelgado/Documents/GitHub/nimble-pnl`.
- **Migration filename:** `supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql`. The `20260728120000` prefix is already taken by `_get_unmapped_sale_item_names.sql`. Re-verify uniqueness immediately before pushing — a duplicate prefix breaks `db:start` for every open PR.
- **`CREATE OR REPLACE` is a full-body rewrite.** Both bodies are copied from `supabase/migrations/20251123000000_schedule_publishing.sql:172-265`, which is their sole prior definition. Nothing else in that file changes.
- **No in-body authorization check.** Deliberately out of scope (design doc, *Not changed*). Do not add one.
- **No frontend changes.** The RPC signatures are unchanged, so `src/hooks/useSchedulePublish.tsx` and the generated types in `src/types/supabase.ts` / `src/integrations/supabase/types.ts` stay as they are.
- **pgTAP hygiene:** no hardcoded calendar dates — derive everything from `CURRENT_DATE`. Build instants as `<local timestamp> AT TIME ZONE '<iana>'` so fixtures survive DST transitions.
- **Local Supabase must be running** for the database steps: `npm run db:start`.
- `npm run test:db` does **not** apply migrations. Any step that runs it after a migration change must run `npm run db:reset` first.

---

### Task 1: pgTAP suite for timezone-bucketed publishing (red)

Write the test first and watch it fail against the current UTC-bucketing functions. Fifteen assertions: four on `publish_schedule` in `America/Chicago`, three on `unpublish_schedule`, two on the `Asia/Tokyo` mirror, two on the invalid-timezone fallback, four on the new `EXECUTE` grants.

**Files:**
- Create: `supabase/tests/publish_schedule_tz_bucketing.test.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the failing suite that Task 2 turns green. `supabase/tests/run_tests.sh` picks up every `*.sql` in that directory automatically — no registration step.

**Background the implementer needs:**

- `shifts` (`supabase/migrations/20251114100000_create_scheduling_tables.sql:18-31`) requires `restaurant_id`, `employee_id`, `start_time`, `end_time`, `position`, and enforces `CHECK (end_time > start_time)`.
- `employees` requires `restaurant_id`, `name`, `position`.
- `schedule_publications.published_by` is `NOT NULL REFERENCES auth.users(id)` and `schedule_change_logs.changed_by` is too. Both RPCs write `auth.uid()` into them, and the `log_shift_change` trigger writes `auth.uid()` into `changed_by` on every update to an already-published shift. **Run as bare `postgres`, `auth.uid()` is NULL and all three violate `NOT NULL`** — the RPC errors before it can test anything. Hence the `set_config('request.jwt.claims', ...)` call in setup: that is what `auth.uid()` actually reads, and it is role-independent, so the suite stays as `postgres`.
- The suite never switches to the `authenticated` role, so — unlike `supabase/tests/open_shift_claim_timezone.test.sql` — it does not need to re-enable RLS partway through.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/publish_schedule_tz_bucketing.test.sql` with exactly this content:

```sql
-- pgTAP tests for timezone-aware week bucketing in publish_schedule /
-- unpublish_schedule (supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql).
--
-- Both functions used to select shifts with a bare `start_time::date`, which
-- casts a timestamptz using the DATABASE SESSION TimeZone (UTC on Supabase)
-- rather than the restaurant's IANA zone. For a restaurant behind UTC, a 22:00
-- local closing shift already falls on the next UTC calendar day, so it landed
-- on the wrong side of p_week_start / p_week_end.
--
-- The two edge cases below are what make this suite non-vacuous:
--   * upper edge — Sunday (week_end) 22:00 America/Chicago = 03:00 UTC the
--     following Monday. The old code EXCLUDED it; it must be published.
--   * lower edge — Sunday (week_start - 1) 22:00 America/Chicago = 03:00 UTC on
--     week_start. The old code INCLUDED it; it belongs to the previous week and
--     must be left alone.
-- A "fix" that only widened the upper bound still fails the lower edge.
--
-- Auth context: publish_schedule writes auth.uid() into the NOT NULL column
-- schedule_publications.published_by, unpublish_schedule writes it into
-- schedule_change_logs.changed_by, and the log_shift_change trigger does the
-- same on every update to an already-published shift. Run as bare postgres,
-- auth.uid() is NULL and all three violate NOT NULL before any bucketing is
-- exercised. set_config('request.jwt.claims', ...) is what auth.uid() reads and
-- is role-independent, so the suite stays as postgres throughout and never
-- needs to re-enable RLS mid-file.
--
-- No hardcoded calendar dates: the week is anchored to the next Monday after
-- CURRENT_DATE. Instants are built as `<local timestamp> AT TIME ZONE '<iana>'`
-- rather than with a literal UTC offset, so the fixtures stay correct across
-- the CST/CDT and any other DST transition.

BEGIN;

SELECT plan(15);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants            DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees              DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications  DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_logs   DISABLE ROW LEVEL SECURITY;

-- Next Monday from today. ISODOW: Monday = 1 ... Sunday = 7, so 8 - ISODOW is
-- always in [1, 7] and never resolves to today.
CREATE TEMP TABLE test_config AS
SELECT
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int))     AS week_start,
  (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) + 6 AS week_end;

-- auth.uid() source for published_by / changed_by.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES (
  'a11ce000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'publish-tz-test@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- Three restaurants: behind UTC, ahead of UTC, and one with a garbage IANA
-- string to exercise the invalid_parameter_value fallback.
INSERT INTO restaurants (id, name, timezone) VALUES
  ('a0000000-0000-0000-0000-00000000c001', 'Chicago Test Restaurant', 'America/Chicago'),
  ('a0000000-0000-0000-0000-00000000d002', 'Tokyo Test Restaurant',   'Asia/Tokyo'),
  ('a0000000-0000-0000-0000-00000000e003', 'Bad TZ Test Restaurant',  'Not/AZone')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position) VALUES
  ('e0000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000c001', 'Chicago Server', 'Server'),
  ('e0000000-0000-0000-0000-00000000d002', 'a0000000-0000-0000-0000-00000000d002', 'Tokyo Server',   'Server'),
  ('e0000000-0000-0000-0000-00000000e003', 'a0000000-0000-0000-0000-00000000e003', 'Bad TZ Server',  'Server');

-- --- America/Chicago fixtures (UTC-5 / UTC-6) ---

-- Control: Monday (week_start) 10:00 local. Unambiguous in every zone.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0001',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  (week_start::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
  (week_start::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- Upper edge: Sunday (week_end) 22:00 local -> 03:00 UTC the following Monday.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0002',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  (week_end::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  (week_end::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- Lower edge: Sunday (week_start - 1) 22:00 local -> 03:00 UTC on week_start.
-- Belongs to the PREVIOUS week.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000c0003',
  'a0000000-0000-0000-0000-00000000c001',
  'e0000000-0000-0000-0000-00000000c001',
  ((week_start - 1)::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
  ((week_start - 1)::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago',
  'Server'
FROM test_config;

-- --- Asia/Tokyo fixtures (UTC+9) — the mirror-image slip ---

-- In-week: Monday (week_start) 06:00 JST -> 21:00 UTC the PREVIOUS Sunday.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000d0001',
  'a0000000-0000-0000-0000-00000000d002',
  'e0000000-0000-0000-0000-00000000d002',
  (week_start::timestamp + interval '6 hours')  AT TIME ZONE 'Asia/Tokyo',
  (week_start::timestamp + interval '14 hours') AT TIME ZONE 'Asia/Tokyo',
  'Server'
FROM test_config;

-- Out-of-week: Monday (week_end + 1) 06:00 JST -> 21:00 UTC on week_end.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000d0002',
  'a0000000-0000-0000-0000-00000000d002',
  'e0000000-0000-0000-0000-00000000d002',
  ((week_end + 1)::timestamp + interval '6 hours')  AT TIME ZONE 'Asia/Tokyo',
  ((week_end + 1)::timestamp + interval '14 hours') AT TIME ZONE 'Asia/Tokyo',
  'Server'
FROM test_config;

-- --- Invalid-IANA fixture: must behave as if UTC ---

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT
  'f0000000-0000-0000-0000-0000000e0001',
  'a0000000-0000-0000-0000-00000000e003',
  'e0000000-0000-0000-0000-00000000e003',
  (week_start::timestamp + interval '10 hours') AT TIME ZONE 'UTC',
  (week_start::timestamp + interval '18 hours') AT TIME ZONE 'UTC',
  'Server'
FROM test_config;

-- ============================================
-- publish_schedule, America/Chicago
-- ============================================

CREATE TEMP TABLE chicago_publication AS
SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000c001',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS publication_id;

-- Test 1
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0001'),
  true,
  'control shift (Mon 10:00 America/Chicago) is published'
);

-- Test 2 — the upper edge the old UTC bucketing dropped
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0002'),
  true,
  'Sun 22:00 America/Chicago on week_end is published (03:00 UTC next Monday)'
);

-- Test 3 — the lower edge the old UTC bucketing swept in
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0003'),
  false,
  'Sun 22:00 America/Chicago before week_start is NOT published (belongs to prior week)'
);

-- Test 4
SELECT is(
  (SELECT shift_count FROM schedule_publications
   WHERE id = (SELECT publication_id FROM chicago_publication)),
  2,
  'schedule_publications.shift_count counts exactly the two in-week shifts'
);

-- ============================================
-- unpublish_schedule, America/Chicago
-- ============================================

-- Mark the lower-edge shift published directly, so unpublish_schedule has
-- something out-of-week it could wrongly clear. OLD.is_published is false here,
-- so log_shift_change short-circuits and writes no audit row.
UPDATE shifts
SET is_published = true, locked = true, published_at = NOW(),
    published_by = 'a11ce000-0000-0000-0000-000000000001'
WHERE id = 'f0000000-0000-0000-0000-0000000c0003';

CREATE TEMP TABLE chicago_unpublish AS
SELECT unpublish_schedule(
  'a0000000-0000-0000-0000-00000000c001',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS unpublished_count;

-- Test 5
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0002'),
  false,
  'unpublish clears the Sun 22:00 week_end shift it published'
);

-- Test 6
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000c0003'),
  true,
  'unpublish leaves the prior-week Sun 22:00 shift alone'
);

-- Test 7
SELECT is(
  (SELECT unpublished_count FROM chicago_unpublish),
  2,
  'unpublish_schedule returns 2 (control + week_end closing shift)'
);

-- ============================================
-- publish_schedule, Asia/Tokyo — the mirror image
-- ============================================

SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000d002',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
);

-- Test 8
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000d0001'),
  true,
  'Mon 06:00 Asia/Tokyo on week_start is published (21:00 UTC previous Sunday)'
);

-- Test 9
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000d0002'),
  false,
  'Mon 06:00 Asia/Tokyo after week_end is NOT published (21:00 UTC on week_end)'
);

-- ============================================
-- Invalid IANA zone falls back to UTC instead of raising
-- ============================================

CREATE TEMP TABLE badtz_publication AS
SELECT publish_schedule(
  'a0000000-0000-0000-0000-00000000e003',
  (SELECT week_start FROM test_config),
  (SELECT week_end   FROM test_config),
  'tz bucketing test'
) AS publication_id;

-- Test 10 -- ok(), not isnt(): an untyped NULL comparand is ambiguous for
-- pgTAP's polymorphic isnt().
SELECT ok(
  (SELECT publication_id FROM badtz_publication) IS NOT NULL,
  'publish_schedule succeeds for a restaurant with an invalid IANA timezone'
);

-- Test 11
SELECT is(
  (SELECT is_published FROM shifts WHERE id = 'f0000000-0000-0000-0000-0000000e0001'),
  true,
  'invalid timezone buckets as UTC rather than raising'
);

-- ============================================
-- EXECUTE privilege boundary
-- ============================================

-- Test 12
SELECT is(
  has_function_privilege('anon', 'public.publish_schedule(uuid,date,date,text)', 'EXECUTE'),
  false,
  'anon cannot execute publish_schedule'
);

-- Test 13
SELECT is(
  has_function_privilege('anon', 'public.unpublish_schedule(uuid,date,date,text)', 'EXECUTE'),
  false,
  'anon cannot execute unpublish_schedule'
);

-- Test 14
SELECT is(
  has_function_privilege('authenticated', 'public.publish_schedule(uuid,date,date,text)', 'EXECUTE'),
  true,
  'authenticated can execute publish_schedule'
);

-- Test 15
SELECT is(
  has_function_privilege('authenticated', 'public.unpublish_schedule(uuid,date,date,text)', 'EXECUTE'),
  true,
  'authenticated can execute unpublish_schedule'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the suite and confirm it fails for the right reasons**

Make sure the local stack is up first:

```bash
npm run db:start
```

Then:

```bash
npm run test:db 2>&1 | grep -A40 "publish_schedule_tz_bucketing"
```

Expected: `not ok` on **tests 2, 3, 5, 6, 8, 9, 12, 13** — the four boundary shifts that bucket wrongly under UTC, and the two privilege assertions the migration has not made true yet.

The others pass for uninteresting reasons and are expected to: 1, 11 (noon and UTC-built fixtures bucket identically either way), 10 (`Not/AZone` is never reached today, since no `AT TIME ZONE` runs), 14, 15 (`authenticated` already holds EXECUTE via the default `PUBLIC` grant), and 4 and 7 **coincidentally** — the buggy code publishes control + lower-edge, which is also two shifts, and then unpublishes those same two. Their value is as regression guards after Task 2, not as red signal now.

If instead the suite errors out with `null value in column "published_by"`, the `set_config('request.jwt.claims', ...)` call is not taking effect — fix that before continuing, because every downstream assertion is meaningless without it.

- [ ] **Step 3: Commit the red test**

```bash
git add supabase/tests/publish_schedule_tz_bucketing.test.sql
git commit -m "test(schedule): pin restaurant-local week bucketing for publish/unpublish

Failing suite: both RPCs bucket with a bare start_time::date, so a 22:00
America/Chicago shift on week_end is excluded and the same shift before
week_start is wrongly included. Also asserts the EXECUTE boundary the
migration is about to add."
```

---

### Task 2: Timezone-aware migration (green)

**Files:**
- Create: `supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql`
- Reference (do not modify): `supabase/migrations/20251123000000_schedule_publishing.sql:172-265`

**Interfaces:**
- Consumes: the failing suite from Task 1.
- Produces: `public.publish_schedule(UUID, DATE, DATE, TEXT) RETURNS UUID` and `public.unpublish_schedule(UUID, DATE, DATE, TEXT) RETURNS INTEGER` — signatures and return types byte-identical to the previous definitions, so no caller or generated type changes.

- [ ] **Step 1: Confirm the migration prefix is still free**

```bash
ls supabase/migrations/ | grep '^20260728'
```

Expected: only `20260728120000_get_unmapped_sale_item_names.sql`. If a `20260729120000_*` appeared, pick the next free two-hour slot and update every reference in this plan and the design doc.

This is what actually happened: the migration was authored as `20260728140000`, and PR #673 landed `20260728140000_search_pos_items.sql` on `main` mid-branch. Check the *merged* set (branch ∪ `origin/main`), not just `ls` on the branch — the branch alone never sees the collision.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql`:

```sql
-- Timezone-aware week bucketing for publish_schedule / unpublish_schedule.
--
-- PROVENANCE: both functions are re-declared here IN FULL. Their sole previous
-- definition is supabase/migrations/20251123000000_schedule_publishing.sql
-- (verified with:
--    grep -rlE "FUNCTION\s+(public\.)?(publish_schedule|unpublish_schedule)\b" \
--      supabase/migrations/
-- which returns only that file). CREATE OR REPLACE rewrites the whole body, so
-- everything from that migration is carried forward verbatim except the three
-- date-bucketing predicates and the hardening noted below.
--
-- BUG: shifts were selected with `start_time::date`. Casting a timestamptz to
-- date resolves against the DATABASE SESSION TimeZone, not the restaurant's
-- IANA zone. No migration sets a non-default TimeZone, so on Supabase that is
-- UTC. For a restaurant behind UTC -- America/Chicago at UTC-5 -- a closing
-- shift starting 22:00 local already falls on the NEXT UTC calendar day, so it
-- landed on the wrong side of p_week_start / p_week_end: excluded at the end of
-- its own week, included at the start of the next one. East of UTC the slip
-- mirrors (06:00 Monday in Asia/Tokyo is 21:00 Sunday UTC).
--
-- FIX: resolve the restaurant's zone into v_tz and bucket with
-- (start_time AT TIME ZONE v_tz)::date -- the same expression get_open_shifts
-- already uses (20260529120000_fix_open_shifts_capacity_one.sql:107-109), so
-- the publish path and the read path now agree about which shifts a week owns.
--
-- CARRIED ALONG (safe to do only because we are re-declaring anyway):
--   * SET search_path on these SECURITY DEFINER functions (Supabase advisor
--     lint; CREATE OR REPLACE does not carry SECURITY DEFINER forward either,
--     so it is restated explicitly).
--   * Schema-qualified table references.
--   * An EXECUTE privilege boundary. Neither function has ever had a
--     GRANT/REVOKE, so both still carried Postgres's default PUBLIC EXECUTE
--     while being SECURITY DEFINER -- an anonymous caller holding only the
--     publishable key could publish-and-lock or unpublish any restaurant's
--     week. Template: 20260723170000_link_invited_employee.sql:165-166.
--
-- NOT DONE HERE: an in-body check that the caller belongs to p_restaurant_id.
-- Any authenticated user can still pass a foreign restaurant UUID. That needs
-- its own decision about which roles may publish and is a tracked follow-up --
-- see docs/superpowers/specs/2026-07-28-publish-schedule-tz-bucketing-design.md.

CREATE OR REPLACE FUNCTION public.publish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_count INTEGER;
  v_publication_id UUID;
  v_tz TEXT;
BEGIN
  -- Resolve the restaurant's IANA zone ONCE, before any use of v_tz below.
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- Covers both a NULL timezone and an empty string; also covers no such
  -- restaurant, where SELECT ... INTO leaves v_tz NULL.
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  -- An invalid IANA string raises invalid_parameter_value (22023) on first use,
  -- which would abort the whole publish. Probe once with a throwaway
  -- expression: the error depends only on the zone string, not on the
  -- timestamptz being converted, so now() raises exactly when s.start_time
  -- would. Reassigning v_tz itself is what makes every later reference safe.
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- Count shifts to be published
  SELECT COUNT(*) INTO v_shift_count
  FROM public.shifts s
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = false;

  -- Update shifts to published
  UPDATE public.shifts s
  SET
    is_published = true,
    locked = true,
    published_at = NOW(),
    published_by = auth.uid()
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = false;

  -- Create publication record
  INSERT INTO public.schedule_publications (
    restaurant_id,
    week_start_date,
    week_end_date,
    published_by,
    shift_count,
    notes
  ) VALUES (
    p_restaurant_id,
    p_week_start,
    p_week_end,
    auth.uid(),
    v_shift_count,
    p_notes
  ) RETURNING id INTO v_publication_id;

  RETURN v_publication_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_count INTEGER;
  v_tz TEXT;
BEGIN
  -- Same resolution as publish_schedule; see the comment there.
  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');

  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- Update shifts to unpublished
  UPDATE public.shifts s
  SET
    is_published = false,
    locked = false,
    published_at = NULL,
    published_by = NULL
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.start_time AT TIME ZONE v_tz)::date >= p_week_start
    AND (s.start_time AT TIME ZONE v_tz)::date <= p_week_end
    AND s.is_published = true;

  -- Get the count of updated rows
  GET DIAGNOSTICS v_shift_count = ROW_COUNT;

  -- Log the unpublish action
  INSERT INTO public.schedule_change_logs (
    restaurant_id,
    change_type,
    changed_by,
    reason
  ) VALUES (
    p_restaurant_id,
    'unpublished',
    auth.uid(),
    COALESCE(p_reason, 'Schedule unpublished for date range: ' || p_week_start || ' to ' || p_week_end)
  );

  RETURN v_shift_count;
END;
$$;

-- Least privilege. Supabase's default privileges grant EXECUTE on public
-- functions to anon as well as authenticated, so revoking PUBLIC alone is not
-- enough -- anon must be named. service_role is granted so a future edge
-- function does not silently break.
REVOKE ALL ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.publish_schedule(UUID, DATE, DATE, TEXT) IS
  'Publishes all shifts in a date range and locks them. Buckets shifts by the '
  'restaurant''s IANA timezone (restaurants.timezone, falling back to UTC), not '
  'the database session timezone, so late-night shifts belong to the local '
  'calendar day they start on.';

COMMENT ON FUNCTION public.unpublish_schedule(UUID, DATE, DATE, TEXT) IS
  'Unpublishes shifts in a date range (for corrections only). Uses the same '
  'restaurant-local date bucketing as publish_schedule.';
```

- [ ] **Step 3: Apply the migration**

`npm run test:db` does not apply migrations — reset first:

```bash
npm run db:reset
```

Expected: the reset completes and lists `20260729120000_publish_schedule_tz_bucketing.sql` among the applied migrations, with no SQL error.

- [ ] **Step 4: Run the suite and confirm all 15 pass**

```bash
npm run test:db 2>&1 | grep -A40 "publish_schedule_tz_bucketing"
```

Expected: `All 15 tests passed` (or 15 `ok` lines, no `not ok`).

- [ ] **Step 5: Run the whole database suite for regressions**

```bash
npm run test:db
```

Expected: `Failed:       0`. Pay particular attention to any suite touching `shifts`, `schedule_publications`, or `get_open_shifts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729120000_publish_schedule_tz_bucketing.sql
git commit -m "fix(schedule): bucket publish/unpublish weeks in the restaurant's timezone

publish_schedule and unpublish_schedule selected shifts with a bare
start_time::date, which resolves against the database session TimeZone (UTC on
Supabase) rather than restaurants.timezone. A 22:00 America/Chicago closing
shift is already the next UTC calendar day, so it was dropped from its own week
and swept into the next one; east of UTC the slip mirrors.

Both functions now resolve the restaurant's IANA zone into v_tz and bucket with
(start_time AT TIME ZONE v_tz)::date, matching get_open_shifts. Invalid zone
strings fall back to UTC instead of aborting the publish.

Re-declaring also adds SET search_path to these SECURITY DEFINER functions and
an EXECUTE boundary: both still carried the default PUBLIC grant, so anon could
publish or unpublish any restaurant's week. An in-body caller identity check
remains a tracked follow-up."
```

---

### Task 3: Correct the stale E2E comment

`tests/e2e/broadcast-open-shifts.spec.ts:74` claims the RPC "compares local date." That was false when written — it compared the session (UTC) date — and it is the reason the spec seeds a noon shift. It is true as of Task 2, but for a different reason than the comment gives. Comment-only; no behavior change, and the noon fixture stays, because that spec tests broadcast, not the week boundary.

**Files:**
- Modify: `tests/e2e/broadcast-open-shifts.spec.ts:73-74`

**Interfaces:**
- Consumes: the migration from Task 2 (the comment describes its behavior).
- Produces: nothing downstream.

- [ ] **Step 1: Replace the comment**

Find:

```typescript
      // Insert a draft shift for Monday at noon local time (avoids timezone edge cases)
      // The publish_schedule RPC uses start_time::date which compares local date
```

Replace with:

```typescript
      // Insert a draft shift for Monday at noon local time (avoids timezone edge cases)
      // publish_schedule buckets shifts by the restaurant's IANA timezone
      // (restaurants.timezone), so noon is unambiguous — it is the same
      // calendar day in the restaurant's zone and in UTC.
```

- [ ] **Step 2: Verify nothing else changed**

```bash
git diff --stat tests/e2e/broadcast-open-shifts.spec.ts
```

Expected: `1 file changed, 3 insertions(+), 1 deletion(-)` — comment lines only.

- [ ] **Step 3: Lint the touched file**

```bash
npx eslint tests/e2e/broadcast-open-shifts.spec.ts
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/broadcast-open-shifts.spec.ts
git commit -m "test(e2e): correct stale comment about publish_schedule date bucketing

The comment said the RPC compared the local date; before the tz-bucketing fix
it compared the session (UTC) date. Now accurate, and it names the actual
source of truth. Comment only — the noon fixture is unchanged."
```

---

### Task 4: Full verification gate

Nothing new is written here — this is the pre-PR check that the branch is clean end to end.

**Files:** none modified.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a branch ready for review.

- [ ] **Step 1: Re-check the migration prefix against the latest `main`**

```bash
git fetch origin && { git ls-tree --name-only origin/main supabase/migrations/; git ls-tree --name-only HEAD supabase/migrations/; } \
  | sed 's|.*/||' | awk -F_ '{print $1}' | sort -u | tail -5
```

Expected: no `20260729120000_*` from any source other than this branch. If one appeared while this branch was open, rename the local migration to the next free slot and update the design doc and this plan.

Run this against the *merged* set, not `ls` on the branch — CI builds the merge ref, so a collision introduced by another PR is invisible to a branch-local check.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0. (No TypeScript changed, so this should be unaffected — it is a guard against an unrelated drift landing in the branch.)

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no new errors relative to `origin/main`.

- [ ] **Step 4: Unit tests**

```bash
npm run test
```

Expected: all pass. `src/lib/shiftDeleteNotification.ts:45-46` documents the publish/unpublish `is_published`/`locked` lockstep invariant and has a unit test asserting it — that invariant is untouched here, and the test proves it.

- [ ] **Step 5: Database tests from a clean reset**

```bash
npm run db:reset && npm run test:db
```

Expected: `Failed:       0`, including `All 15 tests passed` for `publish_schedule_tz_bucketing.test.sql`.

- [ ] **Step 6: Confirm the diff is exactly what was planned**

```bash
git diff --stat origin/main...HEAD
```

Expected: four files — the two design/plan docs, the new migration, the new pgTAP suite — plus the three-line comment change in `tests/e2e/broadcast-open-shifts.spec.ts`. Any other file in the diff is unintended.

---

## E2E coverage gate

No Playwright spec is added, and this is a deliberate, justified exception rather than an omission:

- There is no route, page, dialog, component, hook, or RPC-signature change. The user-facing publish flow is byte-identical.
- What changed is a date-bucketing predicate inside two SQL functions. The pgTAP suite exercises exactly the boundary that moved, in two timezones and at both edges.
- An E2E covering this would have to seed a non-UTC restaurant and a 22:00 shift and then assert on `shifts.is_published` through the database anyway — the same assertions as Task 1, with a browser and a login in the way.
- The existing `tests/e2e/broadcast-open-shifts.spec.ts` still covers the publish flow end to end, and its noon-local fixture behaves identically before and after.
