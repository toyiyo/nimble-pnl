# Scheduling Conflict Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance scheduling conflict warnings with specific availability hours, add availability warnings to the shift planner, and relax overlap validation from blocking to non-blocking.

**Architecture:** The SQL function `check_availability_conflict` gains two new return columns (`available_start`, `available_end`) so the frontend can format availability windows in local time. The client-side `shiftValidator.ts` moves OVERLAP and TIME_OFF from errors to warnings. The shift planner adds an async availability check on assignment with a confirmation dialog for conflicts.

**Tech Stack:** PostgreSQL (pgTAP tests), TypeScript, React, Supabase RPC, React Query

**Spec:** `docs/superpowers/specs/2026-03-22-scheduling-conflict-enhancements-design.md`

---

### Task 1: Relax shiftValidator overlap/time-off to warnings

Move OVERLAP and TIME_OFF from `errors[]` to `warnings[]` so they no longer block shift creation. This is the simplest change and unblocks the owner/manager use case immediately.

**Files:**
- Modify: `src/lib/shiftValidator.ts:85-101` (overlap check) and `src/lib/shiftValidator.ts:43-68` (time-off check)
- Modify: `tests/unit/shiftValidator.test.ts` (update ~21 assertions)

- [ ] **Step 1: Update shiftValidator — move OVERLAP to warnings**

In `src/lib/shiftValidator.ts`, change the overlap push target from `errors` to `warnings`:

```typescript
// src/lib/shiftValidator.ts — inside the for loop (line ~93)
// BEFORE:
    if (proposed.interval.overlapsWith(existingInterval)) {
      errors.push({
        code: 'OVERLAP',
        message: `Overlaps with existing shift (${formatTime(existing.start_time)} - ${formatTime(existing.end_time)})`,
      });
    }

// AFTER:
    if (proposed.interval.overlapsWith(existingInterval)) {
      warnings.push({
        code: 'OVERLAP',
        message: `Overlaps with existing shift (${formatTime(existing.start_time)} - ${formatTime(existing.end_time)})`,
      });
    }
```

- [ ] **Step 2: Update shiftValidator — move TIME_OFF to warnings**

In `src/lib/shiftValidator.ts`, change `checkTimeOffConflicts` to push to `warnings` instead of `errors`:

```typescript
// src/lib/shiftValidator.ts — checkTimeOffConflicts function signature (line ~43)
// BEFORE:
function checkTimeOffConflicts(
  proposed: { employeeId: string; interval: ShiftInterval },
  timeOffRequests: TimeOffRequest[],
  errors: ValidationIssue[],
): void {

// AFTER:
function checkTimeOffConflicts(
  proposed: { employeeId: string; interval: ShiftInterval },
  timeOffRequests: TimeOffRequest[],
  warnings: ValidationIssue[],
): void {
```

Update the call site in `validateShift` (line ~103):
```typescript
// BEFORE:
  if (options?.timeOffRequests) {
    checkTimeOffConflicts(proposed, options.timeOffRequests, errors);
  }

// AFTER:
  if (options?.timeOffRequests) {
    checkTimeOffConflicts(proposed, options.timeOffRequests, warnings);
  }
```

- [ ] **Step 3: Update tests — overlaps are now warnings, valid is true**

In `tests/unit/shiftValidator.test.ts`, update every test that asserts `result.valid === false` for OVERLAP or TIME_OFF scenarios. The pattern for each:

```typescript
// BEFORE:
expect(result.valid).toBe(false);
expect(result.errors[0].code).toBe('OVERLAP');

// AFTER:
expect(result.valid).toBe(true);
expect(result.warnings.some(w => w.code === 'OVERLAP')).toBe(true);
```

For TIME_OFF tests:
```typescript
// BEFORE:
expect(result.valid).toBe(false);
expect(result.errors.find(e => e.code === 'TIME_OFF')).toBeDefined();

// AFTER:
expect(result.valid).toBe(true);
expect(result.warnings.find(w => w.code === 'TIME_OFF')).toBeDefined();
```

Search for `valid).toBe(false)` in the test file to find all ~21 assertions that need updating. Also update corresponding `result.errors` references to `result.warnings` where the code is OVERLAP or TIME_OFF.

