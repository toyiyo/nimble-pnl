# Fix Availability UTC Overnight Constraint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the `valid_time` check constraint that rejects availability entries where UTC conversion causes `end_time < start_time` (overnight in UTC).

**Architecture:** The availability system stores times in UTC (converted from restaurant local time). When a restaurant in CST sets availability 8 AM–11 PM, it becomes 13:00–04:00 UTC, which crosses midnight. The DB constraint `end_time > start_time` rejects this. We relax the constraint and update the conflict detection SQL function to handle overnight UTC windows. Frontend validation moves before UTC conversion.

**Tech Stack:** PostgreSQL (migration), SQL (pgTAP tests), React/TypeScript (frontend validation fix)

---

### Task 1: Write pgTAP Tests for Overnight UTC Availability

**Files:**
- Create: `supabase/tests/availability_overnight.sql`

**Step 1: Write the pgTAP test file**

```sql
BEGIN;
SELECT plan(6);

-- Setup: create restaurant, employee
INSERT INTO restaurants (id, name, timezone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Overnight Restaurant', 'America/Chicago')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, first_name, last_name, role)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test', 'Employee', 'staff')
ON CONFLICT (id) DO NOTHING;

-- Test 1: Normal availability (start < end) should still work
SELECT lives_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, true, '09:00:00', '17:00:00')$$,
  'Normal availability (09:00-17:00) should succeed'
);

-- Test 2: Overnight UTC availability (end < start) should now work
SELECT lives_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, true, '13:00:00', '04:00:00')$$,
  'Overnight UTC availability (13:00-04:00) should succeed'
);

-- Test 3: Same start and end time should be rejected (zero-length window)
SELECT throws_ok(
  $$INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, true, '09:00:00', '09:00:00')$$,
  '23514',
  NULL,
  'Same start and end time should be rejected'
);

-- Test 4: Normal exception availability (start < end) should still work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-01', true, '09:00:00', '17:00:00')$$,
  'Normal exception availability (09:00-17:00) should succeed'
);

-- Test 5: Overnight UTC exception availability should work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available, start_time, end_time)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-02', true, '13:00:00', '04:00:00')$$,
  'Overnight UTC exception availability (13:00-04:00) should succeed'
);

-- Test 6: Exception with NULL times (unavailable all day) should still work
SELECT lives_ok(
  $$INSERT INTO availability_exceptions (restaurant_id, employee_id, date, is_available)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-04-03', false)$$,
  'Exception with NULL times should succeed'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run the tests to verify they fail**

Run: `npm run test:db`
Expected: Tests 2 and 5 FAIL with check constraint violation `valid_time`

**Step 3: Commit failing tests**

```bash
git add supabase/tests/availability_overnight.sql
git commit -m "test: add pgTAP tests for overnight UTC availability windows"
```

---

### Task 2: Relax CHECK Constraints on Both Tables

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_fix_availability_overnight_constraint.sql` (use next timestamp)

**Step 1: Write the migration**

```sql
-- Fix availability constraints to allow overnight UTC windows
-- When a restaurant in CST sets availability 8 AM-11 PM local,
-- UTC conversion produces 13:00-04:00 which crosses midnight.
-- The old constraint (end_time > start_time) rejects this.
-- New constraint: only reject when start_time = end_time (zero-length window).

-- Drop and recreate constraint on employee_availability
ALTER TABLE employee_availability DROP CONSTRAINT IF EXISTS valid_time;
ALTER TABLE employee_availability ADD CONSTRAINT valid_time CHECK (end_time != start_time);

-- Drop and recreate constraint on availability_exceptions
ALTER TABLE availability_exceptions DROP CONSTRAINT IF EXISTS valid_exception_time;
ALTER TABLE availability_exceptions ADD CONSTRAINT valid_exception_time CHECK (
  (start_time IS NULL AND end_time IS NULL) OR
  (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time != start_time)
);
```

**Step 2: Run pgTAP tests to verify they pass**

