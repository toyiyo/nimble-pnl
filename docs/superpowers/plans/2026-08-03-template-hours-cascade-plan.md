# Template Hours Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a manager changes a shift template's hours, cascade the new hours to the linked future shifts that still match the template, showing the blast radius inline before the save and offering Undo after it.

**Architecture:** One `SECURITY DEFINER` Postgres RPC updates the template row and the eligible shift rows in a single transaction and tags its audit rows with a `cascade_batch_id`; a second RPC reverts exactly that batch. On the client, one React Query read fetches the linked shifts once per dialog open, two pure modules turn those rows into buckets and into display copy, and a presentational panel renders the ledger inside the existing `TemplateFormDialog`.

**Tech Stack:** Postgres 15 / Supabase (plpgsql, pgTAP), React 18.3 + TypeScript + Vite, React Query, shadcn/ui (Radix), TailwindCSS, Vitest, Playwright.

## Global Constraints

- **Scope is `start_time` / `end_time` only.** Do not cascade `days[]` or `capacity`. They are follow-ups.
- **Every comparison and every write of a shift time happens in the restaurant's timezone**, never the browser's and never the database session's.
- **Reconstruct times from parts, never by interval offset.** `new_start = old_start + delta` is wrong on DST days.
- **Timezone fallback in the two new RPCs is `'America/Chicago'`**, matching the client's `safeTz` and the `restaurants.timezone` column default — deliberately diverging from the `'UTC'` fallback in the six sibling scheduling functions. Record the divergence in an inline comment.
- **`SECURITY DEFINER` bypasses RLS, so every statement in both new functions must additionally scope by `restaurant_id = p_restaurant_id`.** The capability guard alone is not sufficient. This is non-negotiable and is covered by an explicit pgTAP assertion.
- **Authorization guard is `user_has_capability(p_restaurant_id, 'edit:scheduling')`**, not a hardcoded role array — it is what the `shifts` UPDATE policy and the `schedule_change_logs` INSERT policy both require.
- **Styling: semantic tokens only.** No `bg-white` / `text-black`. Use `border-border/40`, `bg-muted/30`, `rounded-lg` for inputs/buttons, `rounded-xl` for containers, and the CLAUDE.md type scale (`text-[17px]`, `text-[14px]`, `text-[13px]`, `text-[12px] uppercase tracking-wider`, `text-[11px]` badges).
- **`aria-live="polite"` on the collapsed summary line only.** Never `assertive`, never on the chip row or the panels.
- **Debounce the derived ledger state 300ms**, never the controlled input value.
- **No dollar figures.** Scheduled *hours* only — `employees.compensation_type` makes `hourly_rate` meaningless for salaried, contractor and daily-rate staff.
- **No acknowledgement checkbox.** The guardrail here is Undo, not friction.
- Do **not** widen `LedgerTone` (`'destructive' | 'warning' | 'success'`). It is imported by the deletion flow.
- `shifts.employee_id` is `NOT NULL` (`20251114100000_create_scheduling_tables.sql:20`), so there is no such thing as an unassigned shift. `DriftRow.employeeName` is still `string | null` because the *join* can fail to resolve a name; the fallback label is therefore **"Unknown employee"**, not "Unassigned". (This corrects the inline comment in the spec at `docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md:276`.)
- Commit after every task. Never commit `progress.md` (gitignored).

## File Structure

**New**

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260804130000_template_hours_cascade.sql` | `cascade_batch_id` column + partial index, `update_shift_template_with_cascade`, `undo_template_hours_cascade` |
| `supabase/tests/template_hours_cascade.test.sql` | pgTAP for both RPCs — the authoritative layer |
| `src/lib/scheduling/templateHoursBuckets.ts` | `bucketTemplateShifts` — pure bucketing + hours delta, owns all client-side timezone reasoning |
| `src/lib/scheduling/hoursChangeCopy.ts` | `buildHoursChangeLedger` — pure copy/severity, reuses `deletionCopy.ts` types |
| `src/hooks/useTemplateLinkedShifts.ts` | One React Query read of the template's linked shifts |
| `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx` | The ledger panel — presentational, no data fetching |
| `tests/unit/templateHoursBuckets.test.ts` | Vitest for the bucketing module |
| `tests/unit/hoursChangeCopy.test.ts` | Vitest for the copy module |
| `tests/e2e/template-hours-cascade.spec.ts` | Playwright happy path |

**Modified**

| File | Change |
|------|--------|
| `src/hooks/useShiftTemplates.tsx` | `updateMutation` → RPC-backed cascade + `undoCascade` mutation + `ToastAction` + notification fan-out |
| `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx` | Ledger panel, two save buttons, sticky footer, `DialogDescription` a11y fix |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | `handleTemplateSubmit` passes the cascade fields; fix the false timezone comment at lines 120–126 |
| `src/integrations/supabase/types.ts` | Regenerated for the two new RPCs and the new column |

---

### Task 1: The cascade RPC (migration + pgTAP)

**Files:**
- Create: `supabase/migrations/20260804130000_template_hours_cascade.sql`
- Create: `supabase/tests/template_hours_cascade.test.sql`

**Interfaces:**
- Consumes: `public.user_has_capability(UUID, TEXT) RETURNS BOOLEAN` (`20260730140000_user_has_capability_from_areas.sql:54`); `public.schedule_change_logs` (`20251123000000_schedule_publishing.sql:23-35`); `public.shifts.shift_template_id` (`20260416000000_add_shift_template_id.sql:4`).
- Produces:
  ```sql
  public.update_shift_template_with_cascade(
    p_template_id UUID, p_restaurant_id UUID, p_name TEXT, p_position TEXT,
    p_area TEXT, p_days INTEGER[], p_break_duration INTEGER, p_capacity INTEGER,
    p_start_time TIME, p_end_time TIME, p_cascade BOOLEAN, p_drifted_shift_ids UUID[]
  ) RETURNS JSONB
  -- { "batch_id": uuid|null, "updated_count": int,
  --   "published_shift_ids": uuid[], "skipped_count": int }
  ```
  plus the column `public.schedule_change_logs.cascade_batch_id UUID`.

- [ ] **Step 1: Start the local database**

```bash
npm run db:start
```

Expected: Supabase reports `Started supabase local development setup` with a `DB URL` on port 54322. If it is already running the command is a no-op.

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/template_hours_cascade.test.sql`:

