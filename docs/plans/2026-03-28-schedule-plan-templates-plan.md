# Schedule Plan Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow managers to save a week's schedule as a named template and apply it to future weeks, integrated into the existing Copy Week dialog.

**Architecture:** New `schedule_plan_templates` table stores JSONB snapshots of weekly shifts (day_offset + TIME values). Save RPC uses advisory lock for 5-template limit. Apply is client-driven: the hook reads the template, builds DST-safe timestamptz payloads using `buildShiftsFromTemplate()` (same pattern as `copyWeekShifts.ts`), then calls `apply_schedule_plan_template` RPC with pre-computed timestamps. The existing CopyWeekDialog gets Apple-style underline tabs.

**Tech Stack:** PostgreSQL (RPC, RLS), React, TypeScript, React Query, shadcn/ui, TailwindCSS

**Spec:** `docs/plans/2026-03-24-schedule-plan-templates-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260328100000_schedule_plan_templates.sql` | Table, RLS, save/delete RPCs, apply RPC |
| Create | `supabase/tests/schedule_plan_templates.test.sql` | pgTAP tests for all RPCs |
| Create | `src/lib/schedulePlanTemplates.ts` | `buildTemplateSnapshot()` + `buildShiftsFromTemplate()` utilities |
| Create | `tests/unit/schedulePlanTemplates.test.ts` | Unit tests for both utilities |
| Create | `src/hooks/useSchedulePlanTemplates.ts` | React Query hook for CRUD |
| Modify | `src/types/scheduling.ts` | Add `SchedulePlanTemplate`, `TemplateShiftSnapshot`, `ApplyTemplateResult` types |
| Modify | `src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx` | Add tabs, template list, save/apply UI |

---

## Task 1: Database Migration — Table + RLS + RPCs