Also update any `result.errors` references to `result.warnings` where the code is OVERLAP or TIME_OFF.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/unit/shiftValidator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/shiftValidator.ts tests/unit/shiftValidator.test.ts
git commit -m "feat: relax overlap and time-off validation to warnings"
```

---

### Task 2: Add structured availability data to SQL function

Update `check_availability_conflict()` to return `available_start`/`available_end` columns with the actual availability window times.

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_conflict_structured_data.sql`
- Create: `supabase/tests/availability_conflict_structured.sql`

- [ ] **Step 1: Write the pgTAP test file**

Create `supabase/tests/availability_conflict_structured.sql`:

```sql
BEGIN;
SELECT plan(6);

-- Setup: create test restaurant and employee
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000099', 'Test Structured Conflict');
INSERT INTO profiles (id, email) VALUES
  ('00000000-0000-0000-0000-000000000199', 'structured@test.com');
INSERT INTO employees (id, restaurant_id, profile_id, first_name, last_name, role, status, pay_type, pay_rate)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        '00000000-0000-0000-0000-000000000199', 'Test', 'Employee', 'staff', 'active', 'hourly', 1500);

-- Setup: recurring availability Mon (dow=1) 14:00-22:00 UTC
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        1, '14:00:00', '22:00:00', true);

-- Setup: recurring unavailable Tue (dow=2)
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        2, '00:00:00', '23:59:00', false);

-- Test 1: Recurring conflict returns available_start/end for the window
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-23 10:00:00+00'::timestamptz,  -- Monday, outside 14:00-22:00
    '2026-03-23 13:00:00+00'::timestamptz
  )$$,
  $$VALUES ('14:00:00'::time, '22:00:00'::time)$$,
  'Recurring conflict returns availability window times'
);

-- Test 2: Recurring unavailable day returns NULL for start/end
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-24 10:00:00+00'::timestamptz,  -- Tuesday, unavailable
    '2026-03-24 18:00:00+00'::timestamptz
  )$$,
  $$VALUES (NULL::time, NULL::time)$$,
  'Unavailable day returns NULL window times'
);

-- Test 3: No conflict returns no rows (available_start/end not relevant)
SELECT is_empty(
  $$SELECT * FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-23 15:00:00+00'::timestamptz,  -- Monday, inside 14:00-22:00
    '2026-03-23 20:00:00+00'::timestamptz
  )$$,
  'No conflict when shift is within availability window'
);

-- Setup: exception on 2026-03-25 (Wed) with specific hours 16:00-20:00
INSERT INTO availability_exceptions (employee_id, restaurant_id, date, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        '2026-03-25', '16:00:00', '20:00:00', true);

-- Test 4: Exception conflict returns exception window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-25 10:00:00+00'::timestamptz,  -- Wed, outside exception 16:00-20:00
    '2026-03-25 15:00:00+00'::timestamptz
  )$$,
  $$VALUES ('16:00:00'::time, '20:00:00'::time)$$,
  'Exception conflict returns exception window times'
);

-- Setup: exception on 2026-03-26 (Thu) fully unavailable
INSERT INTO availability_exceptions (employee_id, restaurant_id, date, is_available, reason)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        '2026-03-26', false, 'Personal day');

-- Test 5: Exception unavailable returns NULL window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-26 10:00:00+00'::timestamptz,
    '2026-03-26 18:00:00+00'::timestamptz
  )$$,
  $$VALUES (NULL::time, NULL::time)$$,
  'Exception unavailable returns NULL window times'
);

-- Setup: overnight window for Sat (dow=6) 22:00-06:00 UTC
INSERT INTO employee_availability (employee_id, restaurant_id, day_of_week, start_time, end_time, is_available)
VALUES ('00000000-0000-0000-0000-000000000299', '00000000-0000-0000-0000-000000000099',
        6, '22:00:00', '06:00:00', true);

-- Test 6: Overnight window conflict returns the overnight window times
SELECT results_eq(
  $$SELECT available_start, available_end FROM check_availability_conflict(
    '00000000-0000-0000-0000-000000000299',
    '00000000-0000-0000-0000-000000000099',
    '2026-03-28 10:00:00+00'::timestamptz,  -- Saturday, outside 22:00-06:00
    '2026-03-28 18:00:00+00'::timestamptz
  )$$,
  $$VALUES ('22:00:00'::time, '06:00:00'::time)$$,
  'Overnight window conflict returns overnight window times'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- supabase/tests/availability_conflict_structured.sql`