```sql
-- pgTAP for update_shift_template_with_cascade (Task 1) and
-- undo_template_hours_cascade (Task 2), from
-- supabase/migrations/20260804130000_template_hours_cascade.sql.
--
-- What makes this suite non-vacuous:
--   * The Tokyo block proves drift detection reads the RESTAURANT's wall clock.
--     A shift at 09:00 Asia/Tokyo is 00:00 UTC; bucketing it with a bare
--     `start_time::time` would compare 00:00 against the template's 09:00, call
--     a perfectly-matching shift "drifted", and silently exclude it.
--   * The drifted fixture sits at 11:00-19:00, deliberately NOT equal to the
--     new template times, so "left alone" and "cascaded" are distinguishable.
--   * The cross-tenant block passes a template id from restaurant B together
--     with p_restaurant_id = A. The capability guard PASSES (the caller really
--     does manage A); only the per-statement restaurant_id scoping stops it.
--
-- No hardcoded calendar dates: everything is anchored to the next Monday after
-- CURRENT_DATE, and instants are built as `<local timestamp> AT TIME ZONE
-- '<iana>'` so the fixtures survive every DST transition.
--
-- Auth context: schedule_change_logs.changed_by is NOT NULL REFERENCES
-- auth.users(id), and user_has_capability reads auth.uid(). Both come from
-- request.jwt.claims, which is role-independent, so the suite stays as postgres
-- throughout and never re-enables RLS mid-file.

BEGIN;

SELECT plan(22);

-- ============================================
-- Setup
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants          DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees            DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates      DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants     DISABLE ROW LEVEL SECURITY;

-- Next Monday. ISODOW: Monday = 1 ... Sunday = 7, so 8 - ISODOW is always in
-- [1, 7] and never resolves to today — every "future" fixture stays future.
CREATE TEMP TABLE test_config AS
SELECT (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) AS mon;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('a11ce000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-chi-mgr@example.com',   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a11ce000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-tky-mgr@example.com',   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('a11ce000-0000-0000-0000-0000000ca003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade-chi-staff@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: the timezone is the subject of half this suite, so
-- a retained row from an earlier run with a different zone would silently
-- invalidate every bucketing assertion below.
INSERT INTO restaurants (id, name, timezone) VALUES
  ('c0000000-0000-0000-0000-0000000ca001', 'Cascade Chicago', 'America/Chicago'),
  ('c0000000-0000-0000-0000-0000000ca002', 'Cascade Tokyo',   'Asia/Tokyo')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, position) VALUES
  ('e0000000-0000-0000-0000-0000000ca001', 'c0000000-0000-0000-0000-0000000ca001', 'Casey Chicago', 'Server'),
  ('e0000000-0000-0000-0000-0000000ca002', 'c0000000-0000-0000-0000-0000000ca002', 'Toshi Tokyo',   'Server')
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, name = EXCLUDED.name, position = EXCLUDED.position;

-- role_id stays NULL, so user_has_capability takes its legacy-role CASE branch.
-- 'staff' is absent from the edit:scheduling row list at
-- 20260730140000_user_has_capability_from_areas.sql:146 — that is what makes
-- the insufficient_privilege assertion real rather than a membership check.
-- The Chicago manager is deliberately NOT a member of Tokyo, and vice versa.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('a11ce000-0000-0000-0000-0000000ca001', 'c0000000-0000-0000-0000-0000000ca001', 'owner'),
  ('a11ce000-0000-0000-0000-0000000ca002', 'c0000000-0000-0000-0000-0000000ca002', 'owner'),
  ('a11ce000-0000-0000-0000-0000000ca003', 'c0000000-0000-0000-0000-0000000ca001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = NULL;

-- Five templates, all 09:00-17:00 except the midnight-crossing one. Separate
-- templates per scenario so one call's writes cannot make a later assertion
-- vacuous.
INSERT INTO shift_templates (id, restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active) VALUES
  ('7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001', 'A Baseline',  '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true),
  ('7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001', 'B Drift',     '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true),
  ('7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca002', 'C Tokyo',     '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true),
  ('7d000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-0000000ca001', 'D Overnight', '{1,2,3,4,5}', '22:00', '02:00', 30, 'Server', 1, true),
  ('7e000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-0000000ca001', 'E NoCascade', '{1,2,3,4,5}', '09:00', '17:00', 30, 'Server', 1, true)
ON CONFLICT (id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, days = EXCLUDED.days,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

-- Template A fixtures: one of each bucket, plus a published one for the flag.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  -- A1: future, unlocked, matches 09:00-17:00 -> cascades
  ('11000000-0000-0000-0000-0000000000a1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A2: PAST (two weeks back), matches -> never touched
  ('11000000-0000-0000-0000-0000000000a2'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) - 14)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) - 14)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A3: future, LOCKED, matches -> never touched
  ('11000000-0000-0000-0000-0000000000a3'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', true, false),
  -- A4: future, unlocked, DRIFTED to 11:00-19:00 -> not opted in, untouched
  ('11000000-0000-0000-0000-0000000000a4'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 2)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  -- A5: future, unlocked, matches, PUBLISHED -> cascades and raises the flag
  ('11000000-0000-0000-0000-0000000000a5'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7a000000-0000-0000-0000-00000000000a'::uuid,
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 3)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, true)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template B: one matching, one drifted (the drift opt-in block).
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000b1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7b000000-0000-0000-0000-00000000000b'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false),
  ('11000000-0000-0000-0000-0000000000b2'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7b000000-0000-0000-0000-00000000000b'::uuid,
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '11 hours') AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template C: Tokyo. 09:00 Asia/Tokyo is 00:00 UTC — the whole point.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000c1'::uuid, 'c0000000-0000-0000-0000-0000000ca002'::uuid, 'e0000000-0000-0000-0000-0000000ca002'::uuid, '7c000000-0000-0000-0000-00000000000c'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'Asia/Tokyo',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'Asia/Tokyo', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template D: overnight, 22:00 -> 02:00 the next local day.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000d1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7d000000-0000-0000-0000-00000000000d'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '22 hours')      AT TIME ZONE 'America/Chicago',
   (((SELECT mon FROM test_config) + 1)::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- Template E: the p_cascade = false control.
INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-0000000000e1'::uuid, 'c0000000-0000-0000-0000-0000000ca001'::uuid, 'e0000000-0000-0000-0000-0000000ca001'::uuid, '7e000000-0000-0000-0000-00000000000e'::uuid,
   ((SELECT mon FROM test_config)::timestamp + interval '9 hours')  AT TIME ZONE 'America/Chicago',
   ((SELECT mon FROM test_config)::timestamp + interval '17 hours') AT TIME ZONE 'America/Chicago', 'Server', false, false)
) AS v
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Call A — baseline cascade, 09:00-17:00 -> 10:00-18:00
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

CREATE TEMP TABLE call_a AS
SELECT public.update_shift_template_with_cascade(
  '7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001',
  'A Baseline', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true, '{}'::uuid[]
) AS result;

-- Test 1
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a1'),
  '10:00'::time,
  'matching future unlocked shift moves to the new template start'
);

-- Test 2
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a2'),
  '09:00'::time,
  'past shift is never touched'
);

-- Test 3
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a3'),
  '09:00'::time,
  'locked shift is never touched'
);

-- Test 4
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a4'),
  '11:00'::time,
  'drifted shift not opted into is never touched'
);

-- Test 5
SELECT is(
  (SELECT (end_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000a5'),
  '18:00'::time,
  'published matching shift still moves'
);

-- Test 6
SELECT is(
  (SELECT (result->>'updated_count')::int FROM call_a),
  2,
  'updated_count counts exactly the two matching future unlocked shifts'
);

-- Test 7
SELECT is(
  (SELECT result->'published_shift_ids' FROM call_a),
  '["11000000-0000-0000-0000-0000000000a5"]'::jsonb,
  'published_shift_ids carries exactly the one published shift that moved'
);

-- ============================================
-- Call B — drift opt-in
-- ============================================

CREATE TEMP TABLE call_b AS
SELECT public.update_shift_template_with_cascade(
  '7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001',
  'B Drift', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000b2']::uuid[]
) AS result;

-- Test 8
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b2'),
  '10:00'::time,
  'an opted-in drifted shift is moved onto the new template times'
);

-- Test 9
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b1'),
  '10:00'::time,
  'the matching sibling still moves in the same call'
);

-- Test 10 -- a1 belongs to template A, so it fails the shift_template_id
-- re-validation and is reported as skipped rather than silently retimed.
CREATE TEMP TABLE call_b_skip AS
SELECT public.update_shift_template_with_cascade(
  '7b000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000ca001',
  'B Drift', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000a1']::uuid[]
) AS result;

SELECT is(
  (SELECT (result->>'skipped_count')::int FROM call_b_skip),
  1,
  'an opted-in id belonging to another template is re-validated away and counted as skipped'
);

-- ============================================
-- Call C — restaurant timezone is not the server's
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca002","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca002',
  'C Tokyo', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '10:00'::time, '18:00'::time, true, '{}'::uuid[]
);

-- Test 11
SELECT is(
  (SELECT (start_time AT TIME ZONE 'Asia/Tokyo')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000c1'),
  '10:00'::time,
  'drift detection and the rewrite both use the restaurant wall clock, not UTC'
);

-- ============================================
-- Call D — midnight crossing
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7d000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-0000000ca001',
  'D Overnight', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '23:00'::time, '03:00'::time, true, '{}'::uuid[]
);

-- Test 12
SELECT is(
  (SELECT (end_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000d1'),
  '03:00'::time,
  'overnight shift end lands on 03:00 local'
);

-- Test 13
SELECT is(
  (SELECT (end_time - start_time) FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000d1'),
  interval '4 hours',
  'overnight shift end is pushed to the NEXT local day, preserving the 4h length'
);

-- ============================================
-- Call E — p_cascade = false reproduces today's behaviour
-- ============================================

SELECT public.update_shift_template_with_cascade(
  '7e000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-0000000ca001',
  'E NoCascade', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '14:00'::time, '22:00'::time, false, '{}'::uuid[]
);

-- Test 14
SELECT is(
  (SELECT start_time FROM shift_templates WHERE id = '7e000000-0000-0000-0000-00000000000e'),
  '14:00'::time,
  'p_cascade = false still writes the template row'
);

-- Test 15
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000e1'),
  '09:00'::time,
  'p_cascade = false leaves every linked shift alone'
);

-- ============================================
-- Batch identity
-- ============================================

-- Test 16
SELECT is(
  (SELECT COUNT(DISTINCT cascade_batch_id)::int FROM schedule_change_logs
    WHERE cascade_batch_id = (SELECT (result->>'batch_id')::uuid FROM call_a)),
  1,
  'one cascade call tags every row it wrote with a single batch id'
);

-- Test 17
SELECT isnt(
  (SELECT (result->>'batch_id')::uuid FROM call_a),
  (SELECT (result->>'batch_id')::uuid FROM call_b),
  'two cascade calls get distinct batch ids'
);

-- Test 18
SELECT is(
  (SELECT COUNT(*)::int FROM schedule_change_logs
    WHERE cascade_batch_id = (SELECT (result->>'batch_id')::uuid FROM call_a)),
  2,
  'the batch holds exactly one tagged row per moved shift'
);

-- ============================================
-- The log_shift_change trigger also fires on published shifts
-- ============================================

-- Test 19 -- a5 was published, so the AFTER UPDATE trigger wrote its own
-- untagged row on top of the RPC's tagged one. Two rows total, one tagged.
-- Documented so a reader counting rows does not conclude something broke.
SELECT is(
  (SELECT COUNT(*)::int FROM schedule_change_logs
    WHERE shift_id = '11000000-0000-0000-0000-0000000000a5'
      AND cascade_batch_id IS NULL),
  1,
  'log_shift_change writes one additional UNTAGGED row for the published shift'
);

-- ============================================
-- Authorization
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca003","role":"authenticated"}', true);

-- Test 20
SELECT throws_ok(
  $$ SELECT public.update_shift_template_with_cascade(
       '7a000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000ca001',
       'A Baseline', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
       '06:00'::time, '14:00'::time, true, '{}'::uuid[]) $$,
  '42501',
  NULL,
  'a member without edit:scheduling gets insufficient_privilege'
);

-- Cross-tenant: the Chicago owner names Chicago (so the capability guard
-- PASSES) but passes Tokyo's template and Tokyo's shift. Only the per-statement
-- restaurant_id scoping stops this.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

SELECT public.update_shift_template_with_cascade(
  '7c000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000ca001',
  'Hijacked', 'Server', NULL, '{1,2,3,4,5}'::int[], 30, 1,
  '05:00'::time, '13:00'::time, true,
  ARRAY['11000000-0000-0000-0000-0000000000c1']::uuid[]
);

-- Test 21
SELECT is(
  (SELECT (start_time AT TIME ZONE 'Asia/Tokyo')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000c1'),
  '10:00'::time,
  'a caller authorized at restaurant A cannot retime restaurant B''s shifts'
);

-- Test 22
SELECT ok(
  NOT has_function_privilege('anon',
    'public.update_shift_template_with_cascade(uuid,uuid,text,text,text,integer[],integer,integer,time,time,boolean,uuid[])',
    'EXECUTE'),
  'anon cannot execute the cascade RPC'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL — `template_hours_cascade.test.sql` errors with `function public.update_shift_template_with_cascade(...) does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260804130000_template_hours_cascade.sql`:

```sql
-- Cascading shift-template hour changes to the shifts generated from them.
--
-- Editing a template used to write one row. Shifts linked by
-- shifts.shift_template_id kept their old times forever, and the divergence
-- was invisible until someone showed up an hour early.
--
-- A blind cascade is not the fix either, so this function re-derives four
-- buckets server-side and only moves two of them: shifts whose restaurant-local
-- time-of-day still equals the template's CURRENT stored times, plus the
-- drifted shifts the manager explicitly opted into. Past and locked shifts are
-- never touched.
--
-- See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.

-- ---------------------------------------------------------------------------
-- Batch key for Undo
-- ---------------------------------------------------------------------------
--
-- schedule_change_logs had nothing that groups the rows of one bulk write.
-- changed_at looks like a batch key (NOW() is transaction_timestamp(), so it is
-- identical across a transaction) but is not one: nothing stops another writer
-- from logging in the same transaction, and the table has no shift_template_id
-- to scope a revert by.
--
-- Nullable with no default, so every existing row and every existing writer --
-- including the log_shift_change trigger -- is unaffected.
ALTER TABLE public.schedule_change_logs
  ADD COLUMN IF NOT EXISTS cascade_batch_id UUID;

-- PARTIAL. The column is NULL for nearly every row, so the predicate keeps the
-- index small and keeps the write cost off the common logging path.
--
-- Deliberately not CONCURRENTLY. schedule_change_logs is written on most
-- scheduling actions, so a long SHARE lock would matter -- but the predicate
-- matches zero rows at creation time (brand-new, unbackfilled column), so the
-- build is effectively instantaneous regardless of table size. That keeps both
-- statements in one migration file, which CREATE INDEX CONCURRENTLY forbids.
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_cascade_batch
  ON public.schedule_change_logs (cascade_batch_id)
  WHERE cascade_batch_id IS NOT NULL;

COMMENT ON COLUMN public.schedule_change_logs.cascade_batch_id IS
  'Groups the audit rows written by one update_shift_template_with_cascade '
  'call so undo_template_hours_cascade can revert exactly that batch. NULL for '
  'every other writer, including the log_shift_change trigger.';