**Files:**
- Create: `supabase/migrations/20260328100000_schedule_plan_templates.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Schedule Plan Templates: save/apply weekly schedule snapshots

-- 1. Table
CREATE TABLE schedule_plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shifts JSONB NOT NULL,
  shift_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_plan_templates_restaurant
  ON schedule_plan_templates(restaurant_id);

CREATE TRIGGER update_schedule_plan_templates_updated_at
  BEFORE UPDATE ON schedule_plan_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. RLS
ALTER TABLE schedule_plan_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant templates"
  ON schedule_plan_templates FOR SELECT
  USING (restaurant_id IN (
    SELECT restaurant_id FROM restaurant_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert their restaurant templates"
  ON schedule_plan_templates FOR INSERT
  WITH CHECK (restaurant_id IN (
    SELECT restaurant_id FROM restaurant_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete their restaurant templates"
  ON schedule_plan_templates FOR DELETE
  USING (restaurant_id IN (
    SELECT restaurant_id FROM restaurant_members WHERE user_id = auth.uid()
  ));

-- 3. Save RPC — advisory lock prevents TOCTOU race on empty table
CREATE OR REPLACE FUNCTION save_schedule_plan_template(
  p_restaurant_id UUID,
  p_name TEXT,
  p_shifts JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_shift_count INT;
  v_result schedule_plan_templates%ROWTYPE;
BEGIN
  v_shift_count := jsonb_array_length(p_shifts);
  IF v_shift_count = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty schedule template';
  END IF;

  -- Advisory lock keyed to restaurant_id — works even when table is empty
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_restaurant_id::text || '_sched_tmpl'), 1, 16))::bit(64)::bigint
  );

  SELECT count(*) INTO v_count
  FROM schedule_plan_templates
  WHERE restaurant_id = p_restaurant_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Maximum of 5 schedule templates allowed. Delete one to save a new one.';
  END IF;

  INSERT INTO schedule_plan_templates (restaurant_id, name, shifts, shift_count)
  VALUES (p_restaurant_id, p_name, p_shifts, v_shift_count)
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'id', v_result.id,
    'name', v_result.name,
    'shift_count', v_result.shift_count,
    'created_at', v_result.created_at
  );
END;
$$;

-- 4. Apply RPC — accepts pre-computed timestamptz shifts from client (DST-safe)
-- Pattern matches copy_week_shifts: client builds timestamps, server does atomic insert.
CREATE OR REPLACE FUNCTION apply_schedule_plan_template(
  p_restaurant_id UUID,
  p_target_start TIMESTAMPTZ,
  p_target_end   TIMESTAMPTZ,
  p_shifts       JSONB,
  p_merge_mode   TEXT DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_inserted_count INT := 0;
  v_total INT;
BEGIN
  v_total := jsonb_array_length(p_shifts);

  -- Replace mode: delete unlocked shifts in target range (same as copy_week_shifts)
  IF p_merge_mode = 'replace' THEN
    DELETE FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND locked = false
      AND start_time >= p_target_start
      AND start_time <= p_target_end;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Insert all shifts
    INSERT INTO shifts (
      restaurant_id, employee_id, start_time, end_time,
      break_duration, position, notes, status, is_published, locked
    )
    SELECT
      p_restaurant_id,
      (elem->>'employee_id')::uuid,
      (elem->>'start_time')::timestamptz,
      (elem->>'end_time')::timestamptz,
      (elem->>'break_duration')::int,
      elem->>'position',
      NULLIF(elem->>'notes', 'null'),
      'scheduled',
      false,
      false
    FROM jsonb_array_elements(p_shifts) AS elem;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  ELSIF p_merge_mode = 'merge' THEN
    -- Merge: insert only non-overlapping shifts
    INSERT INTO shifts (
      restaurant_id, employee_id, start_time, end_time,
      break_duration, position, notes, status, is_published, locked
    )
    SELECT
      p_restaurant_id,
      (elem->>'employee_id')::uuid,
      (elem->>'start_time')::timestamptz,
      (elem->>'end_time')::timestamptz,
      (elem->>'break_duration')::int,
      elem->>'position',
      NULLIF(elem->>'notes', 'null'),
      'scheduled',
      false,
      false
    FROM jsonb_array_elements(p_shifts) AS elem
    WHERE NOT EXISTS (
      SELECT 1 FROM shifts s
      WHERE s.restaurant_id = p_restaurant_id
        AND s.employee_id = (elem->>'employee_id')::uuid
        AND s.start_time < (elem->>'end_time')::timestamptz
        AND s.end_time > (elem->>'start_time')::timestamptz
    );

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid merge_mode: %. Use replace or merge.', p_merge_mode;
  END IF;

  RETURN jsonb_build_object(
    'inserted_count', v_inserted_count,
    'skipped_count', v_total - v_inserted_count,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- 5. Delete RPC — raises exception if not found
CREATE OR REPLACE FUNCTION delete_schedule_plan_template(
  p_restaurant_id UUID,
  p_template_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM schedule_plan_templates
  WHERE id = p_template_id AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
END;
$$;
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db reset`
Expected: Migration applies without errors

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260328100000_schedule_plan_templates.sql
git commit -m "feat: add schedule_plan_templates table and RPCs"
```

---

## Task 2: pgTAP Database Tests

**Files:**
- Create: `supabase/tests/schedule_plan_templates.test.sql`

- [ ] **Step 1: Write pgTAP tests**

```sql
BEGIN;
SELECT plan(15);

-- Setup: create test restaurant and employees
INSERT INTO restaurants (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Restaurant');

INSERT INTO employees (id, restaurant_id, name, position, status, hourly_rate) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice', 'Server', 'active', 15.00),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Bob', 'Cook', 'active', 18.00),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Inactive Ike', 'Server', 'inactive', 15.00);

-- Test 1: Save template - happy path
SELECT lives_ok(
  $$SELECT save_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Standard Week',
    '[{"day_offset":0,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb
  )$$,
  'Save template succeeds'
);

