# Availability Validation TZ Fix + Pre-Drag Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make availability validation correct and consistent across all scheduling views by fixing the timezone-broken `check_availability_conflict` RPC, and visualize each employee's availability before/while assigning (sidebar strip + timeline bar markers).

**Architecture:** The RPC is rewritten to evaluate everything in the **restaurant-local** frame, mirroring the Availability grid (trust the stored local `day_of_week`, convert only the stored UTC-clock time-of-day). The visualization reuses the grid's `computeEffectiveAvailability` via shared color/label/predicate helpers so display and validation cannot drift.

**Tech Stack:** PostgreSQL/plpgsql + pgTAP, React 18 + TypeScript, Vitest, TailwindCSS/shadcn, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-07-11-availability-conflict-tz-design.md`

---

## File Structure

- **New** `supabase/migrations/20260712120000_availability_conflict_local_tz.sql` — timezone-aware `check_availability_conflict`.
- **New** `supabase/tests/availability_conflict_local_tz.sql` — pgTAP TZ regressions.
- `supabase/tests/availability_conflict_utc.sql`, `availability_overnight.sql`, `availability_conflict_structured.sql` — verify still pass; adjust only if they encoded the bug.
- `src/lib/effectiveAvailability.ts` — add `availabilityColorClasses`, `availabilityLabel`, `shiftOutsideAvailability`.
- `src/components/scheduling/TeamAvailabilityGrid.tsx` — consume shared helpers (no visual change).
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — fetch exceptions, memoize effective map, thread props.
- `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx` — new props + comparator update.
- `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx` — availability tint + strip aria summary.
- `src/lib/timelineModel.ts`, `src/components/scheduling/ShiftTimeline/useTimelineModel.ts`, `TimelineBar.tsx`, `ShiftTimelineTab.tsx` — per-bar outside-availability marker.
- `tests/unit/effectiveAvailability.test.ts`, `tests/unit/conflictFormatUtils.test.ts` — extend.

> **Migration timestamp:** `20260712120000` is later than the current latest (`20260708193107`). If a newer migration has landed on `main` at merge time, bump the prefix so it sorts last.

---

## Task 1: Timezone-aware `check_availability_conflict` RPC

**Files:**
- Create: `supabase/migrations/20260712120000_availability_conflict_local_tz.sql`
- Create: `supabase/tests/availability_conflict_local_tz.sql`

- [ ] **Step 1: Write the failing pgTAP test (the reported bug + backward-rollover regression)**

Create `supabase/tests/availability_conflict_local_tz.sql`:

```sql
BEGIN;
SELECT plan(6);

SET LOCAL client_min_messages TO WARNING;

-- Deterministic fixtures: RLS off, delete-before-insert, fixed absolute dates.
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability DISABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions DISABLE ROW LEVEL SECURITY;

-- Fixed IDs
CREATE TEMP TABLE t_ids AS SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS rid,
  '22222222-2222-2222-2222-222222222222'::uuid AS eid;

DELETE FROM availability_exceptions WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability  WHERE restaurant_id = (SELECT rid FROM t_ids);
DELETE FROM employees              WHERE id = (SELECT eid FROM t_ids);
DELETE FROM restaurants            WHERE id = (SELECT rid FROM t_ids);