Expected: FAIL — function returns 3 columns, tests expect 5

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/YYYYMMDDHHMMSS_conflict_structured_data.sql` (use current timestamp for filename):

```sql
-- Add structured availability window data to conflict detection.
-- Must DROP first because RETURNS TABLE signature is changing.

DROP FUNCTION IF EXISTS check_availability_conflict(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ);

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
) AS $$
DECLARE
  v_start_utc TIMESTAMP WITHOUT TIME ZONE;
  v_end_utc TIMESTAMP WITHOUT TIME ZONE;
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_prev_day_of_week INTEGER;
  v_shift_start_time TIME;
  v_shift_end_time TIME;
  v_exception RECORD;
  v_availability RECORD;
  v_has_availability BOOLEAN;
  v_match_found BOOLEAN;
  v_last_window_start TIME;
  v_last_window_end TIME;
BEGIN
  v_start_utc := p_start_time AT TIME ZONE 'UTC';
  v_end_utc := p_end_time AT TIME ZONE 'UTC';
  v_current_date := v_start_utc::DATE;
  IF v_end_utc::TIME = '00:00:00'::TIME AND v_end_utc > v_start_utc THEN
    v_end_date := (v_end_utc - INTERVAL '1 day')::DATE;
  ELSE
    v_end_date := v_end_utc::DATE;
  END IF;

  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_prev_day_of_week := EXTRACT(DOW FROM v_current_date - INTERVAL '1 day');

    IF v_current_date = v_start_utc::DATE AND v_current_date = v_end_utc::DATE THEN
      v_shift_start_time := v_start_utc::TIME;
      v_shift_end_time := v_end_utc::TIME;
    ELSIF v_current_date = v_start_utc::DATE THEN
      v_shift_start_time := v_start_utc::TIME;
      v_shift_end_time := '23:59:59'::TIME;
    ELSIF v_current_date = v_end_utc::DATE THEN
      v_shift_start_time := '00:00:00'::TIME;
      v_shift_end_time := v_end_utc::TIME;
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
          COALESCE(' (' || v_exception.reason || ')', ''),
          NULL::TIME, NULL::TIME;
        RETURN;
      ELSIF v_exception.start_time IS NOT NULL THEN
        IF NOT time_within_window(v_shift_start_time, v_shift_end_time,
                                  v_exception.start_time, v_exception.end_time) THEN
          RETURN QUERY SELECT true, 'exception'::TEXT,
            'Shift on ' || v_current_date::TEXT || ' is outside employee availability window (' ||
            v_exception.start_time::TEXT || ' - ' || v_exception.end_time::TEXT || ')',
            v_exception.start_time, v_exception.end_time;
          RETURN;
        END IF;
      END IF;
    ELSE
      v_has_availability := false;
      v_match_found := false;
      v_last_window_start := NULL;
      v_last_window_end := NULL;

      FOR v_availability IN
        SELECT * FROM employee_availability
        WHERE employee_id = p_employee_id
          AND restaurant_id = p_restaurant_id
          AND day_of_week = v_day_of_week
      LOOP
        v_has_availability := true;
        IF NOT v_availability.is_available THEN
          RETURN QUERY SELECT true, 'recurring'::TEXT,
            'Employee is not available on this day of the week',
            NULL::TIME, NULL::TIME;
          RETURN;
        END IF;

        -- Store this window in case we need it for the conflict message
        v_last_window_start := v_availability.start_time;
        v_last_window_end := v_availability.end_time;

        IF time_within_window(v_shift_start_time, v_shift_end_time,
                              v_availability.start_time, v_availability.end_time) THEN
          v_match_found := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_match_found THEN
        FOR v_availability IN
          SELECT * FROM employee_availability
          WHERE employee_id = p_employee_id
            AND restaurant_id = p_restaurant_id
            AND day_of_week = v_prev_day_of_week
            AND is_available = true
            AND end_time < start_time
        LOOP
          v_has_availability := true;
          IF v_shift_start_time >= '00:00:00'::TIME AND v_shift_end_time <= v_availability.end_time THEN
            v_match_found := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_has_availability AND NOT v_match_found THEN
        RETURN QUERY SELECT true, 'recurring'::TEXT,
          'Shift on ' || v_current_date::TEXT || ' is outside employee availability',
          v_last_window_start, v_last_window_end;
        RETURN;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