Run: `npm run test:db`
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add supabase/migrations/*_fix_availability_overnight_constraint.sql
git commit -m "fix: relax availability check constraints to allow overnight UTC windows"
```

---

### Task 3: Update `check_availability_conflict` for Overnight Windows

**Files:**
- Modify: `supabase/migrations/YYYYMMDDHHMMSS_fix_availability_overnight_constraint.sql` (append to same migration)

**Step 1: Add pgTAP tests for conflict detection with overnight availability**

Add to `supabase/tests/availability_overnight.sql`:

```sql
-- Increase plan count to 10

-- Test 7: Shift within overnight availability window (before midnight portion) — no conflict
-- Availability: 13:00-04:00 UTC (8AM-11PM CST)
-- Shift: 14:00-20:00 UTC (9AM-3PM CST) — within window
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-07 14:00:00+00'::timestamptz,  -- Monday (day_of_week=1)
    '2026-04-07 20:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift 14:00-20:00 UTC within overnight avail 13:00-04:00 — no conflict'
);

-- Test 8: Shift within overnight availability window (after midnight portion) — no conflict
-- Shift: 01:00-03:00 UTC (8PM-10PM CST prev day) — within window
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-08 01:00:00+00'::timestamptz,  -- Tuesday but maps to Monday avail
    '2026-04-08 03:00:00+00'::timestamptz
  ))::integer,
  0,
  'Shift 01:00-03:00 UTC within after-midnight portion — no conflict'
);

-- Test 9: Shift outside overnight availability window — conflict
-- Shift: 05:00-10:00 UTC (12AM-5AM CST) — outside window (after 04:00 UTC end)
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-07 05:00:00+00'::timestamptz,  -- Monday
    '2026-04-07 10:00:00+00'::timestamptz
  ))::integer,
  1,
  'Shift 05:00-10:00 UTC outside overnight avail 13:00-04:00 — conflict'
);

-- Test 10: Shift spanning the gap in overnight availability — conflict
-- Shift: 03:00-14:00 UTC — spans the 04:00-13:00 gap
SELECT is(
  (SELECT count(*) FROM check_availability_conflict(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-04-07 03:00:00+00'::timestamptz,  -- Monday
    '2026-04-07 14:00:00+00'::timestamptz
  ))::integer,
  1,
  'Shift 03:00-14:00 UTC spanning gap in overnight avail — conflict'
);
```

**Step 2: Run tests to verify conflict tests fail**

Run: `npm run test:db`
Expected: Tests 7-10 FAIL (conflict function doesn't handle overnight windows yet)

**Step 3: Update the conflict detection function**

Append to the migration file the updated `check_availability_conflict` function. The key change is in the time containment check — when `avail.end_time < avail.start_time` (overnight), the shift is within the window if `shift_time >= avail.start_time OR shift_time <= avail.end_time`:

```sql
CREATE OR REPLACE FUNCTION check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT,
  message TEXT
) AS $$
DECLARE
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_shift_start_time TIME;
  v_shift_end_time TIME;
  v_exception RECORD;
  v_availability RECORD;
  v_has_availability BOOLEAN;
BEGIN
  v_current_date := DATE(p_start_time);
  v_end_date := DATE(p_end_time);

  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);

    IF v_current_date = DATE(p_start_time) AND v_current_date = DATE(p_end_time) THEN
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := (p_end_time)::TIME;
    ELSIF v_current_date = DATE(p_start_time) THEN
      v_shift_start_time := (p_start_time)::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    ELSIF v_current_date = DATE(p_end_time) THEN
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := (p_end_time)::TIME;
    ELSE
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    END IF;

    -- Check for exception on this specific date
    SELECT * INTO v_exception
    FROM availability_exceptions
    WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND date = v_current_date
    LIMIT 1;

    IF FOUND THEN
      IF NOT v_exception.is_available THEN
        RETURN QUERY SELECT true, 'exception'::TEXT,
          'Employee is unavailable on ' || v_current_date::TEXT ||
          COALESCE(' (' || v_exception.reason || ')', '');
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        -- Check if shift is within exception availability window
        IF v_exception.end_time < v_exception.start_time THEN
          -- Overnight window: available from start_time to midnight AND midnight to end_time
          IF NOT (v_shift_start_time >= v_exception.start_time OR v_shift_start_time <= v_exception.end_time)
             OR NOT (v_shift_end_time >= v_exception.start_time OR v_shift_end_time <= v_exception.end_time) THEN
            RETURN QUERY SELECT true, 'exception'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
              v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
            RETURN;
          END IF;
        ELSE
          -- Normal window: start_time <= shift <= end_time
          IF NOT (v_shift_start_time >= v_exception.start_time AND v_shift_end_time <= v_exception.end_time) THEN
            RETURN QUERY SELECT true, 'exception'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
              v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')';
            RETURN;
          END IF;
        END IF;
      END IF;
    ELSE
      v_has_availability := false;
      FOR v_availability IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_day_of_week
      LOOP
        v_has_availability := true;
        IF NOT v_availability.is_available THEN
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Employee is not available on this day of the week';
          RETURN;
        END IF;

        -- Check if shift is within availability window
        IF v_availability.end_time < v_availability.start_time THEN
          -- Overnight window
          IF NOT (v_shift_start_time >= v_availability.start_time OR v_shift_start_time <= v_availability.end_time)
             OR NOT (v_shift_end_time >= v_availability.start_time OR v_shift_end_time <= v_availability.end_time) THEN
            RETURN QUERY SELECT true, 'recurring'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability (' ||
              v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
            RETURN;
          END IF;
        ELSE
          -- Normal window
          IF NOT (v_shift_start_time >= v_availability.start_time AND v_shift_end_time <= v_availability.end_time) THEN
            RETURN QUERY SELECT true, 'recurring'::TEXT,
              'Shift on ' || v_current_date::TEXT || ' is outside employee availability (' ||
              v_availability.start_time::TEXT || ' - ' || v_availability.end_time::TEXT || ')';
            RETURN;
          END IF;
        END IF;
      END LOOP;

      IF NOT v_has_availability THEN
        NULL;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
```

**Step 4: Run pgTAP tests**

Run: `npm run test:db`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/*_fix_availability_overnight_constraint.sql supabase/tests/availability_overnight.sql
git commit -m "fix: update conflict detection to handle overnight UTC availability windows"
```

---

### Task 4: Fix Frontend Validation in AvailabilityDialog

**Files:**
- Modify: `src/components/AvailabilityDialog.tsx:113`

**Step 1: Fix the validation logic**

The current validation `startTime < endTime` is a string comparison on local times. This is correct for local time validation (users should always enter start < end in local), but it runs on the raw state values which are local — so it's actually fine for the user's perspective. The real issue is it would block legitimate overnight local entries if we ever supported them.

For now, keep the local-time validation (start < end) since users always mean same-day availability in local time. No change needed here.

**Actually — verify the current validation is correct.** The user enters 8 AM to 11 PM. `startTime="08:00"`, `endTime="23:00"`. String comparison `"08:00" < "23:00"` is `true`. This is correct. The bug is purely in the DB constraint after UTC conversion.

No frontend changes needed. Skip this task.

---

### Task 5: Verify End-to-End Fix

**Step 1: Reset local database and run all tests**

Run: `npm run db:reset && npm run test:db`
Expected: All pgTAP tests pass including the new overnight availability tests

**Step 2: Run unit tests**

Run: `npm run test`
Expected: All existing tests pass (no regressions)

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit if any cleanup needed**

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/migrations/*_fix_availability_overnight_constraint.sql` | Relax `valid_time` constraints, update `check_availability_conflict()` |
| `supabase/tests/availability_overnight.sql` | 10 pgTAP tests for overnight UTC windows |

No frontend changes required — the dialog correctly converts local→UTC, and the local-time validation is correct.