INSERT INTO restaurants (id, name, timezone)
VALUES ((SELECT rid FROM t_ids), 'TZ Test NY', 'America/New_York')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, name, status)
VALUES ((SELECT eid FROM t_ids), (SELECT rid FROM t_ids), 'TZ Emp', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active';

-- Summer fixed date 2027-07-13 is a Tuesday (EDT). Available Tue 2:00 PM-10:30 PM local.
-- Store start/end as the UTC clock the writer would produce, DERIVED via SQL so it is
-- DST-correct regardless of when CI runs.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 2, true,
  (('2027-07-13 14:00'::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC')::time,
  (('2027-07-13 22:30'::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC')::time
);
-- Marked UNAVAILABLE Wednesday (day_of_week = 3) — the day the old UTC bug bled into.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 3, false, '00:00', '00:00');

-- CASE 1 (the reported bug): Tue 5:00 PM-9:00 PM local shift => NO conflict.
SELECT is(
  (SELECT count(*)::int FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 17:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 21:00'::timestamp AT TIME ZONE 'America/New_York'))),
  0,
  'Tue evening shift within Tue availability returns no conflict (was false Wed bleed)'
);

-- CASE 2 (partial outside-window): Tue 11:00 AM-1:00 PM => recurring conflict WITH window.
SELECT is(
  (SELECT conflict_type FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 11:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 13:00'::timestamp AT TIME ZONE 'America/New_York')) LIMIT 1),
  'recurring',
  'Tue morning shift outside the window is a recurring conflict'
);
SELECT ok(
  (SELECT available_start IS NOT NULL FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-13 11:00'::timestamp AT TIME ZONE 'America/New_York'),
     ('2027-07-13 13:00'::timestamp AT TIME ZONE 'America/New_York')) LIMIT 1),
  'Outside-window conflict returns the available window (hours shown in dialog)'
);

-- CASE 3 (backward-rollover regression): America/Los_Angeles, available 6-7 PM local.
UPDATE restaurants SET timezone = 'America/Los_Angeles' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
-- 2027-07-12 is a Monday (PDT). 6:00 PM PDT -> 01:00 UTC (next day) — the case the
-- old convertOne-mirroring formula misattributed to Sunday.
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES (
  (SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 1, true,
  (('2027-07-12 18:00'::timestamp AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC')::time,
  (('2027-07-12 19:00'::timestamp AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC')::time
);
SELECT is(
  (SELECT count(*)::int FROM check_availability_conflict(
     (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
     ('2027-07-12 18:00'::timestamp AT TIME ZONE 'America/Los_Angeles'),
     ('2027-07-12 19:00'::timestamp AT TIME ZONE 'America/Los_Angeles'))),
  0,
  'Late-local-start (6PM PDT) window matches the same-day shift (no backward-rollover false conflict)'
);

-- CASE 4 (invalid timezone falls back to UTC, no throw): garbage tz, UTC-stored window.
UPDATE restaurants SET timezone = 'Not/AZone' WHERE id = (SELECT rid FROM t_ids);
DELETE FROM employee_availability WHERE restaurant_id = (SELECT rid FROM t_ids);
INSERT INTO employee_availability (restaurant_id, employee_id, day_of_week, is_available, start_time, end_time)
VALUES ((SELECT rid FROM t_ids), (SELECT eid FROM t_ids), 1, true, '09:00', '17:00');
SELECT lives_ok(
  $$ SELECT * FROM check_availability_conflict(
       (SELECT eid FROM t_ids), (SELECT rid FROM t_ids),
       '2027-07-12 10:00+00'::timestamptz, '2027-07-12 12:00+00'::timestamptz) $$,
  'Invalid timezone falls back to UTC without raising'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db -- --file supabase/tests/availability_conflict_local_tz.sql` (or the repo's pgTAP runner). Expected: CASE 1 and CASE 3 FAIL against the current UTC-based function (false conflicts), proving the bug.

- [ ] **Step 3: Write the migration (minimal code to pass)**

Create `supabase/migrations/20260712120000_availability_conflict_local_tz.sql` with:

```sql
-- Timezone-aware rewrite of check_availability_conflict.
-- Prior version (20260322170137) derived day-of-week/time-of-day in UTC, but
-- employee_availability.day_of_week is restaurant-LOCAL and start/end are UTC-clock
-- times. This evaluates everything in the restaurant-local frame, mirroring the
-- Availability grid (trust stored day_of_week; convert only time-of-day). See
-- supabase/functions/_shared/availability-tz.ts and src/lib/availabilityTimeUtils.ts.
-- Signature/return shape unchanged, so no DROP is required.

CREATE OR REPLACE FUNCTION check_availability_conflict(
  p_employee_id UUID,
  p_restaurant_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  has_conflict BOOLEAN,
  conflict_type TEXT,
  message TEXT,
  available_start TIME,
  available_end TIME
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tz TEXT;
  v_start_local TIMESTAMP;
  v_end_local TIMESTAMP;
  v_current_date DATE;
  v_end_date DATE;
  v_prev_date DATE;
  v_dow INTEGER;
  v_seg_start TIMESTAMP;
  v_seg_end TIMESTAMP;
  v_exception RECORD;
  v_avail RECORD;
  v_w_start_tod TIME;
  v_w_end_tod TIME;
  v_w_start_ts TIMESTAMP;
  v_w_end_ts TIMESTAMP;
  v_match BOOLEAN;
  v_has_unavailable BOOLEAN;
  v_has_window BOOLEAN;
  v_last_start TIME;
  v_last_end TIME;
BEGIN
  -- 1. Resolve + validate restaurant timezone (fallback UTC).
  SELECT timezone INTO v_tz FROM restaurants WHERE id = p_restaurant_id;
  v_tz := COALESCE(NULLIF(v_tz, ''), 'UTC');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- 2. Shift instants -> restaurant-local wall clock.
  v_start_local := p_start_time AT TIME ZONE v_tz;
  v_end_local   := p_end_time   AT TIME ZONE v_tz;

  v_current_date := v_start_local::date;
  IF v_end_local::time = TIME '00:00:00' AND v_end_local > v_start_local THEN
    v_end_date := (v_end_local - INTERVAL '1 day')::date;
  ELSE
    v_end_date := v_end_local::date;
  END IF;

  -- 3. Walk each LOCAL date the shift covers.
  WHILE v_current_date <= v_end_date LOOP
    v_dow := EXTRACT(DOW FROM v_current_date)::int;
    v_prev_date := v_current_date - 1;

    v_seg_start := GREATEST(v_start_local, v_current_date::timestamp);
    v_seg_end   := LEAST(v_end_local, (v_current_date + 1)::timestamp);

    -- 3a. Exception overrides recurring for this exact local date.
    SELECT * INTO v_exception
    FROM availability_exceptions
    WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND date = v_current_date
    LIMIT 1;  -- multi-slot exceptions not modeled (see design follow-up)

    IF FOUND THEN
      IF NOT v_exception.is_available THEN
        RETURN QUERY SELECT true, 'exception'::text,
          'Employee is unavailable on ' || v_current_date::text ||
            COALESCE(' (' || v_exception.reason || ')', ''),
          NULL::time, NULL::time;
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        v_w_start_tod := (((v_current_date + v_exception.start_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_end_tod   := (((v_current_date + v_exception.end_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_start_ts := v_current_date + v_w_start_tod;
        v_w_end_ts   := v_current_date + v_w_end_tod
                        + (CASE WHEN v_w_end_tod <= v_w_start_tod
                                THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
        IF NOT (v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts) THEN
          RETURN QUERY SELECT true, 'exception'::text,
            'Shift on ' || v_current_date::text || ' is outside employee availability',
            v_exception.start_time, v_exception.end_time;
          RETURN;
        END IF;
      END IF;
    ELSE
      -- 3b. Recurring availability for this local weekday.
      v_match := false;
      v_has_unavailable := false;
      v_has_window := false;
      v_last_start := NULL;
      v_last_end := NULL;

      FOR v_avail IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_dow
      LOOP
        IF NOT v_avail.is_available THEN
          v_has_unavailable := true;
          CONTINUE;
        END IF;
        v_has_window := true;
        v_last_start := v_avail.start_time;
        v_last_end := v_avail.end_time;
        v_w_start_tod := (((v_current_date + v_avail.start_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_end_tod   := (((v_current_date + v_avail.end_time)::timestamp
                            AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
        v_w_start_ts := v_current_date + v_w_start_tod;
        v_w_end_ts   := v_current_date + v_w_end_tod
                        + (CASE WHEN v_w_end_tod <= v_w_start_tod
                                THEN INTERVAL '1 day' ELSE INTERVAL '0' END);
        IF v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts THEN
          v_match := true;
          EXIT;
        END IF;
      END LOOP;

      -- 3c. Previous local day's overnight windows can cover the early hours of today.
      IF NOT v_match THEN
        FOR v_avail IN
          SELECT * FROM employee_availability
          WHERE employee_id = p_employee_id
            AND restaurant_id = p_restaurant_id
            AND day_of_week = EXTRACT(DOW FROM v_prev_date)::int
            AND is_available = true
        LOOP
          v_w_start_tod := (((v_prev_date + v_avail.start_time)::timestamp
                              AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
          v_w_end_tod   := (((v_prev_date + v_avail.end_time)::timestamp
                              AT TIME ZONE 'UTC') AT TIME ZONE v_tz)::time;
          IF v_w_end_tod <= v_w_start_tod THEN  -- overnight local window spills into today
            v_has_window := true;
            IF v_last_start IS NULL THEN
              v_last_start := v_avail.start_time;
              v_last_end := v_avail.end_time;
            END IF;
            v_w_start_ts := v_prev_date + v_w_start_tod;
            v_w_end_ts   := v_prev_date + v_w_end_tod + INTERVAL '1 day';
            IF v_seg_start >= v_w_start_ts AND v_seg_end <= v_w_end_ts THEN
              v_match := true;
              EXIT;
            END IF;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_match THEN
        IF v_has_window THEN
          RETURN QUERY SELECT true, 'recurring'::text,
            'Shift on ' || v_current_date::text || ' is outside employee availability',
            v_last_start, v_last_end;
          RETURN;
        ELSIF v_has_unavailable THEN
          RETURN QUERY SELECT true, 'recurring'::text,
            'Employee is not available on this day of the week',
            NULL::time, NULL::time;
          RETURN;
        END IF;
        -- else: no recurring data for this weekday -> unknown -> no conflict.
      END IF;
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN;  -- no conflict
END;
$$;
```

- [ ] **Step 4: Reset the local DB and run the new + existing pgTAP suites**

Run: `npm run db:reset && npm run test:db`
Expected: `availability_conflict_local_tz.sql` PASSES; the three existing suites (`availability_conflict_utc.sql`, `availability_overnight.sql`, `availability_conflict_structured.sql`) still PASS. If an existing suite fails, inspect it: only adjust it if its expectation encoded the UTC bug (e.g. a non-UTC restaurant expecting the wrong day). UTC-restaurant expectations must be unchanged.

- [ ] **Step 5: Add the remaining pgTAP cases (overnight local + nearest-window + exception)**

Append to `supabase/tests/availability_conflict_local_tz.sql` (bump `plan(6)` to the new count):
- Overnight local window `America/Chicago` available 6:00 PM–2:00 AM local: a 10:00 PM–1:00 AM shift → 0 rows; a 3:00 AM shift → 1 recurring conflict.
- Early-morning shift covered only by the prior-day overnight window returns that window in `available_start`/`available_end` (assert `available_start IS NOT NULL`).
- Exception unavailable on a specific date → `conflict_type = 'exception'`, NULL window; exception window present but shift outside → `'exception'` with the window.

Use the same DERIVED-UTC-clock fixture pattern (inline `AT TIME ZONE` conversion) and fixed dates.

- [ ] **Step 6: Run and commit**

Run: `npm run db:reset && npm run test:db` → all PASS.
```bash
git add supabase/migrations/20260712120000_availability_conflict_local_tz.sql supabase/tests/availability_conflict_local_tz.sql
git commit -m "fix(scheduling): evaluate availability conflicts in restaurant-local frame

check_availability_conflict derived day-of-week/time in UTC while the
day_of_week column is local and times are UTC-clock; non-UTC restaurants got
false 'not available on this day' warnings. Rewrite mirrors the Availability
grid (local day_of_week, time-of-day conversion). pgTAP covers the reported
Tue-bleeds-into-Wed bug, the evening-Pacific backward-rollover, overnight local
windows, invalid-tz fallback, and structured-window returns.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared availability helpers (color, label, outside-predicate)

**Files:**
- Modify: `src/lib/effectiveAvailability.ts`
- Test: `tests/unit/effectiveAvailability.test.ts`

- [ ] **Step 1: Write failing unit tests**

Append to `tests/unit/effectiveAvailability.test.ts`:

```ts
import {
  availabilityColorClasses,
  availabilityLabel,
  shiftOutsideAvailability,
  type EffectiveAvailability,
} from '@/lib/effectiveAvailability';

const avail = (isAvailable: boolean, start: string | null, end: string | null,
               type: EffectiveAvailability['type'] = 'recurring'): EffectiveAvailability => ({
  type,
  slots: type === 'not-set' ? [] : [{ isAvailable, startTime: start, endTime: end, sourceRecord: {} as never }],
});

describe('availabilityColorClasses', () => {
  it('emerald when available, amber for unavailable exception, red for recurring off, neutral when not-set', () => {
    expect(availabilityColorClasses(avail(true, '18:00:00', '02:00:00')).bg).toContain('emerald');
    expect(availabilityColorClasses(avail(false, null, null, 'exception')).bg).toContain('amber');
    expect(availabilityColorClasses(avail(false, null, null, 'recurring')).bg).toContain('red');
    expect(availabilityColorClasses(avail(false, null, null, 'not-set')).bg).toContain('muted');
  });
});

describe('availabilityLabel', () => {
  it('formats an available window in restaurant-local time', () => {
    // 18:00 UTC in America/New_York (EDT) is 2:00 PM on 2027-07-13.
    const label = availabilityLabel(avail(true, '18:00:00', '02:30:00'), 'America/New_York', new Date(2027, 6, 13));
    expect(label).toMatch(/Available 2:00 PM/);
  });
  it('labels unavailable and not-set', () => {
    expect(availabilityLabel(avail(false, null, null, 'recurring'), 'UTC', new Date(2027, 6, 13))).toBe('Unavailable');
    expect(availabilityLabel(avail(false, null, null, 'not-set'), 'UTC', new Date(2027, 6, 13))).toBe('No availability set');
  });
});

describe('shiftOutsideAvailability (TZ-portable)', () => {
  // Employee available 2:00 PM-10:30 PM local (stored UTC-clock, derived below).
  const nyAvail = avail(true, '18:00:00', '02:30:00'); // EDT: 2:00 PM - 10:30 PM
  it('is false when the shift is within the window', () => {
    expect(shiftOutsideAvailability(nyAvail, undefined,
      new Date('2027-07-13T21:00:00Z'), new Date('2027-07-14T01:00:00Z'), 'America/New_York', new Date(2027, 6, 13),
    )).toBe(false); // 5-9 PM EDT
  });
  it('is true when the shift starts before the window', () => {
    expect(shiftOutsideAvailability(nyAvail, undefined,
      new Date('2027-07-13T15:00:00Z'), new Date('2027-07-13T17:00:00Z'), 'America/New_York', new Date(2027, 6, 13),
    )).toBe(true); // 11 AM-1 PM EDT
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- effectiveAvailability`
Expected: FAIL — `availabilityColorClasses`/`availabilityLabel`/`shiftOutsideAvailability` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/effectiveAvailability.ts`:

```ts
import { toZonedTime } from 'date-fns-tz';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';

export interface AvailabilityClasses {
  bg: string;
  text: string;
}

/** Semantic tint for an EffectiveAvailability — identical to TeamAvailabilityGrid. */
export function availabilityColorClasses(effective: EffectiveAvailability): AvailabilityClasses {
  const slot = effective.slots[0];
  const isAvailable = slot?.isAvailable ?? false;
  if (isAvailable) {
    return { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' };
  }
  if (effective.type === 'exception') {
    return { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' };
  }
  if (effective.type === 'recurring') {
    return { bg: 'bg-red-500/5', text: 'text-red-600/70 dark:text-red-400/70' };
  }
  return { bg: 'bg-muted/30', text: 'text-muted-foreground' };
}

function toDisplay(time: string, timezone: string, date: Date): string {
  const local = utcTimeToLocalTime(time, timezone, date); // "HH:MM"
  const [h, m] = local.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Localized one-line label for an EffectiveAvailability cell. */
export function availabilityLabel(effective: EffectiveAvailability, timezone: string, date: Date): string {
  if (effective.type === 'not-set') return 'No availability set';
  const slot = effective.slots[0];
  if (!slot?.isAvailable) return 'Unavailable';
  if (!slot.startTime || !slot.endTime) return 'Available';
  return `Available ${toDisplay(slot.startTime, timezone, date)} – ${toDisplay(slot.endTime, timezone, date)}`;
}

/**
 * True when [shiftStart, shiftEnd] (instants) falls outside the employee's
 * available window(s) for the given local day. Client mirror of the RPC's
 * local-frame logic: trust the stored day_of_week, convert only time-of-day,
 * treat local end <= start as overnight. `prevDay` is the previous local day's
 * EffectiveAvailability (for overnight windows spilling into this day).
 */
function overnightPrevSlots(slots: EffectiveAvailability['slots'], timezone: string, date: Date) {
  return slots.filter((s) => {
    if (!s.isAvailable || !s.startTime || !s.endTime) return false;
    const [sh, sm] = utcTimeToLocalTime(s.startTime, timezone, date).split(':').map(Number);
    const [eh, em] = utcTimeToLocalTime(s.endTime, timezone, date).split(':').map(Number);
    return (eh * 60 + em) <= (sh * 60 + sm); // only overnight prev-day windows spill into today
  });
}

export function shiftOutsideAvailability(
  today: EffectiveAvailability,
  prevDay: EffectiveAvailability | undefined,
  shiftStart: Date,
  shiftEnd: Date,
  timezone: string,
  date: Date,
): boolean {
  // not-set / no data => unknown => not flagged (matches RPC "no conflict").
  const slot = today.slots[0];
  if (today.type === 'not-set') return false;
  if (slot && !slot.isAvailable) return true; // recurring off / unavailable exception

  // Convert the shift INSTANTS to restaurant-local wall clock (NOT host TZ — lesson 2026-05-10).
  const zStart = toZonedTime(shiftStart, timezone);
  const zEnd = toZonedTime(shiftEnd, timezone);
  const startMin = zStart.getHours() * 60 + zStart.getMinutes();
  const dayDelta = Math.round(
    (new Date(zEnd.getFullYear(), zEnd.getMonth(), zEnd.getDate()).getTime() -
      new Date(zStart.getFullYear(), zStart.getMonth(), zStart.getDate()).getTime()) / 86_400_000,
  );
  const endMin = zEnd.getHours() * 60 + zEnd.getMinutes() + dayDelta * 1440;

  const windows: Array<[number, number]> = [];
  const pushWindow = (slots: EffectiveAvailability['slots'], offsetMin: number) => {
    for (const s of slots) {
      if (!s.isAvailable || !s.startTime || !s.endTime) continue;
      const [sh, sm] = utcTimeToLocalTime(s.startTime, timezone, date).split(':').map(Number);
      const [eh, em] = utcTimeToLocalTime(s.endTime, timezone, date).split(':').map(Number);
      let ws = sh * 60 + sm + offsetMin;
      let we = eh * 60 + em + offsetMin;
      if (we <= ws) we += 1440; // overnight local window
      windows.push([ws, we]);
    }
  };
  pushWindow(today.slots, 0);
  if (prevDay) pushWindow(overnightPrevSlots(prevDay.slots, timezone, date), -1440);

  if (windows.length === 0) return false; // available all-day / unknown
  return !windows.some(([ws, we]) => startMin >= ws && endMin <= we);
}
```

> Note: window times use the same `utcTimeToLocalTime(time, timezone, date)` anchoring as the grid and RPC; shift instants use `toZonedTime(instant, timezone)`. Both land in restaurant-local wall clock, so the three paths agree, and the math is host-TZ-independent.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- effectiveAvailability`
Expected: PASS. Then run under alternate TZs to confirm portability:
`TZ=America/Los_Angeles npm run test -- effectiveAvailability` and `TZ=Asia/Tokyo npm run test -- effectiveAvailability` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/effectiveAvailability.ts tests/unit/effectiveAvailability.test.ts
git commit -m "feat(scheduling): shared availability color/label/outside-window helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Refactor `TeamAvailabilityGrid` onto the shared helpers

**Files:**
- Modify: `src/components/scheduling/TeamAvailabilityGrid.tsx`

- [ ] **Step 1: Replace the inline color logic with `availabilityColorClasses`**

In `AvailabilityCell`, delete the local `bgClass`/`textClass` if/else block (lines ~150–163) and replace with:

```ts
const { bg: bgClass, text: textClass } = availabilityColorClasses(effective);
```

Add the import: `import { computeEffectiveAvailability, EffectiveAvailability, availabilityColorClasses } from '@/lib/effectiveAvailability';`

Keep the existing `bgClass` hover suffixes by appending them where used (e.g. the class string already adds `hover:` variants via the returned tokens; if hover variants were previously inline, keep them by composing: `cn(bgClass, 'hover:brightness-105')` is NOT needed — instead have `availabilityColorClasses` return the base tint and keep the cell's existing `hover:bg-*` utility if present). If the current code relies on distinct hover classes, extend `availabilityColorClasses` to include them rather than duplicating here.

- [ ] **Step 2: Run the grid's existing behavior check**

Run: `npm run test -- TeamAvailability || true` (if no test exists, rely on typecheck + Phase 5 visual). Then `npm run typecheck`.
Expected: typecheck PASS; no visual change intended.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/TeamAvailabilityGrid.tsx
git commit -m "refactor(scheduling): TeamAvailabilityGrid uses shared availability color helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire availability into `ShiftPlannerTab`

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1: Fetch exceptions and compute the effective map**

Add import: `import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';`
Add import: `import { computeEffectiveAvailability } from '@/lib/effectiveAvailability';`

Near the existing `const { availability } = useEmployeeAvailability(restaurantId);` add:

```ts
const { exceptions } = useAvailabilityExceptions(restaurantId);

// weekStart is the planner's Monday-normalized week start (already in scope).
const availabilityByEmployee = useMemo(
  () =>
    computeEffectiveAvailability(
      availability ?? [],
      exceptions ?? [],
      weekStart,               // Date — planner week start
      employees.map((e) => e.id),
    ),
  [availability, exceptions, weekStart, employees],
);
```

> If `weekStart` in this file is a `string`, convert with `new Date(weekStart + 'T00:00:00')`. Confirm the local type before wiring; `computeEffectiveAvailability` expects a `Date`.

- [ ] **Step 2: Pass the map + timezone + weekDates to the sidebar and timeline**

`restaurantTimezone` is already computed. Pass new props to `<EmployeeSidebar ... availabilityByEmployee={availabilityByEmployee} timezone={restaurantTimezone} />` and to `<ShiftTimelineTab ... availabilityByEmployee={availabilityByEmployee} />` (Task 7 consumes it).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors only where `EmployeeSidebarProps`/`ShiftTimelineTab` props are not yet declared (fixed in Tasks 5 and 7). Land this task together with Task 5 if the build must stay green between commits; otherwise commit after Task 5.

- [ ] **Step 4: Commit (with Task 5)** — see Task 5 Step 5.

---

## Task 5: `EmployeeSidebar` props + memo comparator

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`

- [ ] **Step 1: Extend `EmployeeSidebarProps`**

```ts
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';

export interface EmployeeSidebarProps {
  employees: Employee[];
  shifts: Shift[];
  weekDays: readonly string[];
  shiftsByEmployee: Map<string, Shift[]>;
  /** Per-employee effective availability for the visible week, keyed by employee id. */
  availabilityByEmployee: Map<string, Map<number, EffectiveAvailability>>;
  /** Restaurant IANA timezone for localizing availability windows. */
  timezone: string;
  className?: string;
  onEmployeeSelect?: (employee: { id: string; name: string }) => void;
  onEmployeePick?: (employeeId: string | null) => void;
  plannerAreaFilter?: string | null;
}
```

- [ ] **Step 2: Thread props to `DraggableEmployee` + update its comparator**

Pass `availabilityByDow={availabilityByEmployee.get(employee.id)}`, `timezone={timezone}`, and the concrete per-day `Date[]` (derive from `weekDays` once: `weekDays.map((d) => new Date(d + 'T00:00:00'))`) into `EmployeeMiniWeek`.

Extend the memo comparator (currently ends at `prev.employeeShifts === next.employeeShifts`) with:

```ts
    && prev.availabilityByDow === next.availabilityByDow
    && prev.timezone === next.timezone
```

(`availabilityByDow` identity is stable because the parent memoizes the whole map — a real availability edit produces a new map, invalidating the row.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS once `EmployeeMiniWeek` accepts the new props (Task 6). Land Tasks 4–6 as a set if intermediate commits must build; otherwise proceed to Task 6 then commit.

- [ ] **Step 4: (moved to Task 6 commit)**

- [ ] **Step 5: Commit Tasks 4+5** (after Task 6 makes it compile)

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx
git commit -m "feat(scheduling): thread effective availability into the planner sidebar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `EmployeeMiniWeek` availability tint + strip aria summary

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx`

- [ ] **Step 1: Accept new props and render the tint**

```ts
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';
import { availabilityColorClasses, availabilityLabel } from '@/lib/effectiveAvailability';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface EmployeeMiniWeekProps {
  weekDays: readonly string[];
  employeeShifts: readonly Shift[];
  availabilityByDow?: Map<number, EffectiveAvailability>;
  timezone?: string;
  dates?: readonly Date[];       // concrete Date per weekDays entry (DST anchor)
  size?: 'sm' | 'md';
}
```

For each day cell, look up `const eff = availabilityByDow?.get(new Date(day + 'T00:00:00').getDay());` (or use the passed `dates[i].getDay()`), then apply `availabilityColorClasses(eff)` `.bg` as the cell background (behind the shift bars). For `unavailable recurring`, add a diagonal hatch via inline style:

```ts
style={{
  ...(effIsRecurringOff
    ? { backgroundImage: 'repeating-linear-gradient(45deg, hsl(var(--destructive) / 0.12) 0 3px, transparent 3px 6px)' }
    : {}),
  height: trackHeight,
}}
```

- [ ] **Step 2: Replace blanket `aria-hidden` with a single strip-level summary**

Wrap the 7-day grid in one focusable element carrying a week summary; keep individual day cells `aria-hidden`:

```tsx
const weekSummary = (dates && timezone && availabilityByDow)
  ? weekDays.map((day, i) => {
      const eff = availabilityByDow.get(dates[i].getDay());
      const dow = dates[i].toLocaleDateString('en-US', { weekday: 'short' });
      return `${dow} ${eff ? availabilityLabel(eff, timezone, dates[i]) : 'No availability set'}`;
    }).join('; ')
  : undefined;

return (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="grid grid-cols-7 gap-0.5 mt-1.5" role="img"
           aria-label={weekSummary ? `Availability — ${weekSummary}` : undefined}>
        {/* existing day cells, each still aria-hidden */}
      </div>
    </TooltipTrigger>
    {weekSummary && <TooltipContent className="max-w-xs text-[12px]">{weekSummary}</TooltipContent>}
  </Tooltip>
);
```

If `availabilityByDow` is undefined (data still loading), render exactly as today (no tint, keep `aria-hidden="true"`) — the three-states rule.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (Tasks 4–6 now compile together).

- [ ] **Step 4: Commit** (Tasks 4+5 staged too, per Task 5 Step 5)

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeMiniWeek.tsx
git commit -m "feat(scheduling): availability tint + accessible week summary on planner sidebar strip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Timeline per-bar outside-availability marker

**Files:**
- Modify: `src/lib/timelineModel.ts`, `src/components/scheduling/ShiftTimeline/useTimelineModel.ts`, `TimelineBar.tsx`, `ShiftTimelineTab.tsx`

- [ ] **Step 1: Add `outsideAvailability` to the model**

In `src/lib/timelineModel.ts`, add `outsideAvailability?: boolean` to `interface TimelineBar`. Thread an
`availabilityByEmployee?: Map<string, Map<number, EffectiveAvailability>>` and `timezone`/`selectedDay`
into the bar-building function; for each bar compute:

```ts
import { shiftOutsideAvailability } from '@/lib/effectiveAvailability';

const dowMap = availabilityByEmployee?.get(s.employee_id);
const date = new Date(dateStr + 'T00:00:00');
const today = dowMap?.get(date.getDay());
const prev = dowMap?.get((date.getDay() + 6) % 7);
const outsideAvailability = today
  ? shiftOutsideAvailability(today, prev, new Date(s.start_time), new Date(s.end_time), tz, date)
  : false;
```

Set `outsideAvailability` on the returned bar object.

- [ ] **Step 2: Pass availability through `useTimelineModel` and `ShiftTimelineTab`**

Add `availabilityByEmployee` to `useTimelineModel(...)`'s signature and forward it to the model builder. In `ShiftTimelineTab`, accept the new `availabilityByEmployee` prop (from Task 4) and pass it into `useTimelineModel`.

- [ ] **Step 3: Render the marker in `TimelineBar`**

When `bar.outsideAvailability` is true, add an amber left border and extend the `aria-label`:

```tsx
className={cn(
  /* existing bar classes */,
  bar.outsideAvailability && 'border-l-2 border-l-amber-500',
)}
aria-label={`${/* existing label */}${bar.outsideAvailability ? ', outside availability' : ''}`}
```

Keep it low-contrast; the shift color remains the fill.

- [ ] **Step 4: Typecheck + build + existing timeline tests**

Run: `npm run typecheck && npm run build && npm run test -- timeline`
Expected: PASS (model tests still green; new field is optional/backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timelineModel.ts src/components/scheduling/ShiftTimeline/useTimelineModel.ts src/components/scheduling/ShiftTimeline/TimelineBar.tsx src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx
git commit -m "feat(scheduling): mark timeline shift bars that fall outside employee availability

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Conflict-dialog "show the hours" verification test

**Files:**
- Test: `tests/unit/conflictFormatUtils.test.ts`

- [ ] **Step 1: Add a partial-availability assertion**

```ts
it('renders the localized available window for a partial-availability conflict', () => {
  const line = formatConflictLine(
    { has_conflict: true, conflict_type: 'recurring',
      message: 'Shift on 2027-07-13 is outside employee availability',
      available_start: '18:00:00', available_end: '02:30:00' } as ConflictCheck,
    'America/New_York',
    new Date(2027, 6, 13),
  );
  expect(line).toMatch(/available 2:00 PM – 10:30 PM/);
});

it('renders the hard-off recurring line without a window', () => {
  const line = formatConflictLine(
    { has_conflict: true, conflict_type: 'recurring',
      message: 'Employee is not available on this day of the week' } as ConflictCheck,
    'America/New_York',
  );
  expect(line).toBe('Employee is not available on this day of the week');
});
```

- [ ] **Step 2: Run**

Run: `npm run test -- conflictFormatUtils`
Expected: PASS (behavior already supported by `formatConflictLine`; this pins the contract Part 1 relies on). If the localized time differs by an hour, confirm the anchor date is passed (DST).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/conflictFormatUtils.test.ts
git commit -m "test(scheduling): pin partial-availability conflict line shows localized hours

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (Phase 8 preview)

Run in the worktree (symlink `.env.local` first):
- `npm run test` — unit (also spot-run `TZ=Asia/Tokyo npm run test -- effectiveAvailability`)
- `npm run test:db` — pgTAP (after `npm run db:reset`)
- `npm run typecheck`
- `npm run lint`
- `npm run build`

All must pass before push.