```

- [ ] **Step 4: Reset database and run tests**

Run: `npm run db:reset && npm run test:db -- supabase/tests/availability_conflict_structured.sql`
Expected: All 6 tests PASS

Also run existing overnight tests to ensure no regression:
Run: `npm run test:db -- supabase/tests/availability_overnight.sql`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_conflict_structured_data.sql supabase/tests/availability_conflict_structured.sql
git commit -m "feat: add availability window times to conflict detection SQL"
```

---

### Task 3: Update TypeScript types and conflict detection hook

Pass the new `available_start`/`available_end` data through the frontend types and hook.

**Files:**
- Modify: `src/types/scheduling.ts:179-187` (ConflictCheck interface)
- Modify: `src/hooks/useConflictDetection.tsx:20-24` (AvailabilityConflictResponse interface)
- Modify: `src/hooks/useConflictDetection.tsx:69-76` (conflict mapping)

- [ ] **Step 1: Update ConflictCheck type**

In `src/types/scheduling.ts`, add optional fields to `ConflictCheck`:

```typescript
export interface ConflictCheck {
  has_conflict: boolean;
  conflict_type?: 'recurring' | 'exception' | 'time-off';
  message?: string;
  time_off_id?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  available_start?: string; // TIME format (HH:MM:SS) in UTC
  available_end?: string;   // TIME format (HH:MM:SS) in UTC
}
```

- [ ] **Step 2: Update AvailabilityConflictResponse interface**

In `src/hooks/useConflictDetection.tsx`, update the response interface:

```typescript
interface AvailabilityConflictResponse {
  has_conflict: boolean;
  conflict_type: 'recurring' | 'exception';
  message: string;
  available_start: string | null;
  available_end: string | null;
}
```

- [ ] **Step 3: Pass new fields through conflict mapping**

In `src/hooks/useConflictDetection.tsx`, update the mapping inside the `forEach` (line ~70):

```typescript
availabilityConflicts.forEach((conflict: AvailabilityConflictResponse) => {
  conflicts.push({
    has_conflict: true,
    conflict_type: conflict.conflict_type,
    message: conflict.message,
    available_start: conflict.available_start ?? undefined,
    available_end: conflict.available_end ?? undefined,
  });
});
```

- [ ] **Step 4: Export ConflictCheckParams**

Add `export` to the `ConflictCheckParams` interface (line 5) so it can be referenced by callers of `checkConflictsImperative`:

```typescript
export interface ConflictCheckParams {
```

- [ ] **Step 5: Add imperative conflict check function**

Add a new export to `src/hooks/useConflictDetection.tsx` for on-demand (non-reactive) conflict checking, used by the planner:

```typescript
export async function checkConflictsImperative(
  params: ConflictCheckParams
): Promise<{ conflicts: ConflictCheck[]; hasConflicts: boolean }> {
  const conflicts: ConflictCheck[] = [];

  // Check time-off conflicts
  const { data: timeOffConflicts, error: timeOffError } = await supabase
    .rpc('check_timeoff_conflict', {
      p_employee_id: params.employeeId,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
    });

  if (timeOffError) throw timeOffError;

  if (timeOffConflicts && timeOffConflicts.length > 0) {
    timeOffConflicts.forEach((conflict: TimeOffConflictResponse) => {
      conflicts.push({
        has_conflict: true,
        conflict_type: 'time-off',
        message: `Employee has ${conflict.status} time-off from ${conflict.start_date} to ${conflict.end_date}`,
        time_off_id: conflict.time_off_id,
        start_date: conflict.start_date,
        end_date: conflict.end_date,
        status: conflict.status,
      });
    });
  }

  // Check availability conflicts
  const { data: availabilityConflicts, error: availError } = await supabase
    .rpc('check_availability_conflict', {
      p_employee_id: params.employeeId,
      p_restaurant_id: params.restaurantId,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
    });

  if (availError) throw availError;

  if (availabilityConflicts && availabilityConflicts.length > 0) {
    availabilityConflicts.forEach((conflict: AvailabilityConflictResponse) => {
      conflicts.push({
        has_conflict: true,
        conflict_type: conflict.conflict_type,
        message: conflict.message,
        available_start: conflict.available_start ?? undefined,
        available_end: conflict.available_end ?? undefined,
      });
    });
  }

  return { conflicts, hasConflicts: conflicts.length > 0 };
}
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/types/scheduling.ts src/hooks/useConflictDetection.tsx
git commit -m "feat: pass structured availability window data through conflict types"
```