-- Test 2: Verify template was saved
SELECT is(
  (SELECT count(*)::int FROM schedule_plan_templates WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Template count is 1'
);

-- Test 3: Save empty shifts fails
SELECT throws_ok(
  $$SELECT save_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Empty',
    '[]'::jsonb
  )$$,
  'Cannot save an empty schedule template'
);

-- Test 4: 5-template limit (save 4 more, already have 1)
SELECT lives_ok($$SELECT save_schedule_plan_template('aaaaaaaa-0000-0000-0000-000000000001', 'T2', '[{"day_offset":1,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb)$$, 'Save template 2');
SELECT lives_ok($$SELECT save_schedule_plan_template('aaaaaaaa-0000-0000-0000-000000000001', 'T3', '[{"day_offset":2,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb)$$, 'Save template 3');
SELECT lives_ok($$SELECT save_schedule_plan_template('aaaaaaaa-0000-0000-0000-000000000001', 'T4', '[{"day_offset":3,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb)$$, 'Save template 4');
SELECT lives_ok($$SELECT save_schedule_plan_template('aaaaaaaa-0000-0000-0000-000000000001', 'T5', '[{"day_offset":4,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb)$$, 'Save template 5');

-- Test 5: 6th template fails
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('aaaaaaaa-0000-0000-0000-000000000001', 'T6', '[{"day_offset":5,"start_time":"09:00:00","end_time":"17:00:00","break_duration":30,"position":"Server","employee_id":"bbbbbbbb-0000-0000-0000-000000000001","employee_name":"Alice","notes":null}]'::jsonb)$$,
  'Maximum of 5 schedule templates allowed. Delete one to save a new one.'
);

-- Test 6: Apply template (replace mode) — inserts shifts
SELECT lives_ok(
  $$SELECT apply_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-03-30T00:00:00Z'::timestamptz,
    '2026-04-05T23:59:59Z'::timestamptz,
    '[{"employee_id":"bbbbbbbb-0000-0000-0000-000000000001","start_time":"2026-03-30T09:00:00Z","end_time":"2026-03-30T17:00:00Z","break_duration":30,"position":"Server","notes":null}]'::jsonb,
    'replace'
  )$$,
  'Apply template (replace) succeeds'
);

-- Test 7: Verify shift was inserted
SELECT is(
  (SELECT count(*)::int FROM shifts WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND start_time >= '2026-03-30' AND start_time < '2026-04-06'),
  1,
  'One shift inserted by apply'
);

-- Test 8: Replace mode preserves locked shifts
-- Insert a locked shift in target week
INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, break_duration, position, status, locked)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-03-31T10:00:00Z', '2026-03-31T18:00:00Z', 30, 'Cook', 'scheduled', true);

SELECT is(
  (SELECT (apply_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-03-30T00:00:00Z'::timestamptz,
    '2026-04-05T23:59:59Z'::timestamptz,
    '[{"employee_id":"bbbbbbbb-0000-0000-0000-000000000001","start_time":"2026-03-30T09:00:00Z","end_time":"2026-03-30T17:00:00Z","break_duration":30,"position":"Server","notes":null}]'::jsonb,
    'replace'
  ))->>'deleted_count'),
  '1',
  'Replace mode deletes 1 unlocked shift, preserves locked'
);

-- Verify locked shift still exists
SELECT is(
  (SELECT count(*)::int FROM shifts WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND locked = true),
  1,
  'Locked shift preserved after replace'
);

-- Test 9: Merge mode — skips overlapping, inserts non-overlapping
-- Clear unlocked shifts
DELETE FROM shifts WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND locked = false;

-- Insert an existing shift Mon 9-17
INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, break_duration, position, status, locked)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-04-06T09:00:00Z', '2026-04-06T17:00:00Z', 30, 'Server', 'scheduled', false);

-- Apply with merge: one overlapping (Mon 9-17 same employee) + one non-overlapping (Tue 9-17)
SELECT is(
  (SELECT (apply_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-04-06T00:00:00Z'::timestamptz,
    '2026-04-12T23:59:59Z'::timestamptz,
    '[{"employee_id":"bbbbbbbb-0000-0000-0000-000000000001","start_time":"2026-04-06T09:00:00Z","end_time":"2026-04-06T17:00:00Z","break_duration":30,"position":"Server","notes":null},{"employee_id":"bbbbbbbb-0000-0000-0000-000000000001","start_time":"2026-04-07T09:00:00Z","end_time":"2026-04-07T17:00:00Z","break_duration":30,"position":"Server","notes":null}]'::jsonb,
    'merge'
  ))->>'skipped_count'),
  '1',
  'Merge mode skips 1 overlapping shift'
);

-- Test 10: Delete template
SELECT lives_ok(
  format(
    $$SELECT delete_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001',
      %L
    )$$,
    (SELECT id FROM schedule_plan_templates WHERE name = 'Standard Week' AND restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  ),
  'Delete template succeeds'
);

-- Test 11: Delete non-existent template raises exception
SELECT throws_ok(
  $$SELECT delete_schedule_plan_template(
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000'
  )$$,
  'Template not found'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run pgTAP tests**

Run: `npm run test:db`
Expected: All 15 tests pass

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/schedule_plan_templates.test.sql
git commit -m "test: add pgTAP tests for schedule plan template RPCs"
```

---

## Task 3: TypeScript Types

**Files:**
- Modify: `src/types/scheduling.ts` (append after existing types, ~line 307)

- [ ] **Step 1: Add types to scheduling.ts**

```typescript
// --- Schedule Plan Templates ---

export interface TemplateShiftSnapshot {
  day_offset: number;       // 0=Monday through 6=Sunday (Monday-anchored)
  start_time: string;       // HH:MM:SS
  end_time: string;         // HH:MM:SS
  break_duration: number;
  position: string;
  employee_id: string;
  employee_name: string;
  notes: string | null;
}

export interface SchedulePlanTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  shifts: TemplateShiftSnapshot[];
  shift_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApplyTemplateResult {
  inserted_count: number;
  skipped_count: number;
  deleted_count: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/scheduling.ts
git commit -m "feat: add SchedulePlanTemplate types"
```

---

## Task 4: Snapshot Builder + Apply Builder Utilities + Tests

**Files:**
- Create: `src/lib/schedulePlanTemplates.ts`
- Create: `tests/unit/schedulePlanTemplates.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/schedulePlanTemplates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTemplateSnapshot, buildShiftsFromTemplate } from '@/lib/schedulePlanTemplates';
import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';

function makeShift(overrides: Partial<Shift> & { start_time: string; end_time: string }): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    break_duration: 30,
    position: 'Server',
    notes: null,
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: '2026-03-30T00:00:00Z',
    updated_at: '2026-03-30T00:00:00Z',
    employee: { id: 'emp-1', restaurant_id: 'rest-1', name: 'Alice', position: 'Server', status: 'active', hourly_rate: 15, created_at: '', updated_at: '' } as any,
    ...overrides,
  };
}

describe('buildTemplateSnapshot', () => {
  const weekStart = new Date(2026, 2, 30); // Monday March 30, 2026

  it('computes correct day_offset from Monday', () => {
    // Shift on Wednesday (day_offset = 2)
    const shift = makeShift({
      start_time: new Date(2026, 3, 1, 9, 0, 0).toISOString(),  // Wed Apr 1
      end_time: new Date(2026, 3, 1, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result).toHaveLength(1);
    expect(result[0].day_offset).toBe(2);
  });

  it('extracts local time strings', () => {
    const shift = makeShift({
      start_time: new Date(2026, 2, 30, 9, 30, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].start_time).toBe('09:30:00');
    expect(result[0].end_time).toBe('17:00:00');
  });

  it('includes employee info', () => {
    const shift = makeShift({
      start_time: new Date(2026, 2, 30, 9, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].employee_id).toBe('emp-1');
    expect(result[0].employee_name).toBe('Alice');
    expect(result[0].position).toBe('Server');
    expect(result[0].break_duration).toBe(30);
  });

  it('filters out cancelled shifts', () => {
    const shift = makeShift({
      status: 'cancelled',
      start_time: new Date(2026, 2, 30, 9, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 30, 17, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result).toHaveLength(0);
  });

  it('handles Sunday (day_offset = 6)', () => {
    const shift = makeShift({
      start_time: new Date(2026, 3, 5, 10, 0, 0).toISOString(),  // Sunday Apr 5
      end_time: new Date(2026, 3, 5, 18, 0, 0).toISOString(),
    });

    const result = buildTemplateSnapshot([shift], weekStart);
    expect(result[0].day_offset).toBe(6);
  });
});

describe('buildShiftsFromTemplate', () => {
  const targetMonday = new Date(2026, 3, 6); // Monday April 6, 2026

  const snapshot: TemplateShiftSnapshot[] = [
    {
      day_offset: 0, // Monday
      start_time: '09:00:00',
      end_time: '17:00:00',
      break_duration: 30,
      position: 'Server',
      employee_id: 'emp-1',
      employee_name: 'Alice',
      notes: null,
    },
    {
      day_offset: 2, // Wednesday
      start_time: '18:00:00',
      end_time: '23:00:00',
      break_duration: 15,
      position: 'Cook',
      employee_id: 'emp-2',
      employee_name: 'Bob',
      notes: 'Evening shift',
    },
  ];

  it('maps day_offset to correct target dates', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');
    expect(result).toHaveLength(2);

    // Monday shift
    const monStart = new Date(result[0].start_time);
    expect(monStart.getDate()).toBe(6); // April 6 (Monday)
    expect(monStart.getHours()).toBe(9);
    expect(monStart.getMinutes()).toBe(0);

    // Wednesday shift
    const wedStart = new Date(result[1].start_time);
    expect(wedStart.getDate()).toBe(8); // April 8 (Wednesday)
    expect(wedStart.getHours()).toBe(18);
  });

  it('produces BulkShiftInsert-compatible objects', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');

    expect(result[0]).toMatchObject({
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      break_duration: 30,
      position: 'Server',
      notes: null,
      status: 'scheduled',
      is_published: false,
      locked: false,
    });
  });

  it('preserves notes', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1');
    expect(result[1].notes).toBe('Evening shift');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedulePlanTemplates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

`src/lib/schedulePlanTemplates.ts`:

```typescript
import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';
import type { BulkShiftInsert } from '@/lib/copyWeekShifts';

/**
 * Format a Date's local time as HH:MM:SS.
 */
function formatTimeLocal(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Compute calendar-day offset from weekStart (Monday) in local time.
 * 0 = Monday, 6 = Sunday.
 */
function computeDayOffset(isoString: string, weekStart: Date): number {
  const d = new Date(isoString);
  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wMidnight = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  return Math.round((dMidnight.getTime() - wMidnight.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Parse HH:MM:SS into { hours, minutes, seconds }.
 */
function parseTime(time: string): { hours: number; minutes: number; seconds: number } {
  const [h, m, s] = time.split(':').map(Number);
  return { hours: h, minutes: m, seconds: s ?? 0 };
}

/**
 * Transform current week's shifts into a JSONB-ready snapshot for saving.
 * Filters cancelled shifts. Monday-anchored day_offset (0=Mon, 6=Sun).
 */
export function buildTemplateSnapshot(
  shifts: Shift[],
  weekStart: Date,
): TemplateShiftSnapshot[] {
  return shifts
    .filter((s) => s.status !== 'cancelled')
    .map((shift) => {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);

      return {
        day_offset: computeDayOffset(shift.start_time, weekStart),
        start_time: formatTimeLocal(start),
        end_time: formatTimeLocal(end),
        break_duration: shift.break_duration,
        position: shift.position,
        employee_id: shift.employee_id,
        employee_name: shift.employee?.name ?? 'Unknown',
        notes: shift.notes ?? null,
      };
    });
}

/**
 * Build BulkShiftInsert[] from a template snapshot + target Monday.
 * DST-safe: uses local Date constructor to preserve wall-clock times.
 * Same pattern as copyWeekShifts.ts offsetPreservingLocalTime.
 */
export function buildShiftsFromTemplate(
  snapshots: TemplateShiftSnapshot[],
  targetMonday: Date,
  restaurantId: string,
): BulkShiftInsert[] {
  return snapshots.map((snap) => {
    const targetDate = new Date(targetMonday);
    targetDate.setDate(targetMonday.getDate() + snap.day_offset);

    const startParts = parseTime(snap.start_time);
    const endParts = parseTime(snap.end_time);

    const newStart = new Date(
      targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
      startParts.hours, startParts.minutes, startParts.seconds,
    );

    const newEnd = new Date(
      targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(),
      endParts.hours, endParts.minutes, endParts.seconds,
    );

    // Handle overnight shifts: if end <= start, shift ends next day
    if (newEnd <= newStart) {
      newEnd.setDate(newEnd.getDate() + 1);
    }

    return {
      restaurant_id: restaurantId,
      employee_id: snap.employee_id,
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
      break_duration: snap.break_duration,
      position: snap.position,
      notes: snap.notes,
      status: 'scheduled' as const,
      is_published: false,
      locked: false,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedulePlanTemplates.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedulePlanTemplates.ts tests/unit/schedulePlanTemplates.test.ts
git commit -m "feat: add buildTemplateSnapshot and buildShiftsFromTemplate utilities"
```

---

## Task 5: React Hook — useSchedulePlanTemplates

**Files:**
- Create: `src/hooks/useSchedulePlanTemplates.ts`

- [ ] **Step 1: Write hook implementation**

`src/hooks/useSchedulePlanTemplates.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { buildTemplateSnapshot, buildShiftsFromTemplate } from '@/lib/schedulePlanTemplates';
import { getWeekEnd } from '@/hooks/useShiftPlanner';

import type { Shift, SchedulePlanTemplate, ApplyTemplateResult } from '@/types/scheduling';

export function useSchedulePlanTemplates(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryKey = ['schedule-plan-templates', restaurantId];

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('schedule_plan_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SchedulePlanTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  const saveTemplate = useMutation({
    mutationFn: async ({ name, shifts, weekStart }: { name: string; shifts: Shift[]; weekStart: Date }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const snapshot = buildTemplateSnapshot(shifts, weekStart);

      const { data, error } = await supabase.rpc('save_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_name: name,
        p_shifts: snapshot,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Template saved', description: 'Schedule saved as a reusable template.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save template', description: error.message, variant: 'destructive' });
    },
  });

  const applyTemplate = useMutation({
    mutationFn: async ({
      template, targetMonday, mergeMode,
    }: {
      template: SchedulePlanTemplate; targetMonday: Date; mergeMode: 'replace' | 'merge';
    }): Promise<ApplyTemplateResult> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      // Client-side timestamp construction (DST-safe, matches copyWeekShifts pattern)
      const shiftsPayload = buildShiftsFromTemplate(template.shifts, targetMonday, restaurantId);

      if (shiftsPayload.length === 0) {
        throw new Error('No valid shifts in template. All referenced employees may be inactive.');
      }

      const targetEnd = getWeekEnd(targetMonday);

      const { data, error } = await supabase.rpc('apply_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_target_start: targetMonday.toISOString(),
        p_target_end: targetEnd.toISOString(),
        p_shifts: shiftsPayload,
        p_merge_mode: mergeMode,
      });

      if (error) throw error;
      return data as unknown as ApplyTemplateResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });

      const parts: string[] = [];
      if (data.inserted_count > 0) parts.push(`${data.inserted_count} shifts created`);
      if (data.skipped_count > 0) parts.push(`${data.skipped_count} skipped`);
      if (data.deleted_count > 0) parts.push(`${data.deleted_count} replaced`);

      toast({ title: 'Template applied', description: parts.join(', ') + '.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to apply template', description: error.message, variant: 'destructive' });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { error } = await supabase.rpc('delete_schedule_plan_template', {
        p_restaurant_id: restaurantId,
        p_template_id: templateId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Template deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete template', description: error.message, variant: 'destructive' });
    },
  });

  return {
    templates,
    isLoading,
    error,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSchedulePlanTemplates.ts
git commit -m "feat: add useSchedulePlanTemplates hook"
```

---

## Task 6: CopyWeekDialog — Add Tabs and Template UI

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx`

Key design decisions:
- Apple-style underline tabs (from CLAUDE.md)
- Template rows use `div` with `role="button"` (not nested `<button>`, which is invalid HTML)
- Template rows have `group` class so `group-hover:opacity-100` works on trash icon
- "Save as Template" button in shared area between header and tabs (visible from both tabs per spec)
- Past-week guard on apply (consistent with copy tab)
- Tab panels use `role="tabpanel"` with `role="tablist"` for a11y

- [ ] **Step 1: Rewrite CopyWeekDialog with tabs**

Full replacement of `CopyWeekDialog.tsx`. The file is ~350 lines. Key sections:

1. **Header**: icon + "Copy Schedule" title + source week range
2. **Save as Template**: inline form between header and tabs (visible from both tabs)
3. **Tabs**: Apple underline tabs with `role="tablist"`
4. **Copy tab**: existing calendar + copy logic, unchanged behavior
5. **Template tab**: template list + calendar + merge mode radio + apply button
6. **Footer**: per-tab action buttons

The component uses `useSchedulePlanTemplates` hook internally. No new props needed — `shifts`, `sourceWeekStart`, `restaurantId` are already passed.

Template list rows use `div role="button" tabIndex={0}` with keyboard handler. Each row has `group` class. Trash icon uses `opacity-0 group-hover:opacity-100`.

Delete confirmation: inline "Delete / Keep" buttons replace the trash icon (no separate dialog).

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx
git commit -m "feat: add template tabs to CopyWeekDialog"
```

---

## Task 7: Generate Supabase Types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Reset DB and generate types**

Run: `npx supabase db reset && npx supabase gen types typescript --local > src/integrations/supabase/types.ts`

- [ ] **Step 2: Verify `schedule_plan_templates` appears in generated types**

Search for `schedule_plan_templates` in the output file.

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types with schedule_plan_templates"
```

---

## Task 8: Lint, Build, and Test Verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No new errors from our changes

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Run unit tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 4: Run pgTAP tests**

Run: `npm run test:db`
Expected: All tests pass

- [ ] **Step 5: Fix any issues, commit fixes**

---

## Dependency Order

```
Task 1 (migration) → Task 2 (pgTAP tests)
Task 1 (migration) → Task 7 (type generation)
Task 3 (types) → Task 4 (utilities)
Task 3 (types) → Task 5 (hook)
Task 4 (utilities) → Task 5 (hook)
Task 5 (hook) → Task 6 (dialog UI)
Task 7 (type generation) → Task 6 (dialog UI)
Tasks 1-7 → Task 8 (verification)
```

Parallelizable groups:
- After Task 1: Tasks 2, 3, 7 can run concurrently
- After Task 3: Task 4
- After Tasks 4 + 7: Tasks 5, 6 sequentially