-- ---------------------------------------------------------------------------
-- update_shift_template_with_cascade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_shift_template_with_cascade(
  p_template_id       UUID,
  p_restaurant_id     UUID,
  p_name              TEXT,
  p_position          TEXT,
  p_area              TEXT,
  p_days              INTEGER[],
  p_break_duration    INTEGER,
  p_capacity          INTEGER,
  p_start_time        TIME,
  p_end_time          TIME,
  p_cascade           BOOLEAN,
  p_drifted_shift_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz            TEXT;
  v_old_start     TIME;
  v_old_end       TIME;
  v_batch_id      UUID := gen_random_uuid();
  v_updated_count INTEGER := 0;
  v_published_ids UUID[] := '{}';
  v_skipped_count INTEGER := 0;
  v_drift_ids     UUID[] := COALESCE(p_drifted_shift_ids, '{}'::UUID[]);
BEGIN
  -- The capability check, not a hardcoded role array: this is exactly what the
  -- shifts UPDATE policy and the schedule_change_logs INSERT policy require
  -- (20260730150000_rewrite_collaborator_policies.sql). Hardcoding
  -- ('owner','manager') would silently strip access from operations_manager and
  -- the collaborator roles.
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to edit scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The guard above proves only that the caller may edit scheduling AT THE
  -- RESTAURANT THEY NAMED. It says nothing about whether p_template_id or the
  -- ids in p_drifted_shift_ids belong to that restaurant, and this function
  -- bypasses RLS. Every statement below therefore also filters on
  -- restaurant_id = p_restaurant_id. Starting here: a template id from another
  -- tenant finds no row and the call becomes a no-op.
  SELECT t.start_time, t.end_time
    INTO v_old_start, v_old_end
  FROM public.shift_templates t
  WHERE t.id = p_template_id
    AND t.restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'batch_id', NULL, 'updated_count', 0,
      'published_shift_ids', to_jsonb('{}'::UUID[]), 'skipped_count', 0
    );
  END IF;

  SELECT r.timezone INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- 'America/Chicago', NOT the 'UTC' the six sibling scheduling functions use.
  -- restaurants.timezone is nullable, and the client's safeTz falls back to
  -- America/Chicago (src/lib/restaurantClock.ts:13,77). Falling back to UTC
  -- here would put the dialog's preview and this function's re-derived buckets
  -- in different hours for a null-timezone restaurant, manufacturing exactly
  -- the drift false-positives this feature exists to avoid. Retiming the other
  -- six to match is a follow-up with its own blast radius.
  v_tz := COALESCE(NULLIF(v_tz, ''), 'America/Chicago');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'America/Chicago';
  END;

  UPDATE public.shift_templates t
  SET name           = p_name,
      position       = p_position,
      area           = p_area,
      days           = p_days,
      break_duration = p_break_duration,
      capacity       = p_capacity,
      start_time     = p_start_time,
      end_time       = p_end_time,
      updated_at     = now()
  WHERE t.id = p_template_id
    AND t.restaurant_id = p_restaurant_id;

  IF p_cascade THEN
    -- Opted-in ids are re-validated, never trusted. Counted BEFORE the UPDATE
    -- so the predicate sees the same rows the cascade will.
    SELECT count(*)::int INTO v_skipped_count
    FROM unnest(v_drift_ids) AS req(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = req.id
        AND s.restaurant_id     = p_restaurant_id
        AND s.shift_template_id = p_template_id
        AND s.start_time > now()
        AND s.locked = false
    );

    -- One statement: all row locks acquired in one go (lock-deadlock-prevention)
    -- and the transaction stays in milliseconds (lock-short-transactions).
    --
    -- `target` reads the pre-UPDATE snapshot, so its to_jsonb(s.*) is the OLD
    -- row -- that is before_data. The new instants are RECONSTRUCTED from each
    -- shift's own restaurant-local date rather than offset by an interval:
    -- interval arithmetic preserves elapsed duration across a DST boundary,
    -- which is the opposite of what a manager typing "10:00" means.
    WITH target AS (
      SELECT
        s.id,
        s.employee_id,
        to_jsonb(s.*) AS before_data,
        (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_start_time)::timestamp
          AT TIME ZONE v_tz) AS new_start,
        CASE
          WHEN p_end_time <= p_start_time THEN
            ((((s.start_time AT TIME ZONE v_tz)::date + 1) || ' ' || p_end_time)::timestamp
              AT TIME ZONE v_tz)
          ELSE
            (((s.start_time AT TIME ZONE v_tz)::date || ' ' || p_end_time)::timestamp
              AT TIME ZONE v_tz)
        END AS new_end
      FROM public.shifts s
      WHERE s.restaurant_id     = p_restaurant_id
        AND s.shift_template_id = p_template_id
        AND s.start_time > now()          -- Past: payroll has seen these
        AND s.locked = false              -- Locked: the flag means hands off
        AND (
          -- Moves with template: local time-of-day still equals the OLD times
          (    (s.start_time AT TIME ZONE v_tz)::time = v_old_start
           AND (s.end_time   AT TIME ZONE v_tz)::time = v_old_end)
          -- Your call: only the ids the manager explicitly opted into
          OR s.id = ANY(v_drift_ids)
        )
    ),
    updated AS (
      UPDATE public.shifts s
      SET start_time = t.new_start,
          end_time   = t.new_end,
          updated_at = now()
      FROM target t
      WHERE s.id = t.id
        AND s.restaurant_id = p_restaurant_id
      RETURNING s.id, s.employee_id, s.is_published,
                t.before_data, to_jsonb(s.*) AS after_data
    ),
    logged AS (
      -- A data-modifying CTE runs exactly once and to completion whether or not
      -- the primary query reads it, so this INSERT is not dead.
      INSERT INTO public.schedule_change_logs (
        restaurant_id, shift_id, employee_id, change_type, changed_by,
        before_data, after_data, reason, cascade_batch_id
      )
      SELECT p_restaurant_id, u.id, u.employee_id, 'updated', auth.uid(),
             u.before_data, u.after_data, 'Template hours cascade', v_batch_id
      FROM updated u
      RETURNING 1
    )
    -- Counts from RETURNING, not GET DIAGNOSTICS: once the UPDATE feeds a CTE,
    -- GET DIAGNOSTICS reports the ENCLOSING statement's row count.
    SELECT count(*)::int,
           COALESCE(array_agg(id) FILTER (WHERE is_published), '{}')
      INTO v_updated_count, v_published_ids
    FROM updated;
  END IF;

  RETURN jsonb_build_object(
    -- NULL when nothing moved, so the client knows not to offer Undo.
    'batch_id',            CASE WHEN v_updated_count > 0 THEN v_batch_id ELSE NULL END,
    'updated_count',       v_updated_count,
    'published_shift_ids', to_jsonb(v_published_ids),
    'skipped_count',       v_skipped_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.update_shift_template_with_cascade(UUID, UUID, TEXT, TEXT, TEXT, INTEGER[], INTEGER, INTEGER, TIME, TIME, BOOLEAN, UUID[]) IS
  'Updates a shift template and, when p_cascade, retimes the future unlocked '
  'shifts whose restaurant-local hours still match the template''s previous '
  'hours, plus any drifted shifts named in p_drifted_shift_ids (re-validated '
  'server-side). Past and locked shifts are never touched. Tags its audit rows '
  'with a cascade_batch_id so undo_template_hours_cascade can revert the batch.';
```

- [ ] **Step 5: Apply the migration and run the test**

```bash
npm run db:reset && npm run test:db
```

Expected: PASS — `template_hours_cascade.test.sql` reports 22/22 (`# Looks like you planned 22 tests` is absent; the runner prints all-green).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260804130000_template_hours_cascade.sql supabase/tests/template_hours_cascade.test.sql
git commit -m "feat(scheduling): cascade template hour changes to linked shifts via RPC"
```

---

### Task 2: The undo RPC

**Files:**
- Modify: `supabase/migrations/20260804130000_template_hours_cascade.sql` (append)
- Modify: `supabase/tests/template_hours_cascade.test.sql` (bump `plan(22)` → `plan(27)`, append a section before `SELECT * FROM finish();`)

**Interfaces:**
- Consumes: `cascade_batch_id`, and the `before_data` / `after_data` JSONB the cascade wrote (Task 1).
- Produces:
  ```sql
  public.undo_template_hours_cascade(p_batch_id UUID, p_restaurant_id UUID) RETURNS JSONB
  -- { "restored_count": int, "changed_since_count": int, "deleted_count": int }
  ```

- [ ] **Step 1: Write the failing pgTAP section**

In `supabase/tests/template_hours_cascade.test.sql`, change `SELECT plan(22);` to `SELECT plan(27);` and insert this block immediately before `SELECT * FROM finish();`:

```sql
-- ============================================
-- Undo
-- ============================================

SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca001","role":"authenticated"}', true);

-- b1 and b2 were both moved to 10:00 by call B. Mutate b1 afterwards so undo
-- has one row it must refuse to restore and one it must restore.
UPDATE shifts
SET start_time = (((SELECT mon FROM test_config))::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago',
    end_time   = (((SELECT mon FROM test_config))::timestamp + interval '23 hours') AT TIME ZONE 'America/Chicago'
WHERE id = '11000000-0000-0000-0000-0000000000b1';

CREATE TEMP TABLE undo_b AS
SELECT public.undo_template_hours_cascade(
  (SELECT (result->>'batch_id')::uuid FROM call_b),
  'c0000000-0000-0000-0000-0000000ca001'
) AS result;

-- Test 23
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b2'),
  '11:00'::time,
  'undo restores the opted-in drifted shift to its pre-cascade time'
);

-- Test 24
SELECT is(
  (SELECT (start_time AT TIME ZONE 'America/Chicago')::time FROM shifts WHERE id = '11000000-0000-0000-0000-0000000000b1'),
  '15:00'::time,
  'undo refuses to overwrite a shift edited after the cascade'
);

-- Test 25
SELECT is(
  (SELECT (result->>'changed_since_count')::int FROM undo_b),
  1,
  'undo reports the changed-since skip rather than lumping it into restored'
);

-- Test 26 -- a NULL batch id must revert NOTHING. With `IS NOT DISTINCT FROM`
-- alone, NULL would match every untagged row in the table and unwind the entire
-- audit log, so the guard is load-bearing, not defensive.
SELECT is(
  (SELECT (result->>'restored_count')::int FROM (
    SELECT public.undo_template_hours_cascade(NULL, 'c0000000-0000-0000-0000-0000000ca001') AS result
  ) q),
  0,
  'a NULL batch id reverts nothing'
);

-- Test 27 -- cross-tenant: the Tokyo owner names Tokyo (capability guard
-- PASSES) but hands over Chicago's batch id.
SELECT set_config('request.jwt.claims',
  '{"sub":"a11ce000-0000-0000-0000-0000000ca002","role":"authenticated"}', true);

SELECT is(
  (SELECT (result->>'restored_count')::int FROM (
    SELECT public.undo_template_hours_cascade(
      (SELECT (result->>'batch_id')::uuid FROM call_a),
      'c0000000-0000-0000-0000-0000000ca002'
    ) AS result
  ) q),
  0,
  'a batch id from another restaurant reverts nothing'
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.undo_template_hours_cascade(uuid, uuid) does not exist`.

- [ ] **Step 3: Append the function to the migration**

Append to `supabase/migrations/20260804130000_template_hours_cascade.sql`:

```sql
-- ---------------------------------------------------------------------------
-- undo_template_hours_cascade
-- ---------------------------------------------------------------------------
--
-- The cascade is reversible, which is why the dialog needs no acknowledgement
-- checkbox. Two skip conditions are reported separately rather than lumped
-- together, because they mean different things to the manager reading the toast.
CREATE OR REPLACE FUNCTION public.undo_template_hours_cascade(
  p_batch_id      UUID,
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_restored_count      INTEGER := 0;
  v_changed_since_count INTEGER := 0;
  v_deleted_count       INTEGER := 0;
BEGIN
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized to edit scheduling for restaurant %', p_restaurant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- LOAD-BEARING. Every predicate below scopes with
  -- `cascade_batch_id IS NOT DISTINCT FROM p_batch_id` so that untagged rows --
  -- including the ones log_shift_change writes -- are invisible to the revert.
  -- With a NULL p_batch_id that same predicate would match every untagged row
  -- in the table and unwind the entire audit log.
  IF p_batch_id IS NULL THEN
    RETURN jsonb_build_object(
      'restored_count', 0, 'changed_since_count', 0, 'deleted_count', 0
    );
  END IF;

  -- Deleted since. schedule_change_logs.shift_id is NOT a foreign key --
  -- 20260617120000_fix_schedule_change_logs_delete_fk.sql:38-44 dropped the
  -- constraint precisely so a 'deleted' audit row keeps the id of a shift that
  -- no longer exists. So `shift_id IS NULL` never fires and NOT EXISTS is the
  -- only correct probe.
  SELECT count(*)::int INTO v_deleted_count
  FROM public.schedule_change_logs l
  WHERE l.cascade_batch_id IS NOT DISTINCT FROM p_batch_id
    AND l.restaurant_id = p_restaurant_id
    AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = l.shift_id);

  -- Changed since: the row still exists but its times no longer match what the
  -- cascade wrote, so someone edited it in between. Blindly restoring would
  -- destroy a newer, deliberate edit.
  SELECT count(*)::int INTO v_changed_since_count
  FROM public.schedule_change_logs l
  JOIN public.shifts s
    ON s.id = l.shift_id
   AND s.restaurant_id = p_restaurant_id
  WHERE l.cascade_batch_id IS NOT DISTINCT FROM p_batch_id
    AND l.restaurant_id = p_restaurant_id
    AND (   s.start_time IS DISTINCT FROM (l.after_data->>'start_time')::timestamptz
         OR s.end_time   IS DISTINCT FROM (l.after_data->>'end_time')::timestamptz);

  WITH reverted AS (
    UPDATE public.shifts s
    SET start_time = (l.before_data->>'start_time')::timestamptz,
        end_time   = (l.before_data->>'end_time')::timestamptz,
        updated_at = now()
    FROM public.schedule_change_logs l
    WHERE l.cascade_batch_id IS NOT DISTINCT FROM p_batch_id
      AND l.restaurant_id = p_restaurant_id
      AND s.id = l.shift_id
      AND s.restaurant_id = p_restaurant_id
      AND s.start_time IS NOT DISTINCT FROM (l.after_data->>'start_time')::timestamptz
      AND s.end_time   IS NOT DISTINCT FROM (l.after_data->>'end_time')::timestamptz
    RETURNING s.id, s.employee_id,
              l.after_data  AS undone_after,
              l.before_data AS undone_before
  ),
  logged AS (
    -- cascade_batch_id stays NULL on the undo's own rows. Tagging them with
    -- p_batch_id would make a second Undo click try to revert the revert.
    -- As written, a second click finds the original rows, sees current != 
    -- after_data, and reports them as changed-since -- safe, and honest.
    INSERT INTO public.schedule_change_logs (
      restaurant_id, shift_id, employee_id, change_type, changed_by,
      before_data, after_data, reason, cascade_batch_id
    )
    SELECT p_restaurant_id, r.id, r.employee_id, 'updated', auth.uid(),
           r.undone_after, r.undone_before, 'Undo template hours cascade', NULL
    FROM reverted r
    RETURNING 1
  )
  SELECT count(*)::int INTO v_restored_count FROM reverted;

  RETURN jsonb_build_object(
    'restored_count',      v_restored_count,
    'changed_since_count', v_changed_since_count,
    'deleted_count',       v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.undo_template_hours_cascade(UUID, UUID) IS
  'Reverts the shifts moved by one update_shift_template_with_cascade call, '
  'identified by cascade_batch_id, restoring each from its logged before_data. '
  'Skips shifts edited or deleted since the cascade and reports those counts '
  'separately.';
```

- [ ] **Step 4: Apply and run**

```bash
npm run db:reset && npm run test:db
```

Expected: PASS — 27/27.

- [ ] **Step 5: Regenerate Supabase types**

```bash
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

Expected: the diff adds `cascade_batch_id` to `schedule_change_logs` and both new functions under `Functions`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260804130000_template_hours_cascade.sql supabase/tests/template_hours_cascade.test.sql src/integrations/supabase/types.ts
git commit -m "feat(scheduling): add undo_template_hours_cascade RPC"
```

---

### Task 3: `bucketTemplateShifts` — the pure bucketing module

**Files:**
- Create: `src/lib/scheduling/templateHoursBuckets.ts`
- Test: `tests/unit/templateHoursBuckets.test.ts`

**Interfaces:**
- Consumes: `formatLocalDateInTz`, `formatLocalHHMMInTz` from `src/lib/shiftInterval.ts` (lines 180–240).
- Produces: `LinkedShift`, `DriftRow`, `TemplateHoursBuckets`, `bucketTemplateShifts`, `durationMinutes`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/templateHoursBuckets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  bucketTemplateShifts,
  durationMinutes,
  type LinkedShift,
} from '@/lib/scheduling/templateHoursBuckets';

const TZ = 'America/Chicago';
const NOW = new Date('2026-03-02T12:00:00Z');

function shift(overrides: Partial<LinkedShift> & { id: string }): LinkedShift {
  return {
    start_time: '2026-03-10T15:00:00Z', // 09:00 America/Chicago (CDT, UTC-5)
    end_time: '2026-03-10T23:00:00Z',   // 17:00 America/Chicago
    is_published: false,
    locked: false,
    employee_id: 'emp-1',
    employeeName: 'Casey',
    ...overrides,
  };
}

const BASE = {
  oldStart: '09:00',
  oldEnd: '17:00',
  newStart: '10:00',
  newEnd: '18:00',
  tz: TZ,
  now: NOW,
};

describe('durationMinutes', () => {
  it('measures a same-day range', () => {
    expect(durationMinutes('09:00', '17:00')).toBe(480);
  });

  it('wraps a midnight-crossing range to the next day', () => {
    expect(durationMinutes('22:00', '02:00')).toBe(240);
  });

  it('treats an equal start and end as a full 24 hours', () => {
    expect(durationMinutes('09:00', '09:00')).toBe(1440);
  });
});

describe('bucketTemplateShifts', () => {
  it('returns empty buckets for no shifts', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [] });
    expect(result.moving).toEqual([]);
    expect(result.drifted).toEqual([]);
    expect(result.past).toEqual([]);
    expect(result.locked).toEqual([]);
    expect(result.publishedMovingIds).toEqual([]);
    expect(result.movingHoursDelta).toBe(0);
  });

  it('buckets a matching future unlocked shift as moving', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1' })] });
    expect(result.moving).toEqual(['s1']);
  });

  it('buckets a past shift as past even when it matches', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-02-10T15:00:00Z', end_time: '2026-02-10T23:00:00Z' })],
    });
    expect(result.past).toEqual(['s1']);
    expect(result.moving).toEqual([]);
  });

  it('reports a locked PAST shift as past, not locked', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({
        id: 's1',
        locked: true,
        start_time: '2026-02-10T15:00:00Z',
        end_time: '2026-02-10T23:00:00Z',
      })],
    });
    expect(result.past).toEqual(['s1']);
    expect(result.locked).toEqual([]);
  });

  it('buckets a locked future shift as locked', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1', locked: true })] });
    expect(result.locked).toEqual(['s1']);
    expect(result.moving).toEqual([]);
  });

  it('buckets a hand-edited future shift as drifted', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-03-10T16:00:00Z', end_time: '2026-03-11T00:00:00Z' })],
    });
    expect(result.moving).toEqual([]);
    expect(result.drifted).toHaveLength(1);
  });

  it('gives every drift row a shiftId and a restaurant-local date and times', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-03-10T16:00:00Z', end_time: '2026-03-11T00:00:00Z' })],
    });
    expect(result.drifted[0]).toEqual({
      shiftId: 's1',
      employeeName: 'Casey',
      localDate: '2026-03-10',
      currentStart: '11:00',
      currentEnd: '19:00',
      hoursDelta: 0, // 11:00-19:00 (8h) -> 10:00-18:00 (8h)
    });
  });

  it('flags published shifts that are actually moving', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', is_published: true }), shift({ id: 's2' })],
    });
    expect(result.publishedMovingIds).toEqual(['s1']);
  });

  it('does not flag a published shift that is locked', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', is_published: true, locked: true })],
    });
    expect(result.publishedMovingIds).toEqual([]);
  });

  it('compares in the restaurant timezone, not UTC', () => {
    // 00:00Z on 2026-03-11 is 09:00 Asia/Tokyo — a perfect match for the
    // template. Comparing the raw UTC time-of-day would call it drifted.
    const result = bucketTemplateShifts({
      ...BASE,
      tz: 'Asia/Tokyo',
      shifts: [shift({ id: 's1', start_time: '2026-03-11T00:00:00Z', end_time: '2026-03-11T08:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
    expect(result.drifted).toEqual([]);
  });

  it('still matches a shift whose local date crosses a spring-forward boundary', () => {
    // 2026-03-08 is the US spring-forward date. 09:00 local that day is 15:00Z
    // (CDT already in effect at 09:00), and the shift must still read as 09:00.
    const result = bucketTemplateShifts({
      ...BASE,
      now: new Date('2026-03-01T12:00:00Z'),
      shifts: [shift({ id: 's1', start_time: '2026-03-08T15:00:00Z', end_time: '2026-03-08T23:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
  });

  it('matches a midnight-crossing shift against a midnight-crossing template', () => {
    const result = bucketTemplateShifts({
      oldStart: '22:00',
      oldEnd: '02:00',
      newStart: '23:00',
      newEnd: '03:00',
      tz: TZ,
      now: NOW,
      shifts: [shift({ id: 's1', start_time: '2026-03-11T03:00:00Z', end_time: '2026-03-11T07:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
  });

  it('computes the signed scheduled-hours delta across the moving set', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      newStart: '10:00',
      newEnd: '19:00', // 9h vs the old 8h
      shifts: [shift({ id: 's1' }), shift({ id: 's2' })],
    });
    expect(result.movingHoursDelta).toBe(2);
  });

  it('reports a zero delta for a shift that moves later without changing length', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1' })] });
    expect(result.movingHoursDelta).toBe(0);
  });

  it('falls back to a null employee name when the join did not resolve', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({
        id: 's1',
        employeeName: null,
        start_time: '2026-03-10T16:00:00Z',
        end_time: '2026-03-11T00:00:00Z',
      })],
    });
    expect(result.drifted[0].employeeName).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/templateHoursBuckets.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/scheduling/templateHoursBuckets"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scheduling/templateHoursBuckets.ts`:

```ts
/**
 * Pure bucketing for the template-hours cascade. No React, no supabase.
 *
 * This module owns every piece of client-side timezone reasoning in the
 * feature: it is the only place that turns a shift's `timestamptz` into a
 * restaurant-local wall clock, so no component downstream has to think about
 * zones. The server re-derives the same buckets independently — see
 * `update_shift_template_with_cascade` — and this preview must agree with it.
 *
 * See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.
 */

import { formatLocalDateInTz, formatLocalHHMMInTz } from '@/lib/shiftInterval';

export interface LinkedShift {
  id: string;
  /** ISO timestamptz, as returned by supabase. */
  start_time: string;
  end_time: string;
  is_published: boolean;
  locked: boolean;
  employee_id: string;
  /**
   * `shifts.employee_id` is NOT NULL, so there is no such thing as an
   * unassigned shift — this is null only when the employees join failed to
   * resolve a name. The UI labels that case "Unknown employee".
   */
  employeeName: string | null;
}

export interface DriftRow {
  shiftId: string;
  employeeName: string | null;
  /** Restaurant-local YYYY-MM-DD. */
  localDate: string;
  /** Restaurant-local HH:MM. */
  currentStart: string;
  currentEnd: string;
  /** Signed hours this shift gains if the manager opts it in. */
  hoursDelta: number;
}

export interface TemplateHoursBuckets {
  /** Shift ids, in the order they were supplied. */
  past: string[];
  locked: string[];
  moving: string[];
  drifted: DriftRow[];
  /** Ids of published shifts that are actually moving — drives severity. */
  publishedMovingIds: string[];
  /** Signed hours added across `moving`, if no drift row is opted in. */
  movingHoursDelta: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

/**
 * Minutes from `start` to `end` on a wall clock, wrapping past midnight.
 * An equal start and end is a full day, not zero — that is what a 24-hour
 * template means, and it is the same convention the RPC's
 * `p_end_time <= p_start_time` branch encodes.
 */
export function durationMinutes(start: string, end: string): number {
  const delta = toMinutes(end) - toMinutes(start);
  return delta > 0 ? delta : delta + 1440;
}

export function bucketTemplateShifts(input: {
  shifts: LinkedShift[];
  /** Template's currently-stored hours, HH:MM. */
  oldStart: string;
  oldEnd: string;
  /** What the manager has typed, HH:MM. */
  newStart: string;
  newEnd: string;
  tz: string;
  now: Date;
}): TemplateHoursBuckets {
  const { shifts, oldStart, oldEnd, newStart, newEnd, tz, now } = input;

  const past: string[] = [];
  const locked: string[] = [];
  const moving: string[] = [];
  const drifted: DriftRow[] = [];
  const publishedMovingIds: string[] = [];

  const newDuration = durationMinutes(newStart, newEnd);
  const perShiftDelta = (newDuration - durationMinutes(oldStart, oldEnd)) / 60;
  const nowMs = now.getTime();

  for (const s of shifts) {
    // Precedence: Past before Locked. A locked past shift reports as past,
    // because that is the more informative reason to a manager reading the
    // ledger.
    if (new Date(s.start_time).getTime() < nowMs) {
      past.push(s.id);
      continue;
    }
    if (s.locked) {
      locked.push(s.id);
      continue;
    }

    const currentStart = formatLocalHHMMInTz(s.start_time, tz);
    const currentEnd = formatLocalHHMMInTz(s.end_time, tz);

    if (currentStart === oldStart && currentEnd === oldEnd) {
      moving.push(s.id);
      if (s.is_published) publishedMovingIds.push(s.id);
      continue;
    }

    drifted.push({
      shiftId: s.id,
      employeeName: s.employeeName,
      localDate: formatLocalDateInTz(new Date(s.start_time), tz),
      currentStart,
      currentEnd,
      hoursDelta: (newDuration - durationMinutes(currentStart, currentEnd)) / 60,
    });
  }

  return {
    past,
    locked,
    moving,
    drifted,
    publishedMovingIds,
    movingHoursDelta: perShiftDelta * moving.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/templateHoursBuckets.test.ts
```

Expected: PASS — 17 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/templateHoursBuckets.ts tests/unit/templateHoursBuckets.test.ts
git commit -m "feat(scheduling): add pure template-hours bucketing"
```

---

### Task 4: `buildHoursChangeLedger` — the pure copy module

**Files:**
- Create: `src/lib/scheduling/hoursChangeCopy.ts`
- Test: `tests/unit/hoursChangeCopy.test.ts`

**Interfaces:**
- Consumes: `Severity`, `LedgerChip`, `LedgerLine`, `pluralize` from `src/lib/scheduling/deletionCopy.ts` (lines 12, 22, 28, 68); `durationMinutes` from Task 3.
- Produces: `HoursChangeInput`, `HoursChangeLedger`, `deriveHoursChangeSeverity`, `formatHoursDelta`, `buildDeltaBadge`, `buildHoursChangeLedger`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hoursChangeCopy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  buildDeltaBadge,
  buildHoursChangeLedger,
  deriveHoursChangeSeverity,
  formatHoursDelta,
  type HoursChangeInput,
} from '@/lib/scheduling/hoursChangeCopy';

const BASE: HoursChangeInput = {
  oldStart: '09:00',
  oldEnd: '17:00',
  newStart: '10:00',
  newEnd: '18:00',
  movingCount: 3,
  publishedCount: 0,
  pastCount: 0,
  lockedCount: 0,
  driftedCount: 0,
  selectedDriftCount: 0,
  hoursDelta: 0,
};

describe('deriveHoursChangeSeverity', () => {
  it('is low when nothing posted is affected', () => {
    expect(deriveHoursChangeSeverity(0)).toBe('low');
  });

  it('is high as soon as one posted shift moves', () => {
    expect(deriveHoursChangeSeverity(1)).toBe('high');
  });
});

describe('buildDeltaBadge', () => {
  it('reports a later start that keeps the same length', () => {
    expect(buildDeltaBadge('09:00', '17:00', '10:00', '18:00')).toBe('1h later · same length');
  });

  it('reports an earlier start', () => {
    expect(buildDeltaBadge('09:00', '17:00', '08:30', '16:30')).toBe('30m earlier · same length');
  });

  it('reports a longer shift with an unchanged start', () => {
    expect(buildDeltaBadge('09:00', '17:00', '09:00', '18:30')).toBe('1h 30m longer');
  });

  it('reports both a move and a length change', () => {
    expect(buildDeltaBadge('09:00', '17:00', '10:00', '17:00')).toBe('1h later · 1h shorter');
  });

  it('reports no change when the times are identical', () => {
    expect(buildDeltaBadge('09:00', '17:00', '09:00', '17:00')).toBe('no change');
  });
});

describe('formatHoursDelta', () => {
  it('signs a gain', () => {
    expect(formatHoursDelta(6.5)).toBe('+6.5 scheduled hours');
  });

  it('signs a loss', () => {
    expect(formatHoursDelta(-2)).toBe('-2 scheduled hours');
  });

  it('names the zero case rather than printing "+0"', () => {
    expect(formatHoursDelta(0)).toBe('No change in scheduled hours');
  });
});

describe('buildHoursChangeLedger', () => {
  it('summarises the affected count for the live region', () => {
    const ledger = buildHoursChangeLedger(BASE);
    expect(ledger.totalAffected).toBe(3);
    expect(ledger.summary).toBe('Low impact. 1h later · same length. 3 shifts move.');
  });

  it('counts opted-in drift rows as affected', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, driftedCount: 2, selectedDriftCount: 1 });
    expect(ledger.totalAffected).toBe(4);
  });

  it('flips to high severity and says so in the summary when posted shifts move', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, publishedCount: 2 });
    expect(ledger.severity).toBe('high');
    expect(ledger.summary).toBe('High impact. 1h later · same length. 3 shifts move, 2 already posted.');
  });

  it('emits a destructive chip only for posted shifts', () => {
    const low = buildHoursChangeLedger(BASE);
    expect(low.chips.some((c) => c.tone === 'destructive')).toBe(false);

    const high = buildHoursChangeLedger({ ...BASE, publishedCount: 2 });
    expect(high.chips.find((c) => c.tone === 'destructive')).toEqual({
      key: 'published',
      label: '2 already posted',
      tone: 'destructive',
    });
  });

  it('always shows the moving chip, even at zero', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, movingCount: 0 });
    expect(ledger.chips.find((c) => c.key === 'moving')).toEqual({
      key: 'moving',
      label: '0 shifts move',
      tone: 'warning',
    });
  });

  it('lists the untouched buckets with their reasons', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, pastCount: 4, lockedCount: 1, driftedCount: 2 });
    expect(ledger.untouched.map((l) => l.text)).toEqual([
      '4 past shifts stay as scheduled — payroll has seen them',
      '1 locked shift stays as scheduled',
      '2 hand-edited shifts stay as scheduled unless you pick them',
    ]);
  });

  it('drops the drift line once every drifted shift is opted in', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, driftedCount: 2, selectedDriftCount: 2 });
    expect(ledger.untouched.some((l) => l.key === 'drifted')).toBe(false);
  });

  it('states the hours delta as a change line', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, hoursDelta: 6.5 });
    expect(ledger.changes.map((l) => l.text)).toContain('+6.5 scheduled hours');
  });

  it('uses singular copy for a single moving shift', () => {
    const ledger = buildHoursChangeLedger({ ...BASE, movingCount: 1 });
    expect(ledger.summary).toBe('Low impact. 1h later · same length. 1 shift moves.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/hoursChangeCopy.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/scheduling/hoursChangeCopy"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scheduling/hoursChangeCopy.ts`:

```ts
/**
 * Pure copy/severity builders for the template-hours cascade ledger, the
 * sibling of deletionCopy.ts. Reuses that module's Severity/LedgerChip/
 * LedgerLine types rather than duplicating them, so edit and delete render
 * identically.
 *
 * Deliberately does NOT produce the drift rows: LedgerLine is `{ key, text }`,
 * with nowhere to hang the shiftId the checkbox selection and the RPC argument
 * both need. Those come straight off `bucketTemplateShifts`' DriftRow[].
 *
 * See docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.
 */

import { durationMinutes } from '@/lib/scheduling/templateHoursBuckets';
import { pluralize, type LedgerChip, type LedgerLine, type Severity } from '@/lib/scheduling/deletionCopy';

export interface HoursChangeInput {
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  movingCount: number;
  /** Published shifts among the moving set. */
  publishedCount: number;
  pastCount: number;
  lockedCount: number;
  driftedCount: number;
  selectedDriftCount: number;
  /** Signed scheduled-hours change, moving set plus opted-in drift. */
  hoursDelta: number;
}

export interface HoursChangeLedger {
  severity: Severity;
  chips: LedgerChip[];
  changes: LedgerLine[];
  untouched: LedgerLine[];
  /** The one sentence the aria-live region announces. */
  summary: string;
  /** Neutral fact, NOT a LedgerChip — see the spec on why tone would mislead. */
  deltaBadge: string;
  totalAffected: number;
}

/**
 * Keys on posted shifts, not on raw count — same reasoning as
 * deriveTemplateSeverity keying on pending claims. A posted shift is a promise
 * made to a person; forty unposted shifts are less consequential than one
 * posted one.
 */
export function deriveHoursChangeSeverity(publishedCount: number): Severity {
  return publishedCount > 0 ? 'high' : 'low';
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function buildDeltaBadge(
  oldStart: string,
  oldEnd: string,
  newStart: string,
  newEnd: string
): string {
  const startShift = toMinutes(newStart) - toMinutes(oldStart);
  const lengthDelta = durationMinutes(newStart, newEnd) - durationMinutes(oldStart, oldEnd);

  const parts: string[] = [];
  if (startShift !== 0) {
    parts.push(`${formatMinutes(Math.abs(startShift))} ${startShift > 0 ? 'later' : 'earlier'}`);
  }
  if (lengthDelta !== 0) {
    parts.push(`${formatMinutes(Math.abs(lengthDelta))} ${lengthDelta > 0 ? 'longer' : 'shorter'}`);
  } else if (parts.length > 0) {
    parts.push('same length');
  }

  return parts.length > 0 ? parts.join(' · ') : 'no change';
}

export function formatHoursDelta(hours: number): string {
  if (hours === 0) return 'No change in scheduled hours';
  const sign = hours > 0 ? '+' : '-';
  return `${sign}${Math.abs(hours)} scheduled hours`;
}

export function buildHoursChangeLedger(input: HoursChangeInput): HoursChangeLedger {
  const {
    oldStart, oldEnd, newStart, newEnd,
    movingCount, publishedCount, pastCount, lockedCount,
    driftedCount, selectedDriftCount, hoursDelta,
  } = input;

  const severity = deriveHoursChangeSeverity(publishedCount);
  const deltaBadge = buildDeltaBadge(oldStart, oldEnd, newStart, newEnd);
  const totalAffected = movingCount + selectedDriftCount;

  const chips: LedgerChip[] = [];
  if (publishedCount > 0) {
    chips.push({
      key: 'published',
      label: `${publishedCount} already posted`,
      tone: 'destructive',
    });
  }
  // Always shown, even at zero, so the manager reads "0 shifts move" as
  // confirmation of no impact rather than as a missing chip.
  chips.push({
    key: 'moving',
    label: `${movingCount} ${pluralize(movingCount, 'shift moves', 'shifts move')}`,
    tone: 'warning',
  });
  const untouchedCount = pastCount + lockedCount + (driftedCount - selectedDriftCount);
  chips.push({
    key: 'untouched',
    label: `${untouchedCount} untouched`,
    tone: 'success',
  });

  const changes: LedgerLine[] = [];
  if (movingCount > 0) {
    changes.push({
      key: 'moving',
      text: `${movingCount} ${pluralize(movingCount, 'shift moves', 'shifts move')} to ${newStart}–${newEnd}`,
    });
  }
  if (selectedDriftCount > 0) {
    changes.push({
      key: 'selectedDrift',
      text: `${selectedDriftCount} hand-edited ${pluralize(selectedDriftCount, 'shift you picked moves', 'shifts you picked move')} too`,
    });
  }
  if (publishedCount > 0) {
    changes.push({
      key: 'published',
      text: `${publishedCount} of these ${pluralize(publishedCount, 'shift has', 'shifts have')} already been posted to staff`,
    });
  }
  changes.push({ key: 'hours', text: formatHoursDelta(hoursDelta) });

  const untouched: LedgerLine[] = [];
  if (pastCount > 0) {
    untouched.push({
      key: 'past',
      text: `${pastCount} past ${pluralize(pastCount, 'shift stays', 'shifts stay')} as scheduled — payroll has seen them`,
    });
  }
  if (lockedCount > 0) {
    untouched.push({
      key: 'locked',
      text: `${lockedCount} locked ${pluralize(lockedCount, 'shift stays', 'shifts stay')} as scheduled`,
    });
  }
  const unpickedDrift = driftedCount - selectedDriftCount;
  if (unpickedDrift > 0) {
    untouched.push({
      key: 'drifted',
      text: `${unpickedDrift} hand-edited ${pluralize(unpickedDrift, 'shift stays', 'shifts stay')} as scheduled unless you pick them`,
    });
  }

  const severityLabel = severity === 'high' ? 'High impact' : 'Low impact';
  const movingClause = `${totalAffected} ${pluralize(totalAffected, 'shift moves', 'shifts move')}`;
  const summary = publishedCount > 0
    ? `${severityLabel}. ${deltaBadge}. ${movingClause}, ${publishedCount} already posted.`
    : `${severityLabel}. ${deltaBadge}. ${movingClause}.`;

  return { severity, chips, changes, untouched, summary, deltaBadge, totalAffected };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/hoursChangeCopy.test.ts
```

Expected: PASS — 16 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/hoursChangeCopy.ts tests/unit/hoursChangeCopy.test.ts
git commit -m "feat(scheduling): add pure hours-change ledger copy"
```

---

### Task 5: `useTemplateLinkedShifts` — the data hook

**Files:**
- Create: `src/hooks/useTemplateLinkedShifts.ts`

**Interfaces:**
- Consumes: `LinkedShift` from Task 3.
- Produces: `useTemplateLinkedShifts(restaurantId, templateId) → { shifts: LinkedShift[]; isLoading: boolean; error: Error | null; refetch: () => void }`.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useTemplateLinkedShifts.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { LinkedShift } from '@/lib/scheduling/templateHoursBuckets';

/**
 * Every shift linked to a template, with only the fields the hour-cascade
 * buckets need.
 *
 * Critically, this query does NOT depend on the new times the manager is
 * typing. Fetch once on dialog open; every recompute is pure client-side
 * bucketing, so a keystroke never becomes a network request.
 *
 * Shape mirrors the sibling impact hook, useTemplateDeletionImpact:
 * refetchOnMount 'always' so a stale cached list cannot understate the blast
 * radius of a change the manager is about to commit.
 */
export function useTemplateLinkedShifts(
  restaurantId: string | null,
  templateId: string | null
): { shifts: LinkedShift[]; isLoading: boolean; error: Error | null; refetch: () => void } {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['template-linked-shifts', restaurantId, templateId],
    queryFn: async (): Promise<LinkedShift[]> => {
      if (!restaurantId || !templateId) return [];

      const { data, error } = await (supabase.from('shifts') as any)
        .select('id, start_time, end_time, is_published, locked, employee_id, employee:employees!employee_id(name)')
        .eq('restaurant_id', restaurantId)
        .eq('shift_template_id', templateId)
        .order('start_time');

      if (error) throw error;

      return (data ?? []).map((row: any): LinkedShift => ({
        id: row.id,
        start_time: row.start_time,
        end_time: row.end_time,
        is_published: !!row.is_published,
        locked: !!row.locked,
        employee_id: row.employee_id,
        // employee_id is NOT NULL, so this is null only when the join failed
        // to resolve a name — never "unassigned".
        employeeName: row.employee?.name ?? null,
      }));
    },
    enabled: !!restaurantId && !!templateId,
    staleTime: 30000,
    refetchOnMount: 'always',
  });

  return {
    shifts: data ?? [],
    isLoading,
    error: (error as Error) ?? null,
    refetch: () => { void refetch(); },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTemplateLinkedShifts.ts
git commit -m "feat(scheduling): add useTemplateLinkedShifts impact query"
```

---

### Task 6: `TemplateHoursImpact` — the ledger panel

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx`

**Interfaces:**
- Consumes: `HoursChangeLedger` (Task 4), `DriftRow` (Task 3), `SeverityPill` (`src/components/scheduling/SeverityPill.tsx`), `Collapsible` (`src/components/ui/collapsible.tsx`), `Checkbox` (`src/components/ui/checkbox.tsx`).
- Produces:
  ```ts
  TemplateHoursImpactProps {
    ledger: HoursChangeLedger | null;
    drifted: DriftRow[];
    selectedDriftIds: Set<string>;
    onToggleDrift: (shiftId: string) => void;
    publishedCount: number;
    notify: boolean;
    onNotifyChange: (next: boolean) => void;
    isLoading: boolean;
    error: Error | null;
    oldStart: string;
    oldEnd: string;
    newStart: string;
    newEnd: string;
  }
  ```

- [ ] **Step 1: Write the component**

Create `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx`:

```tsx
import { useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronRight } from 'lucide-react';

import { SeverityPill } from '@/components/scheduling/SeverityPill';

import type { LedgerTone } from '@/lib/scheduling/deletionCopy';
import type { HoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';
import type { DriftRow } from '@/lib/scheduling/templateHoursBuckets';

// Same map as DeleteTemplateDialog — edit and delete render identically.
const CHIP_TONE_CLASSES: Record<LedgerTone, string> = {
  destructive: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-500',
  success: 'bg-muted text-muted-foreground',
};

interface TemplateHoursImpactProps {
  ledger: HoursChangeLedger | null;
  drifted: DriftRow[];
  selectedDriftIds: Set<string>;
  onToggleDrift: (shiftId: string) => void;
  publishedCount: number;
  notify: boolean;
  onNotifyChange: (next: boolean) => void;
  isLoading: boolean;
  error: Error | null;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
}

export function TemplateHoursImpact({
  ledger,
  drifted,
  selectedDriftIds,
  onToggleDrift,
  publishedCount,
  notify,
  onNotifyChange,
  isLoading,
  error,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
}: Readonly<TemplateHoursImpactProps>) {
  const [expanded, setExpanded] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
        <p className="text-[13px] text-destructive">
          Couldn&apos;t check which shifts this affects. You can still save the template on its own.
        </p>
      </div>
    );
  }

  if (!ledger) return null;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      {/* Collapsed summary. The aria-live region is scoped to this one line:
          a polite region announces its whole subtree on change, so including
          the chips or the panels would re-read the entire ledger on every
          settled keystroke. */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <SeverityPill severity={ledger.severity} />
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              {ledger.deltaBadge}
            </span>
            <span aria-live="polite" className="text-[13px] text-muted-foreground truncate">
              {ledger.summary}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="line-through">{oldStart}–{oldEnd}</span>
              <span aria-hidden="true"> → </span>
              <span className="font-medium text-foreground">{newStart}–{newEnd}</span>
            </p>

            <div className="flex flex-wrap gap-1.5">
              {ledger.chips.map((chip) => (
                <span
                  key={chip.key}
                  className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${CHIP_TONE_CLASSES[chip.tone]}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Changes
                </h4>
                <ul className="space-y-1">
                  {ledger.changes.map((line) => (
                    <li key={line.key} className="text-[13px] text-foreground">{line.text}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Untouched
                </h4>
                {ledger.untouched.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Nothing is left behind.</p>
                ) : (
                  <ul className="space-y-1">
                    {ledger.untouched.map((line) => (
                      <li key={line.key} className="text-[13px] text-muted-foreground">{line.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {drifted.length > 0 && (
              <Collapsible open={driftOpen} onOpenChange={setDriftOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-[13px] font-medium text-foreground"
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${driftOpen ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    {drifted.length} hand-edited {drifted.length === 1 ? 'shift' : 'shifts'} — your call
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 space-y-2">
                    {drifted.map((row) => {
                      const who = row.employeeName ?? 'Unknown employee';
                      const inputId = `drift-${row.shiftId}`;
                      return (
                        <li key={row.shiftId} className="flex items-center gap-3">
                          <Checkbox
                            id={inputId}
                            checked={selectedDriftIds.has(row.shiftId)}
                            onCheckedChange={() => onToggleDrift(row.shiftId)}
                          />
                          <Label htmlFor={inputId} className="text-[13px] font-normal text-foreground">
                            {who} — {row.localDate}, currently {row.currentStart}–{row.currentEnd}
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}

            {publishedCount > 0 && (
              <div className="flex items-center gap-3 pt-1">
                <Checkbox
                  id="notify-staff"
                  checked={notify}
                  onCheckedChange={(next) => onNotifyChange(next === true)}
                />
                <Label htmlFor="notify-staff" className="text-[13px] font-normal text-foreground">
                  Notify {publishedCount} {publishedCount === 1 ? 'person' : 'staff'} whose posted shift moves
                </Label>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx
git commit -m "feat(scheduling): add TemplateHoursImpact ledger panel"
```

---

### Task 7: Wire the ledger into `TemplateFormDialog`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx`

**Interfaces:**
- Consumes: `useTemplateLinkedShifts` (Task 5), `bucketTemplateShifts` (Task 3), `buildHoursChangeLedger` (Task 4), `TemplateHoursImpact` (Task 6).
- Produces: the widened `onSubmit` payload every later task depends on:
  ```ts
  onSubmit(data: {
    name: string; start_time: string; end_time: string; position: string;
    area?: string | null; days: number[]; break_duration: number; capacity: number;
    cascade: boolean; driftedShiftIds: string[]; notify: boolean;
  }): void | Promise<void>
  ```
  plus a new required prop `restaurantTimezone: string`.

- [ ] **Step 1: Replace the imports block (lines 1–18)**

```tsx
import { useState, useEffect, useMemo, useCallback } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Clock } from 'lucide-react';

import { useTemplateLinkedShifts } from '@/hooks/useTemplateLinkedShifts';
import { useDebounce } from '@/hooks/useDebounce';

import type { ShiftTemplate } from '@/types/scheduling';

import { AreaCombobox } from '@/components/AreaCombobox';
import { TemplateHoursImpact } from '@/components/scheduling/ShiftPlanner/TemplateHoursImpact';
import { buildHoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';
import { bucketTemplateShifts } from '@/lib/scheduling/templateHoursBuckets';
import { cn } from '@/lib/utils';
```

If `src/hooks/useDebounce.ts` does not exist, create it first:

```ts
import { useEffect, useState } from 'react';

/** Returns `value` after it has been stable for `delayMs`. */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 2: Widen the props (lines 22–38)**

```tsx
interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ShiftTemplate;
  onSubmit: (data: {
    name: string;
    start_time: string;
    end_time: string;
    position: string;
    area?: string | null;
    days: number[];
    break_duration: number;
    capacity: number;
    cascade: boolean;
    driftedShiftIds: string[];
    notify: boolean;
  }) => void | Promise<void>;
  positions: string[];
  restaurantId: string | null;
  /** Already resolved through safeTz by the planner — never the browser's. */
  restaurantTimezone: string;
}
```

Add `restaurantTimezone` to the destructured params at line 40–47.

- [ ] **Step 3: Add the impact state and derivation after `isValid` (line 90)**

```tsx
  const [selectedDriftIds, setSelectedDriftIds] = useState<Set<string>>(new Set());
  const [notify, setNotify] = useState(true);

  const impact = useTemplateLinkedShifts(restaurantId, template?.id ?? null);

  // Debounce the DERIVED state, never the controlled input — the field itself
  // must stay instant or it feels broken. <input type="time"> fires change per
  // component (hour, then minute), so an undebounced ledger would announce two
  // or three incoherent intermediate states per edit.
  const debouncedStart = useDebounce(startTime, 300);
  const debouncedEnd = useDebounce(endTime, 300);

  const buckets = useMemo(() => {
    if (!template) return null;
    return bucketTemplateShifts({
      shifts: impact.shifts,
      oldStart: template.start_time.substring(0, 5),
      oldEnd: template.end_time.substring(0, 5),
      newStart: debouncedStart,
      newEnd: debouncedEnd,
      tz: restaurantTimezone,
      now: new Date(),
    });
  }, [template, impact.shifts, debouncedStart, debouncedEnd, restaurantTimezone]);

  const ledger = useMemo(() => {
    if (!template || !buckets) return null;
    const selectedDrift = buckets.drifted.filter((d) => selectedDriftIds.has(d.shiftId));
    return buildHoursChangeLedger({
      oldStart: template.start_time.substring(0, 5),
      oldEnd: template.end_time.substring(0, 5),
      newStart: debouncedStart,
      newEnd: debouncedEnd,
      movingCount: buckets.moving.length,
      publishedCount: buckets.publishedMovingIds.length,
      pastCount: buckets.past.length,
      lockedCount: buckets.locked.length,
      driftedCount: buckets.drifted.length,
      selectedDriftCount: selectedDrift.length,
      hoursDelta:
        buckets.movingHoursDelta + selectedDrift.reduce((sum, d) => sum + d.hoursDelta, 0),
    });
  }, [template, buckets, selectedDriftIds, debouncedStart, debouncedEnd]);

  const affectedCount = ledger?.totalAffected ?? 0;
  const hoursChanged = !!template &&
    (startTime !== template.start_time.substring(0, 5) || endTime !== template.end_time.substring(0, 5));
  const showCascadeChoice = isEdit && hoursChanged && affectedCount > 0 && !impact.isLoading && !impact.error;

  const toggleDrift = useCallback((shiftId: string) => {
    setSelectedDriftIds((prev) => {
      const next = new Set(prev);
      if (next.has(shiftId)) next.delete(shiftId); else next.add(shiftId);
      return next;
    });
  }, []);
```

Also reset the two new pieces of state in the existing pre-fill `useEffect` (line 61–82) — add these two lines next to `setIsSubmitting(false);`:

```tsx
    setSelectedDriftIds(new Set());
    setNotify(true);
```

- [ ] **Step 4: Route the cascade flag through submit (lines 92–114)**

```tsx
  const submitWith = async (cascade: boolean) => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        start_time: startTime,
        end_time: endTime,
        position: position.trim(),
        area: area.trim() || null,
        days,
        break_duration: breakDuration,
        capacity,
        cascade,
        driftedShiftIds: cascade ? [...selectedDriftIds] : [],
        notify: cascade && notify,
      });
      onOpenChange(false);
    } catch {
      // Error handled by the mutation's onError toast. The dialog stays open
      // so the manager's input is not lost.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in a text field submits the form; the safe default is the
    // cascading save when one is on offer, matching the primary button.
    await submitWith(showCascadeChoice);
  };
```

- [ ] **Step 5: Fix the `DialogDescription` a11y defect (line 128)**

Replace:

```tsx
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {isEdit ? 'Update template details' : 'Define a recurring shift pattern'}
              </p>
```

with:

```tsx
              {/* DialogDescription, not a plain <p> — Radix only wires
                  aria-describedby off this component. */}
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {isEdit ? 'Update template details' : 'Define a recurring shift pattern'}
              </DialogDescription>
```

- [ ] **Step 6: Render the ledger between the time inputs and Position (after line 185)**

Insert directly after the `{/* Time Range */}` grid closes and before `{/* Position */}`:

```tsx
          {/* Adjacent to the control that causes it, so cause and effect are
              visible together. Only on edit, and only once the hours actually
              differ from what is stored. */}
          {isEdit && hoursChanged && template && (
            <TemplateHoursImpact
              ledger={ledger}
              drifted={buckets?.drifted ?? []}
              selectedDriftIds={selectedDriftIds}
              onToggleDrift={toggleDrift}
              publishedCount={buckets?.publishedMovingIds.length ?? 0}
              notify={notify}
              onNotifyChange={setNotify}
              isLoading={impact.isLoading}
              error={impact.error}
              oldStart={template.start_time.substring(0, 5)}
              oldEnd={template.end_time.substring(0, 5)}
              newStart={debouncedStart}
              newEnd={debouncedEnd}
            />
          )}
```

- [ ] **Step 7: Replace the footer (lines 295–312) with a sticky `DialogFooter`**

```tsx
        </form>

        {/* Sticky, matching DeleteTemplateDialog:245. Without this, the ledger
            plus seven form fields pushes Save off-screen inside a
            max-h-[80vh] dialog on a 375x667 viewport. */}
        <DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>

          {showCascadeChoice && (
            <Button
              type="button"
              variant="outline"
              disabled={!isValid || isSubmitting}
              onClick={() => { void submitWith(false); }}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              Template only
            </Button>
          )}

          <Button
            type="button"
            // While the impact query resolves, the single button renders
            // disabled rather than showing a label that is about to change
            // under the pointer.
            disabled={!isValid || isSubmitting || (isEdit && hoursChanged && impact.isLoading)}
            onClick={() => { void submitWith(showCascadeChoice); }}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isSubmitting
              ? 'Saving...'
              : showCascadeChoice
                ? `Save & update ${affectedCount} ${affectedCount === 1 ? 'shift' : 'shifts'}`
                : isEdit ? 'Save changes' : 'Add Template'}
          </Button>
        </DialogFooter>
```

The `<form>` closing tag moves above the footer, so the footer sits outside the scrolling region. Keep `onSubmit={handleSubmit}` on the form so Enter still works.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: FAIL at `ShiftPlannerTab.tsx` — `restaurantTimezone` is missing and `onSubmit` now receives three extra fields. That is Task 9; it is the expected intermediate state.

- [ ] **Step 9: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx src/hooks/useDebounce.ts
git commit -m "feat(scheduling): show the hours-change impact ledger in the template form"
```

---

### Task 8: RPC-backed mutation, Undo, and notifications

**Files:**
- Modify: `src/hooks/useShiftTemplates.tsx:130-150` (the `updateMutation`)

**Interfaces:**
- Consumes: `update_shift_template_with_cascade`, `undo_template_hours_cascade` (Tasks 1–2).
- Produces: `updateTemplate(input)` where
  ```ts
  input: Partial<ShiftTemplate> & {
    id: string; cascade?: boolean; driftedShiftIds?: string[]; notify?: boolean;
  }
  ```

- [ ] **Step 1: Add the imports**

At the top of `src/hooks/useShiftTemplates.tsx`, alongside the existing `ToastAction` import used by `hideMutation`:

```tsx
import { ToastAction } from '@/components/ui/toast';
```

(If it is already imported for `hideMutation`, leave it.)

- [ ] **Step 2: Replace `updateMutation` (lines 130–150)**

```tsx
  const undoMutation = useMutation({
    mutationFn: async (batchId: string) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await (supabase.rpc as any)('undo_template_hours_cascade', {
        p_batch_id: batchId,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      return data as { restored_count: number; changed_since_count: number; deleted_count: number };
    },
    onSuccess: (result) => {
      invalidateAllStatuses();
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['template-linked-shifts', restaurantId] });

      const skipped = result.changed_since_count + result.deleted_count;
      toast({
        title: 'Cascade undone',
        description: skipped > 0
          ? `Restored ${result.restored_count} ${result.restored_count === 1 ? 'shift' : 'shifts'} · ${skipped} skipped (changed since)`
          : `Restored ${result.restored_count} ${result.restored_count === 1 ? 'shift' : 'shifts'}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      cascade = false,
      driftedShiftIds = [],
      notify = false,
      ...updates
    }: Partial<ShiftTemplate> & {
      id: string;
      cascade?: boolean;
      driftedShiftIds?: string[];
      notify?: boolean;
    }) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // One RPC, not a client-side loop: the template row and the shift rows
      // land in the same transaction, so there is no window where one has
      // applied and the other has not — which is the whole complaint being
      // fixed here, under a different trigger.
      const { data, error } = await (supabase.rpc as any)('update_shift_template_with_cascade', {
        p_template_id: id,
        p_restaurant_id: restaurantId,
        p_name: updates.name,
        p_position: updates.position,
        p_area: updates.area ?? null,
        p_days: updates.days,
        p_break_duration: updates.break_duration,
        p_capacity: updates.capacity,
        p_start_time: updates.start_time,
        p_end_time: updates.end_time,
        p_cascade: cascade,
        p_drifted_shift_ids: driftedShiftIds,
      });
      if (error) throw error;

      const result = data as {
        batch_id: string | null;
        updated_count: number;
        published_shift_ids: string[];
        skipped_count: number;
      };
      return { ...result, notify };
    },
    onSuccess: (result) => {
      invalidateAllStatuses();
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['template-linked-shifts', restaurantId] });

      // Fire-and-forget, one invoke per moved published shift. `invoke`
      // RESOLVES with { data, error } on HTTP failure rather than rejecting,
      // so both branches are handled and neither surfaces: the cascade already
      // succeeded, and a failed email must not read as a failed save.
      if (result.notify) {
        for (const shiftId of result.published_shift_ids ?? []) {
          supabase.functions
            .invoke('send-shift-notification', { body: { shiftId, action: 'modified' } })
            .then(({ error }) => {
              if (error) console.warn('template-cascade notify failed', { shiftId, error });
            })
            .catch((error) => {
              console.warn('template-cascade notify failed', { shiftId, error });
            });
        }
      }

      if (result.updated_count === 0 || !result.batch_id) {
        toast({ title: 'Template updated' });
        return;
      }

      const batchId = result.batch_id;
      toast({
        title: 'Template updated',
        description: `${result.updated_count} ${result.updated_count === 1 ? 'shift' : 'shifts'} moved to the new hours.`,
        action: (
          <ToastAction
            altText="Undo the shift hour changes"
            onClick={() => undoMutation.mutate(batchId)}
          >
            Undo
          </ToastAction>
        ),
        duration: 8000,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
```

- [ ] **Step 3: Export the undo state**

In the hook's return object, alongside `updateTemplate`, add:

```tsx
    isUndoingCascade: undoMutation.isPending,
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: still FAIL only at `ShiftPlannerTab.tsx` (Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShiftTemplates.tsx
git commit -m "feat(scheduling): route template updates through the cascade RPC with undo"
```

---

### Task 9: Wire the planner call site

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:120-126` (the false comment) and `:634-652` (`handleTemplateSubmit` + the `TemplateFormDialog` render)

**Interfaces:**
- Consumes: the widened `onSubmit` and the new `restaurantTimezone` prop (Task 7); `updateTemplate` (Task 8).
- Produces: nothing new — this closes the loop.

- [ ] **Step 1: Correct the false timezone claim (lines 120–126)**

Replace:

```tsx
  // 'America/Chicago'; anchoring the client to UTC for those rows would
```

The surrounding sentence currently asserts that *every* server-side scheduling function COALESCEs a null timezone to `'America/Chicago'`. That is false — six of them fall back to `'UTC'`. Rewrite the comment body as:

```tsx
  // `safeTz`, not `|| 'UTC'` — this value now feeds WRITE paths (drag-copy,
  // copy-week, planner create/update, template hour cascade) where it decides
  // the UTC instant that gets stored, not just how a cell is labelled.
  // `restaurants.timezone` is nullable. The two template-cascade RPCs COALESCE
  // a null to 'America/Chicago' to match this client fallback exactly; the six
  // older scheduling functions still COALESCE to 'UTC' and are a known
  // follow-up. Anchoring the client to UTC would write instants the server
  // then reads back on a different calendar day. `safeTz` maps null, empty and
  // invalid zones to 'America/Chicago'.
```

- [ ] **Step 2: Widen `handleTemplateSubmit` (lines 634–652)**

```tsx
  const handleTemplateSubmit = useCallback(async (data: {
    name: string;
    start_time: string;
    end_time: string;
    position: string;
    area?: string | null;
    days: number[];
    break_duration: number;
    capacity: number;
    cascade: boolean;
    driftedShiftIds: string[];
    notify: boolean;
  }) => {
    if (editingTemplate) {
      await updateTemplate({ id: editingTemplate.id, ...data });
    } else {
      // A brand-new template has no linked shifts, so the cascade fields are
      // meaningless on the insert path.
      const { cascade: _cascade, driftedShiftIds: _drifted, notify: _notify, ...templateFields } = data;
      await createTemplate({
        ...templateFields,
        restaurant_id: restaurantId,
        is_active: true,
      });
    }
  }, [editingTemplate, createTemplate, updateTemplate, restaurantId]);
```

- [ ] **Step 3: Pass the timezone to the dialog**

Find the `<TemplateFormDialog ... />` render and add:

```tsx
            restaurantTimezone={restaurantTimezone}
```

- [ ] **Step 4: Typecheck, lint, and run the whole unit suite**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS on all three.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(scheduling): wire the template cascade through the planner"
```

---

### Task 10: Playwright happy path

**Files:**
- Create: `tests/e2e/template-hours-cascade.spec.ts`

**Interfaces:**
- Consumes: everything above, plus `tests/helpers/e2e-supabase` (imported by relative path, matching `tests/e2e/impact-aware-deletion.spec.ts`).
- Produces: nothing.

- [ ] **Step 1: Read the neighbouring spec for the fixture idiom**

```bash
sed -n '1,60p' tests/e2e/impact-aware-deletion.spec.ts
```

Expected: the `generateTestUser()` / `createTestRestaurant()` helper calls and the login flow this spec must copy.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/template-hours-cascade.spec.ts`, reusing the setup helpers exactly as `impact-aware-deletion.spec.ts` does, then:

```ts
import { test, expect } from '@playwright/test';

import { generateTestUser, signUpAndLogin, createTestRestaurant, seedTemplateWithShifts, cleanup } from '../helpers/e2e-supabase';

test.describe('template hours cascade', () => {
  test('moving a template\'s hours moves the linked shifts', async ({ page }) => {
    const user = generateTestUser();
    const ctx = await signUpAndLogin(page, user);
    const restaurant = await createTestRestaurant(ctx, { timezone: 'America/Chicago' });
    // Two future unlocked shifts at 09:00-17:00 local, linked to the template.
    const { template } = await seedTemplateWithShifts(ctx, restaurant.id, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 2,
    });

    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();
    await page.getByRole('button', { name: new RegExp(`edit ${template.name}`, 'i') }).click();

    // Before any edit there is no cascade choice — the primary CTA is plain.
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

    await page.getByLabel('Start Time').fill('10:00');
    await page.getByLabel('End Time').fill('18:00');

    // The ledger appears, and the primary CTA switches to the counted label.
    const cascadeButton = page.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(cascadeButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Template only' })).toBeVisible();

    await cascadeButton.click();

    await expect(page.getByText('2 shifts moved to the new hours.')).toBeVisible();
    // The grid reflects the move.
    await expect(page.getByText('10:00 AM').first()).toBeVisible();

    await cleanup(ctx);
  });

  test('a hand-edited shift is left alone unless its checkbox is ticked', async ({ page }) => {
    const user = generateTestUser();
    const ctx = await signUpAndLogin(page, user);
    const restaurant = await createTestRestaurant(ctx, { timezone: 'America/Chicago' });
    const { template, drifted } = await seedTemplateWithShifts(ctx, restaurant.id, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 1,
      driftedShift: { start_time: '11:00', end_time: '19:00', employeeName: 'Casey Chicago' },
    });

    await page.goto('/scheduling');
    await page.getByRole('tab', { name: /planner/i }).click();
    await page.getByRole('button', { name: new RegExp(`edit ${template.name}`, 'i') }).click();
    await page.getByLabel('Start Time').fill('10:00');
    await page.getByLabel('End Time').fill('18:00');

    // Not counted until it is picked.
    await expect(page.getByRole('button', { name: 'Save & update 1 shift' })).toBeVisible();

    await page.getByRole('button', { name: /hand-edited/i }).click();
    // The label names the employee and the date — this is the a11y assertion.
    await page.getByLabel(new RegExp(`Casey Chicago — ${drifted.localDate}`, 'i')).check();

    await expect(page.getByRole('button', { name: 'Save & update 2 shifts' })).toBeVisible();

    await cleanup(ctx);
  });
});
```

If `seedTemplateWithShifts` does not exist in `tests/helpers/e2e-supabase`, add it there — a thin service-role insert of one `shift_templates` row plus `shiftCount` matching shifts anchored to next Monday in the restaurant's timezone, returning `{ template, drifted }`. Mirror the existing seed helpers in that file; do not inline raw supabase calls in the spec.

- [ ] **Step 3: Run the spec**

```bash
npx playwright test tests/e2e/template-hours-cascade.spec.ts --reporter=line
```

Expected: PASS — 2 passed. Run it in the foreground; do not wrap it in a poll loop.

- [ ] **Step 4: Run the full suite once**

```bash
npm run test && npm run test:db
```

Expected: PASS on both.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/template-hours-cascade.spec.ts tests/helpers/e2e-supabase.ts
git commit -m "test(scheduling): e2e coverage for the template hours cascade"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Four buckets and one flag | 1 (server), 3 (client) |
| Drift detection is a timezone problem | 1 (SQL `AT TIME ZONE`), 3 (`formatLocalHHMMInTz`) |
| Writing the new times: reconstruct, never offset | 1, Step 4 (`target` CTE) |
| One fallback timezone, not two | 1 (`'America/Chicago'` COALESCE), 9 (comment correction) |
| `useTemplateLinkedShifts` | 5 |
| `bucketTemplateShifts` | 3 |
| `buildHoursChangeLedger` | 4 |
| Dialog layout, sticky footer, delta framing | 6, 7 |
| Delta badge is not a `LedgerChip` | 4 (`deltaBadge: string`), 6 (`bg-muted` span) |
| Scheduled-hours delta, no dollars | 3 (`movingHoursDelta`), 4 (`formatHoursDelta`) |
| Two save buttons; N=0 collapses to one | 7, Step 7 (`showCascadeChoice`) |
| Drift disclosure on Radix `Collapsible`, real `<label>` | 6 |
| `aria-live="polite"` on the summary only | 6 |
| 300ms debounce on derived state | 7, Step 3 |
| `DialogDescription` a11y fix | 7, Step 5 |
| Why an RPC / `update_shift_template_with_cascade` | 1 |
| Authorization + mandatory `restaurant_id` scoping | 1 (guard + every `WHERE`), 1 test 21 |
| Undo: batch column, partial index | 1 |
| `undo_template_hours_cascade` | 2 |
| `log_shift_change` double-log documented | 1 test 19, 2 (undo scoping comment) |
| Notifications, fire-and-forget | 8 |
| Error handling table | 6 (loading/error states), 7 (disabled buttons, dialog stays open), 8 (`console.warn`) |
| Testing: pgTAP / Vitest / Playwright | 1, 2 / 3, 4 / 10 |
| Files list | File Structure table |

Two spec items are deliberately *corrected* rather than implemented as written, both recorded in Global Constraints: `DriftRow.employeeName`'s fallback label is "Unknown employee" (not "Unassigned") because `shifts.employee_id` is `NOT NULL`; and `undo_template_hours_cascade` adds an explicit `p_batch_id IS NULL` guard the spec did not call for, because `IS NOT DISTINCT FROM NULL` would otherwise match every untagged audit row in the table.

**Placeholder scan:** no TBD/TODO, no "add appropriate error handling", no "similar to Task N". Every code step carries the code. The only conditional work is Task 7 Step 1 (`useDebounce` — created inline if absent) and Task 10 Step 2 (`seedTemplateWithShifts` — specified inline if absent).

**Type consistency:** `LinkedShift` / `DriftRow` / `TemplateHoursBuckets` defined in Task 3 and consumed unchanged in 4, 5, 6, 7. `HoursChangeInput` / `HoursChangeLedger` defined in 4 and consumed in 6, 7. The RPC's `{ batch_id, updated_count, published_shift_ids, skipped_count }` is fixed in Task 1 and destructured identically in Task 8. `onSubmit`'s three new fields (`cascade`, `driftedShiftIds`, `notify`) are declared in Task 7 and consumed in Task 9. `bucketTemplateShifts` is spelled the same everywhere; `durationMinutes` is exported from Task 3 and imported by Task 4.