---

### Task 4: Format availability hours in ShiftDialog

Update the ShiftDialog to display availability conflicts with actual hours converted to local time.

**Files:**
- Modify: `src/components/ShiftDialog.tsx:19-26` (props interface)
- Modify: `src/components/ShiftDialog.tsx:417-435` (conflict display)
- Modify: `src/pages/Scheduling.tsx:1290-1295` (pass timezone prop)

- [ ] **Step 1: Add timezone prop to ShiftDialog**

In `src/components/ShiftDialog.tsx`, add `timezone` to the props interface:

```typescript
interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift & { _editScope?: RecurringActionScope };
  restaurantId: string;
  timezone?: string; // Restaurant timezone for formatting availability times
  defaultDate?: Date;
  defaultEmployee?: DefaultEmployee;
}
```

Update the destructured props in the component function to include `timezone = 'UTC'`.

- [ ] **Step 2: Create shared time formatting utility**

Create `src/lib/conflictFormatUtils.ts` with shared helpers used by both ShiftDialog and AvailabilityConflictDialog:

```typescript
import type { ConflictCheck } from '@/types/scheduling';

/**
 * Format a UTC TIME string (HH:MM:SS) to local time display.
 * Creates a reference date in UTC with the given time, then formats in the target timezone.
 */
export function formatUTCTimeToLocal(utcTime: string, timezone: string): string {
  const [hours, minutes] = utcTime.split(':').map(Number);
  const refDate = new Date(Date.UTC(2026, 0, 1, hours, minutes, 0));
  return refDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

export function formatConflictLine(conflict: ConflictCheck, timezone: string): string {
  if (conflict.conflict_type === 'time-off') {
    return conflict.message || 'Time-off conflict';
  }

  if (conflict.available_start && conflict.available_end) {
    const start = formatUTCTimeToLocal(conflict.available_start, timezone);
    const end = formatUTCTimeToLocal(conflict.available_end, timezone);
    const dateMatch = conflict.message?.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const date = new Date(dateMatch[0] + 'T00:00:00');
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `Shift on ${dayLabel} is outside availability (available ${start} – ${end})`;
    }
    return `Outside availability window (available ${start} – ${end})`;
  }

  const dateMatch = conflict.message?.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    const date = new Date(dateMatch[0] + 'T00:00:00');
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return conflict.message!.replace(dateMatch[0], dayLabel);
  }

  return conflict.message || 'Scheduling conflict';
}
```

- [ ] **Step 3: Add formatConflictMessage to ShiftDialog**

In `ShiftDialog.tsx`, import the shared utility and use it:

```typescript
import { formatConflictLine } from '@/lib/conflictFormatUtils';
```

The `formatConflictMessage` function in ShiftDialog simply delegates to `formatConflictLine`:

```typescript
function formatConflictMessage(conflict: ConflictCheck, timezone: string): string {
  if (conflict.conflict_type === 'time-off') {
    return conflict.message || 'Time-off conflict';
  }

  // If we have structured availability window data, format with local times
  if (conflict.available_start && conflict.available_end) {
    const start = formatUTCTimeToLocal(conflict.available_start, timezone);
    const end = formatUTCTimeToLocal(conflict.available_end, timezone);

    // Extract the date from the message if present (e.g., "Shift on 2026-03-18...")
    const dateMatch = conflict.message?.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const date = new Date(dateMatch[0] + 'T00:00:00');
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `Shift on ${dayLabel} is outside availability (available ${start} – ${end})`;
    }
    return `Outside availability window (available ${start} – ${end})`;
  }

  // Fallback: format the date nicely if present, otherwise use raw message
  const dateMatch = conflict.message?.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    const date = new Date(dateMatch[0] + 'T00:00:00');
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return conflict.message!.replace(dateMatch[0], dayLabel);
  }

  return formatConflictLine(conflict, timezone);
}
```

- [ ] **Step 4: Update the conflict display in ShiftDialog**

Replace the conflict rendering block (lines ~417-435):

```typescript
{/* Conflict Warnings */}
{hasConflicts && (
  <Alert variant="destructive">
    <AlertTriangle className="h-4 w-4" />
    <AlertDescription>
      <div className="space-y-1">
        <p className="font-semibold">Scheduling conflicts detected:</p>
        {conflicts.map((conflict) => {
          const conflictKey = conflict.time_off_id
            ? `timeoff-${conflict.time_off_id}`
            : `${conflict.conflict_type}-${conflict.message}`;
          return (
            <p key={conflictKey} className="text-sm">
              • {formatConflictMessage(conflict, timezone)}
            </p>
          );
        })}
      </div>
    </AlertDescription>
  </Alert>
)}
```

- [ ] **Step 5: Pass timezone from Scheduling page**

In `src/pages/Scheduling.tsx`, add the `timezone` prop to the ShiftDialog (around line ~1290):

```typescript
<ShiftDialog
  open={shiftDialogOpen}
  onOpenChange={setShiftDialogOpen}
  shift={selectedShift}
  restaurantId={restaurantId}
  timezone={restaurantTimezone}
  defaultDate={defaultShiftDate}
  defaultEmployee={defaultShiftEmployee}
/>
```

- [ ] **Step 6: Add ConflictCheck import**

In `ShiftDialog.tsx`, add `ConflictCheck` to the existing import from `@/types/scheduling`:

```typescript
import { Shift, RecurrencePattern, RecurrenceType, ConflictCheck } from '@/types/scheduling';
```

- [ ] **Step 7: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/conflictFormatUtils.ts src/components/ShiftDialog.tsx src/pages/Scheduling.tsx
git commit -m "feat: display availability hours in local time for scheduling conflicts"
```

---

### Task 5: Add AvailabilityConflictDialog component

Create the confirmation dialog shown in the planner when availability/overlap conflicts are detected.

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx`:

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';
import { formatConflictLine } from '@/lib/conflictFormatUtils';

export interface ConflictDialogData {
  employeeName: string;
  conflicts: ConflictCheck[];
  warnings: ValidationIssue[];
}

interface AvailabilityConflictDialogProps {
  open: boolean;
  data: ConflictDialogData | null;
  timezone: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AvailabilityConflictDialog({
  open,
  data,
  timezone,
  onConfirm,
  onCancel,
}: Readonly<AvailabilityConflictDialogProps>) {
  if (!data) return null;

  const allIssues: string[] = [
    ...data.warnings.map((w) => w.message),
    ...data.conflicts.map((c) => formatConflictLine(c, timezone)),
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Scheduling Warning
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {data.employeeName} has conflicts with this assignment
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          <div className="space-y-2">
            {allIssues.map((issue, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[13px] text-foreground">{issue}</p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 pt-0 gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Assign Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors (component is created but not yet wired up)

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx
git commit -m "feat: add availability conflict confirmation dialog component"
```

---

### Task 6: Wire up conflict checking in shift planner

Integrate the availability/time-off RPC checks and confirmation dialog into the planner's assignment flow.

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts:344-393` (validateAndCreate)
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:128-182` (handleAssignDay, handleAssignAll)

- [ ] **Step 1: Update useShiftPlanner return types and add forceCreate**

In `src/hooks/useShiftPlanner.ts`, add imports and update the interface:

```typescript
// Add import at top
import { checkConflictsImperative } from '@/hooks/useConflictDetection';
import type { ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';
```

Add a new type for the create input:

```typescript
export interface ShiftCreateInput {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  position: string;
  breakDuration?: number;
  notes?: string;
}
```

Update `UseShiftPlannerReturn` interface — change `validateAndCreate` return type and add new members:

```typescript
export interface UseShiftPlannerReturn {
  // ... existing fields unchanged ...

  // Mutations
  validateAndCreate: (input: ShiftCreateInput) => Promise<{
    created: boolean;
    pendingConflicts?: ConflictCheck[];
    pendingWarnings?: ValidationIssue[];
    pendingInput?: ShiftCreateInput;
  }>;
  forceCreate: (input: ShiftCreateInput) => Promise<boolean>;
  // ... rest unchanged ...
}
```

- [ ] **Step 2: Implement updated validateAndCreate with conflict checking**

Replace the `validateAndCreate` callback in `useShiftPlanner.ts`:

```typescript
const validateAndCreate = useCallback(
  async (input: ShiftCreateInput) => {
    if (!restaurantId) return { created: false };

    try {
      const interval = ShiftInterval.create(
        input.date,
        input.startTime,
        input.endTime,
      );

      const result = validateShift(
        { employeeId: input.employeeId, interval },
        shifts,
      );

      setValidationResult(result);

      // Collect client-side warnings
      const clientWarnings = [...result.warnings];

      // Check availability/time-off conflicts via RPC
      const { conflicts } = await checkConflictsImperative({
        employeeId: input.employeeId,
        restaurantId,
        startTime: interval.startAt.toISOString(),
        endTime: interval.endAt.toISOString(),
      });

      // If any warnings or conflicts, return them for confirmation dialog
      if (clientWarnings.length > 0 || conflicts.length > 0) {
        return {
          created: false,
          pendingConflicts: conflicts,
          pendingWarnings: clientWarnings,
          pendingInput: input,
        };
      }

      // No issues — create immediately
      await createShift.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: input.employeeId,
        start_time: interval.startAt.toISOString(),
        end_time: interval.endAt.toISOString(),
        position: input.position,
        break_duration: input.breakDuration ?? 0,
        notes: input.notes,
        status: 'scheduled',
        is_published: false,
        locked: false,
      });

      setValidationResult(null);
      return { created: true };
    } catch (err) {
      setValidationResult(errorToValidationResult(err, 'Invalid shift'));
      return { created: false };
    }
  },
  [restaurantId, shifts, createShift],
);
```

- [ ] **Step 3: Add forceCreate method**

Add after `validateAndCreate`:

```typescript
const forceCreate = useCallback(
  async (input: ShiftCreateInput): Promise<boolean> => {
    if (!restaurantId) return false;

    try {
      const interval = ShiftInterval.create(
        input.date,
        input.startTime,
        input.endTime,
      );

      await createShift.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: input.employeeId,
        start_time: interval.startAt.toISOString(),
        end_time: interval.endAt.toISOString(),
        position: input.position,
        break_duration: input.breakDuration ?? 0,
        notes: input.notes,
        status: 'scheduled',
        is_published: false,
        locked: false,
      });

      setValidationResult(null);
      return true;
    } catch (err) {
      setValidationResult(errorToValidationResult(err, 'Failed to create shift'));
      return false;
    }
  },
  [restaurantId, createShift],
);
```

Add `forceCreate` to the return object.

- [ ] **Step 4: Update ShiftPlannerTab — add conflict dialog state and handlers**

In `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`, add imports and state:

```typescript
// Add imports
import { AvailabilityConflictDialog } from './AvailabilityConflictDialog';
import type { ConflictDialogData } from './AvailabilityConflictDialog';
import type { ShiftCreateInput } from '@/hooks/useShiftPlanner';
import type { ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';
```

Add to destructured return from `useShiftPlanner`:
```typescript
const { ..., forceCreate } = useShiftPlanner(restaurantId);
```

Add state for conflict dialog:
```typescript
const [conflictDialogData, setConflictDialogData] = useState<ConflictDialogData | null>(null);
const [conflictPendingInputs, setConflictPendingInputs] = useState<ShiftCreateInput[]>([]);
const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
```

- [ ] **Step 5: Update handleAssignDay to use conflict dialog**

Replace `handleAssignDay`:

```typescript
const handleAssignDay = useCallback(async () => {
  if (!pendingAssignment) return;
  const { employee, template, day } = pendingAssignment;
  setPendingAssignment(null);

  const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
  const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

  const input: ShiftCreateInput = {
    employeeId: employee.id,
    date: day,
    startTime: startHHMM,
    endTime: endHHMM,
    position: template.position,
    breakDuration: template.break_duration,
  };

  const result = await validateAndCreate(input);

  if (result.created) {
    clearValidation();
    setHighlightCellId(`${template.id}:${day}`);
    setTimeout(() => setHighlightCellId(null), 600);
    const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    toast({ title: `${employee.name} assigned to ${template.name} — ${dayLabel}` });
  } else if (result.pendingConflicts || result.pendingWarnings) {
    setConflictDialogData({
      employeeName: employee.name,
      conflicts: result.pendingConflicts || [],
      warnings: result.pendingWarnings || [],
    });
    setConflictPendingInputs([input]);
  }
}, [pendingAssignment, validateAndCreate, clearValidation, toast]);
```

- [ ] **Step 6: Update handleAssignAll to batch conflict checking**

Replace `handleAssignAll`:

```typescript
const handleAssignAll = useCallback(async () => {
  if (!pendingAssignment) return;
  const { employee, template } = pendingAssignment;
  setPendingAssignment(null);

  const activeDays = getActiveDaysForWeek(template, weekDays);
  const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
  const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

  const allInputs: ShiftCreateInput[] = activeDays.map((day) => ({
    employeeId: employee.id,
    date: day,
    startTime: startHHMM,
    endTime: endHHMM,
    position: template.position,
    breakDuration: template.break_duration,
  }));

  // Check all days, collect conflicts
  const allConflicts: ConflictCheck[] = [];
  const allWarnings: ValidationIssue[] = [];
  const conflictedInputs: ShiftCreateInput[] = [];
  let createdCount = 0;

  for (const input of allInputs) {
    const result = await validateAndCreate(input);
    if (result.created) {
      createdCount++;
    } else if (result.pendingConflicts || result.pendingWarnings) {
      allConflicts.push(...(result.pendingConflicts || []));
      allWarnings.push(...(result.pendingWarnings || []));
      conflictedInputs.push(input);
    }
    // else: hard failure (network error etc.) — skip silently, user sees toast below
  }

  if (conflictedInputs.length > 0) {
    setConflictDialogData({
      employeeName: employee.name,
      conflicts: allConflicts,
      warnings: allWarnings,
    });
    setConflictPendingInputs(conflictedInputs);
    if (createdCount > 0) {
      toast({ title: `${createdCount} day(s) assigned, ${conflictedInputs.length} day(s) need confirmation` });
    }
  } else {
    clearValidation();
    toast({
      title: `${employee.name} assigned to ${template.name} — ${createdCount}/${allInputs.length} days`,
    });
  }
}, [pendingAssignment, weekDays, validateAndCreate, clearValidation, toast]);
```

- [ ] **Step 7: Add conflict dialog handlers and render**

Add handlers:

```typescript
const handleConflictConfirm = useCallback(async () => {
  let successCount = 0;
  for (const input of conflictPendingInputs) {
    const success = await forceCreate(input);
    if (success) successCount++;
  }
  setConflictDialogData(null);
  setConflictPendingInputs([]);
  clearValidation();
  if (successCount > 0) {
    toast({ title: `${successCount} shift${successCount > 1 ? 's' : ''} assigned despite warnings` });
  }
}, [conflictPendingInputs, forceCreate, clearValidation, toast]);

const handleConflictCancel = useCallback(() => {
  setConflictDialogData(null);
  setConflictPendingInputs([]);
}, []);
```

Add the dialog to the JSX (after `PlannerExportDialog` or at the end):

```tsx
<AvailabilityConflictDialog
  open={conflictDialogData !== null}
  data={conflictDialogData}
  timezone={restaurantTimezone}
  onConfirm={handleConflictConfirm}
  onCancel={handleConflictCancel}
/>
```

- [ ] **Step 8: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useShiftPlanner.ts src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat: add availability conflict checking and confirmation dialog to shift planner"
```

---

### Task 7: Final verification

Run all tests and lint to ensure nothing is broken.

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `npm run test`
Expected: All tests PASS

- [ ] **Step 2: Run database tests**

Run: `npm run test:db`
Expected: All pgTAP tests PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new errors (existing lint errors are pre-existing)

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 5: Commit any fixups if needed, then tag complete**
