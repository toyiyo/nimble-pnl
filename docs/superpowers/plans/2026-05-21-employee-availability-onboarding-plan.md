# Employee Availability Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "blank availability" onboarding gap so a manager can, in one Generate Schedule session, see how many employees are missing availability, apply a sensible default to them in bulk, optionally email a reminder, and never re-enter the gap on new hires.

**Architecture:** Pure utility (`deriveDefaultAvailability`) + one Postgres RPC (`bulk_set_employee_availability`) + one edge function (`notify-availability-reminder`) + three React hooks + two new/modified dialog components. All availability writes go through the RPC; all reads use the existing `useEmployeeAvailability` query. No new tables. Banner is derived client-side from already-fetched data.

**Tech Stack:** TypeScript + React + Vite + React Query + shadcn (Dialog, Sheet, Collapsible, RadioGroup) + Supabase Postgres (pgTAP) + Supabase Edge Functions (Deno) + Resend.

**Spec:** `docs/superpowers/specs/2026-05-21-employee-availability-onboarding-design.md`

---

## Deviations from spec (locked in here)

1. **No `business_hours` column on `restaurants`.** Verified via `src/types/supabase.ts:5127`. `deriveDefaultAvailability` keeps `businessHours` as an optional parameter (always `undefined` from real callers in this PR) so the future-fallback hook stays in the signature without a behavior change. The function effectively becomes "templates → closed-by-default 09:00–17:00 unavailable."
2. **Query key is `'employee-availability'` (kebab-case)**, not `'employee_availability'` as the spec drafted. Confirmed at `src/hooks/useAvailability.tsx:9`. All `invalidateQueries` calls in this plan use the kebab-case key.
3. **pgTAP tests live under `supabase/tests/`** (not `tests/db/`). Confirmed by inspection of `supabase/tests/broadcast_open_shifts.test.sql`. Plan filename below uses the correct path.
4. **Banner ARIA decision is `role="alert"`** (per Phase 2.5 frontend reviewer fold-in). The spec's *Accessibility* section retains the stale `role="status"` line — `role="alert"` is the binding decision per the *Architecture → Data flow* section and the *Design-review fold-ins* section.

These deviations are baked into every task below; do not "fix" them by reading the spec literally.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/availabilityDefaults.ts` | Pure: `deriveDefaultAvailability({ templates, businessHours? })` → 7 `AvailabilityDefault` rows. |
| `src/hooks/useEmployeesMissingAvailability.ts` | Pure selector hook: filters active employees with zero availability rows. No network. |
| `src/hooks/useBulkSetAvailability.ts` | `useMutation` over `bulk_set_employee_availability` RPC. Supports `silent: true` opt-in. |
| `src/hooks/useSendAvailabilityReminder.ts` | `useMutation` over `supabase.functions.invoke('notify-availability-reminder')`. |
| `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx` | shadcn `Sheet` with employee checklist + 7-day grid. Calls `useBulkSetAvailability`. |
| `src/components/scheduling/availability/AvailabilityGrid.tsx` | Shared 7-day grid sub-component (semantic `<table>`, `<TimeInput>`s). Reused by Sheet and EmployeeDialog. |
| `src/components/scheduling/availability/MissingAvailabilityBanner.tsx` | Banner sub-component used by `GenerateScheduleDialog`. |
| `supabase/migrations/<ts>_bulk_set_employee_availability.sql` | RPC + composite index. |
| `supabase/tests/bulk_set_employee_availability.test.sql` | pgTAP — RPC contract. |
| `supabase/functions/notify-availability-reminder/index.ts` | Thin Deno entry. |
| `supabase/functions/_shared/availabilityReminderHandler.ts` | Pure handler logic for vitest coverage. |
| `tests/unit/availabilityDefaults.test.ts` | Vitest for `deriveDefaultAvailability`. |
| `tests/unit/useEmployeesMissingAvailability.test.ts` | Vitest for the selector hook. |
| `tests/unit/useBulkSetAvailability.test.ts` | Vitest — hook contract + silent flag. |
| `tests/unit/useSendAvailabilityReminder.test.ts` | Vitest — both `invoke` error paths. |
| `tests/unit/availabilityReminderHandler.test.ts` | Vitest for the edge handler. |
| `tests/unit/BulkSetAvailabilitySheet.test.tsx` | Vitest + RTL — sheet behavior. |
| `tests/unit/MissingAvailabilityBanner.test.tsx` | Vitest + RTL — banner rendering & a11y. |
| `tests/unit/GenerateScheduleDialog.banner.test.tsx` | Vitest + RTL — banner integration in dialog. |
| `tests/unit/EmployeeDialog.availabilitySection.test.tsx` | Vitest + RTL — create-mode availability section. |

### Modified files

| Path | What changes |
|---|---|
| `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx` | Add banner below header; exclude `no_availability` from `warningGroups` when banner is rendered; new props. |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | Pass `restaurantId` (already in scope) into `GenerateScheduleDialog`. |
| `src/components/EmployeeDialog.tsx` | Extract footer out of scroll container; add create-mode "Default availability" section; call RPC on submit if "Apply default" selected. |
| `supabase/config.toml` | Add `[functions.notify-availability-reminder] verify_jwt = true` block. |

No table schema changes. No new tables.

---

## Conventions used in every task

- **Test runner:** `npm test -- <relative test path>` (vitest). Use `--run` to disable watch mode where the step explicitly says one-shot.
- **Type-check:** `npm run typecheck` (runs `tsc --noEmit`).
- **Commit message style:** Conventional Commits (`feat(scope): …`, `test(scope): …`, etc.). Each commit is signed by the user's git config; do NOT add a Claude co-author trailer in this repo.
- **Git:** Stage only the files you touched (`git add <files>`), never `git add -A` or `git add .`.
- **Order:** RED → GREEN → COMMIT for every code-changing step. The plan calls out the failing-run step explicitly so you don't skip it.

---

## Task 0 — Confirm baseline and starting state

**Files:** none

- [ ] **Step 1: Verify branch and clean tree**

```bash
git status
git log --oneline -3
```

Expected output:
- Branch `feature/employee-availability-onboarding`, clean tree.
- Top two commits are `0b1f971a docs(spec): fold Phase 2.5 design-review feedback` and `1c18f5df docs(spec): employee availability onboarding loop design`.

- [ ] **Step 2: Run the full test suite once to capture the green baseline**

```bash
npm test -- --run 2>&1 | tail -25
```

Expected: ~4012 passing, 1 skipped. Record the exact passing count in the conversation — every new test we add should move that number up by exactly the count of new tests in the task being finished.

- [ ] **Step 3: Type-check baseline**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 1 — Pure utility `deriveDefaultAvailability` (TDD)

**Files:**
- Create: `src/lib/availabilityDefaults.ts`
- Test:   `tests/unit/availabilityDefaults.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/availabilityDefaults.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { deriveDefaultAvailability } from '@/lib/availabilityDefaults';

const T = (days: number[], start: string, end: string) => ({
  days,
  start_time: start,
  end_time: end,
});

describe('deriveDefaultAvailability', () => {
  it('returns exactly 7 rows, one per day_of_week 0..6, in order', () => {
    const rows = deriveDefaultAvailability({ templates: [] });
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('marks days with no template and no business_hours as is_available=false 09:00-17:00', () => {
    const rows = deriveDefaultAvailability({ templates: [] });
    for (const row of rows) {
      expect(row).toMatchObject({
        start_time: '09:00:00',
        end_time: '17:00:00',
        is_available: false,
      });
    }
  });

  it('uses MIN(start) and MAX(end) across templates that touch the day', () => {
    const templates = [
      T([1, 2, 3], '10:00:00', '18:00:00'),   // weekday open
      T([1, 2, 3], '07:00:00', '15:00:00'),   // weekday early
      T([5, 6],    '11:00:00', '23:00:00'),   // weekend close
    ];
    const rows = deriveDefaultAvailability({ templates });
    const monday = rows.find((r) => r.day_of_week === 1)!;
    const saturday = rows.find((r) => r.day_of_week === 6)!;
    const sunday = rows.find((r) => r.day_of_week === 0)!;

    expect(monday).toMatchObject({
      day_of_week: 1,
      start_time: '07:00:00',
      end_time: '18:00:00',
      is_available: true,
    });
    expect(saturday).toMatchObject({
      day_of_week: 6,
      start_time: '11:00:00',
      end_time: '23:00:00',
      is_available: true,
    });
    // Sunday has no templates and no business_hours → closed default
    expect(sunday).toMatchObject({
      day_of_week: 0,
      start_time: '09:00:00',
      end_time: '17:00:00',
      is_available: false,
    });
  });

  it('honors business_hours fallback when no template covers the day', () => {
    const rows = deriveDefaultAvailability({
      templates: [T([1], '10:00:00', '18:00:00')],
      businessHours: {
        0: { open: '08:00:00', close: '14:00:00', is_closed: false },
        2: { open: '09:00:00', close: '17:00:00', is_closed: true },
      },
    });
    const sunday = rows.find((r) => r.day_of_week === 0)!;
    const tuesday = rows.find((r) => r.day_of_week === 2)!;

    expect(sunday).toMatchObject({
      day_of_week: 0,
      start_time: '08:00:00',
      end_time: '14:00:00',
      is_available: true,
    });
    // is_closed=true → closed default, NOT business_hours window
    expect(tuesday).toMatchObject({
      day_of_week: 2,
      start_time: '09:00:00',
      end_time: '17:00:00',
      is_available: false,
    });
  });

  it('handles HH:MM (no seconds) template values by normalizing to HH:MM:SS', () => {
    const rows = deriveDefaultAvailability({
      templates: [{ days: [3], start_time: '08:30', end_time: '22:30' }],
    });
    const wednesday = rows.find((r) => r.day_of_week === 3)!;
    expect(wednesday.start_time).toBe('08:30:00');
    expect(wednesday.end_time).toBe('22:30:00');
    expect(wednesday.is_available).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/availabilityDefaults.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/availabilityDefaults'` or `deriveDefaultAvailability is not a function`.

- [ ] **Step 3: Implement the utility**

Create `src/lib/availabilityDefaults.ts` with this exact content:

```ts
export type RestaurantBusinessHours = {
  [dayOfWeek: number]:
    | { open: string; close: string; is_closed: boolean }
    | null;
};

export type ShiftTemplateForDefaults = {
  days: number[];
  start_time: string;
  end_time: string;
};

export type AvailabilityDefault = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

const CLOSED_DEFAULT = {
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_available: false,
} as const;

function normalizeTime(value: string): string {
  // Accept 'HH:MM' or 'HH:MM:SS' and always return 'HH:MM:SS'.
  return value.length === 5 ? `${value}:00` : value;
}

function minTime(a: string, b: string): string {
  return a < b ? a : b;
}

function maxTime(a: string, b: string): string {
  return a > b ? a : b;
}

export function deriveDefaultAvailability(args: {
  templates: ShiftTemplateForDefaults[];
  businessHours?: RestaurantBusinessHours | null;
}): AvailabilityDefault[] {
  const { templates, businessHours } = args;
  const rows: AvailabilityDefault[] = [];

  for (let day = 0; day < 7; day++) {
    const matching = templates.filter((t) => t.days.includes(day));

    if (matching.length > 0) {
      let start = normalizeTime(matching[0].start_time);
      let end = normalizeTime(matching[0].end_time);
      for (let i = 1; i < matching.length; i++) {
        start = minTime(start, normalizeTime(matching[i].start_time));
        end = maxTime(end, normalizeTime(matching[i].end_time));
      }
      rows.push({
        day_of_week: day,
        start_time: start,
        end_time: end,
        is_available: true,
      });
      continue;
    }

    const bh = businessHours?.[day];
    if (bh && bh.is_closed === false) {
      rows.push({
        day_of_week: day,
        start_time: normalizeTime(bh.open),
        end_time: normalizeTime(bh.close),
        is_available: true,
      });
      continue;
    }

    rows.push({ day_of_week: day, ...CLOSED_DEFAULT });
  }

  return rows;
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/availabilityDefaults.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/availabilityDefaults.ts tests/unit/availabilityDefaults.test.ts
git commit -m "feat(availability): pure deriveDefaultAvailability utility"
```

---

## Task 2 — Selector hook `useEmployeesMissingAvailability` (TDD)

**Files:**
- Create: `src/hooks/useEmployeesMissingAvailability.ts`
- Test:   `tests/unit/useEmployeesMissingAvailability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useEmployeesMissingAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEmployeesMissingAvailability } from '@/hooks/useEmployeesMissingAvailability';
import type { EmployeeAvailability } from '@/types/scheduling';

type Emp = { id: string; name: string; status: 'active' | 'inactive' | 'terminated' };

const av = (employee_id: string, day_of_week = 1): EmployeeAvailability =>
  ({
    id: `av-${employee_id}-${day_of_week}`,
    restaurant_id: 'r1',
    employee_id,
    day_of_week,
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_available: true,
    notes: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
  } as EmployeeAvailability);

describe('useEmployeesMissingAvailability', () => {
  it('returns active employees with zero matching availability rows', () => {
    const employees: Emp[] = [
      { id: 'e1', name: 'Alice', status: 'active' },     // missing
      { id: 'e2', name: 'Bob',   status: 'active' },     // has row
      { id: 'e3', name: 'Carol', status: 'inactive' },   // excluded (inactive)
      { id: 'e4', name: 'Dan',   status: 'active' },     // missing
    ];
    const availability = [av('e2', 1)];

    const { result } = renderHook(() =>
      useEmployeesMissingAvailability(employees as never, availability),
    );

    expect(result.current.map((e) => e.id)).toEqual(['e1', 'e4']);
  });

  it('treats a single row (any day) as "has availability"', () => {
    const employees: Emp[] = [{ id: 'e1', name: 'Alice', status: 'active' }];
    const { result } = renderHook(() =>
      useEmployeesMissingAvailability(employees as never, [av('e1', 3)]),
    );
    expect(result.current).toEqual([]);
  });

  it('returns empty list when employees is empty', () => {
    const { result } = renderHook(() =>
      useEmployeesMissingAvailability([], []),
    );
    expect(result.current).toEqual([]);
  });

  it('is referentially stable when inputs do not change', () => {
    const employees: Emp[] = [{ id: 'e1', name: 'Alice', status: 'active' }];
    const availability: EmployeeAvailability[] = [];
    const { result, rerender } = renderHook(
      ({ e, a }) => useEmployeesMissingAvailability(e as never, a),
      { initialProps: { e: employees, a: availability } },
    );
    const first = result.current;
    rerender({ e: employees, a: availability });
    expect(result.current).toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/useEmployeesMissingAvailability.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useEmployeesMissingAvailability.ts`:

```ts
import { useMemo } from 'react';
import type { EmployeeAvailability, Employee } from '@/types/scheduling';

type EmployeeLite = Pick<Employee, 'id' | 'name' | 'status'>;

export function useEmployeesMissingAvailability<T extends EmployeeLite>(
  employees: T[],
  availability: EmployeeAvailability[],
): T[] {
  return useMemo(() => {
    const haveAvailability = new Set<string>();
    for (const row of availability) {
      haveAvailability.add(row.employee_id);
    }
    return employees.filter(
      (e) => e.status === 'active' && !haveAvailability.has(e.id),
    );
  }, [employees, availability]);
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/useEmployeesMissingAvailability.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmployeesMissingAvailability.ts tests/unit/useEmployeesMissingAvailability.test.ts
git commit -m "feat(availability): useEmployeesMissingAvailability selector hook"
```

---

## Task 3 — RPC migration `bulk_set_employee_availability`

**Files:**
- Create: `supabase/migrations/<UTC-timestamp>_bulk_set_employee_availability.sql`
- Create: `supabase/tests/bulk_set_employee_availability.test.sql`

> **Timestamp:** Use `date -u +%Y%m%d%H%M%S`. The plan refers to this as `<TS>` from here on; substitute the value at write time.

- [ ] **Step 1: Write the migration**

Run `date -u +%Y%m%d%H%M%S` and use the value as `<TS>`. Create `supabase/migrations/<TS>_bulk_set_employee_availability.sql`:

```sql
-- bulk_set_employee_availability
-- Replaces (delete + insert) availability rows for the supplied employees on the
-- supplied days. Designed to be idempotent and to support future multi-window
-- availability (multiple JSONB elements with the same day_of_week).
--
-- Safety:
--   - SECURITY DEFINER + explicit user_has_restaurant_access(..., true) check
--     enforces caller must be owner/manager.
--   - Inline tenant validator ensures employee_ids belong to p_restaurant_id.
--   - is_available REQUIRED in every JSONB element; closed-day rows cannot be
--     silently flipped to available.

CREATE OR REPLACE FUNCTION public.bulk_set_employee_availability(
  p_restaurant_id  UUID,
  p_employee_ids   UUID[],
  p_availability   JSONB
)
RETURNS TABLE (
  employees_updated INTEGER,
  rows_inserted     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_inserted     INTEGER := 0;
  v_employees_updated INTEGER := 0;
BEGIN
  -- Authz: caller must be owner/manager of the restaurant
  IF NOT public.user_has_restaurant_access(p_restaurant_id, true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Empty-array guard
  IF array_length(p_employee_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER;
    RETURN;
  END IF;

  -- day_of_week range check
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE (elem->>'day_of_week')::int NOT BETWEEN 0 AND 6
  ) THEN
    RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = '22003';
  END IF;

  -- is_available REQUIRED (boolean, present in every element)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE NOT (elem ? 'is_available')
       OR jsonb_typeof(elem->'is_available') != 'boolean'
  ) THEN
    RAISE EXCEPTION 'is_available_required' USING ERRCODE = '22004';
  END IF;

  -- Tenant validation: every employee_id belongs to p_restaurant_id
  IF EXISTS (
    SELECT 1 FROM unnest(p_employee_ids) AS eid
    WHERE NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = eid AND restaurant_id = p_restaurant_id
    )
  ) THEN
    RAISE EXCEPTION 'employee_not_in_restaurant' USING ERRCODE = '23503';
  END IF;

  -- Atomic delete + insert. Days NOT in p_availability are untouched.
  -- IN de-duplicates day_of_week, so callers may pass multiple windows per day.
  WITH days_to_replace AS (
    SELECT (elem->>'day_of_week')::int AS day_of_week
    FROM jsonb_array_elements(p_availability) AS elem
  ),
  deleted AS (
    DELETE FROM employee_availability
    WHERE restaurant_id = p_restaurant_id
      AND employee_id = ANY(p_employee_ids)
      AND day_of_week IN (SELECT day_of_week FROM days_to_replace)
    RETURNING 1
  ),
  inserted AS (
    INSERT INTO employee_availability
      (restaurant_id, employee_id, day_of_week, start_time, end_time, is_available)
    SELECT
      p_restaurant_id,
      eid,
      (a->>'day_of_week')::int,
      (a->>'start_time')::time,
      (a->>'end_time')::time,
      (a->>'is_available')::boolean
    FROM unnest(p_employee_ids) AS eid
    CROSS JOIN jsonb_array_elements(p_availability) AS a
    RETURNING 1
  )
  SELECT
    COUNT(*) FILTER (WHERE TRUE)::INTEGER,
    array_length(p_employee_ids, 1)
  INTO v_rows_inserted, v_employees_updated
  FROM inserted;

  RETURN QUERY SELECT v_employees_updated, v_rows_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) TO authenticated;

-- Composite index matches both the DELETE predicate of this RPC and the
-- existing per-employee/per-day lookups in check_availability_conflict.
-- CONCURRENTLY because employee_availability has rows in production.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_employee_availability_restaurant_employee_day
  ON employee_availability (restaurant_id, employee_id, day_of_week);
```

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/bulk_set_employee_availability.test.sql`:

```sql
BEGIN;
SELECT plan(13);

-- ---------- Fixture setup ----------
-- Two restaurants; one owner per restaurant; one staff at restaurant A.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ownerA@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'ownerB@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'staffA@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RestaurantA'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RestaurantB')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'staff')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, status) VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice A', 'active'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bob A',   'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mallory B', 'active')
ON CONFLICT (id) DO NOTHING;

-- Helper to impersonate a user via auth.uid()
CREATE OR REPLACE FUNCTION test_set_user(uid UUID) RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true);
$$;

-- ---------- 1. Happy path: owner writes 2 employees x 7 days = 14 rows ----------
SELECT test_set_user('11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00:00', 'end_time', '17:00:00', 'is_available', false),
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 2, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 3, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 4, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 5, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 6, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true)
    )
  ) $sql$,
  'owner can bulk-set availability'
);

SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  14,
  '2 employees x 7 days = 14 rows inserted'
);

-- ---------- 2. Idempotent re-run preserves count ----------
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00:00', 'end_time', '17:00:00', 'is_available', false),
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 2, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 3, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 4, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 5, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 6, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true)
    )
  ) $sql$,
  'idempotent re-run succeeds'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  14,
  'row count still 14 after re-run'
);

-- ---------- 3. Days NOT in payload are untouched ----------
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '06:00:00', 'end_time', '14:00:00', 'is_available', true)
    )
  ) $sql$,
  'partial update succeeds'
);
SELECT is(
  (SELECT start_time::text FROM employee_availability
   WHERE employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1' AND day_of_week = 1),
  '06:00:00',
  'Monday replaced; other days untouched'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'),
  7,
  'still 7 rows for employee 1 (no orphans)'
);

-- ---------- 4. Staff role is denied (42501) ----------
SELECT test_set_user('33333333-3333-3333-3333-333333333333');
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '42501',
  'forbidden',
  'staff role gets 42501'
);

-- ---------- 5. Cross-tenant employee_id rejected (23503) ----------
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid],  -- belongs to B
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '23503',
  'employee_not_in_restaurant',
  'cross-tenant employee rejected'
);

-- ---------- 6. Empty array returns (0, 0) ----------
SELECT results_eq(
  $sql$ SELECT employees_updated, rows_inserted FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY[]::uuid[],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  $sql$ VALUES (0, 0) $sql$,
  'empty employee array returns (0, 0)'
);

-- ---------- 7. Out-of-range day_of_week (22003) ----------
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 9, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '22003',
  'invalid_day_of_week',
  'day_of_week 9 rejected'
);

-- ---------- 8. Missing is_available (22004) ----------
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00')
    )
  ) $sql$,
  '22004',
  'is_available_required',
  'missing is_available rejected'
);

-- ---------- 9. Multi-window same day inserts both ----------
DELETE FROM employee_availability WHERE employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '09:00:00', 'end_time', '13:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 1, 'start_time', '17:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  'split-shift insert succeeds'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1' AND day_of_week = 1),
  2,
  'two windows on Monday'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Apply the migration locally and run the pgTAP test**

```bash
supabase db reset --no-seed
psql "$(supabase status --output env | awk -F= '/^DB_URL/ {gsub(/"/,"",$2); print $2}')" \
  -f supabase/tests/bulk_set_employee_availability.test.sql
```

Expected: `1..13` then `13 of 13` passing (look for the TAP `ok 13 - …` line; pgTAP wraps with `1..N`). If your local stack does not run pgTAP via psql, fall back to `supabase/tests/run_tests.sh bulk_set_employee_availability` if that helper exists in the repo, otherwise run it through the Supabase CLI's `db test` once supported.

If a single test fails, **read the SQL output**, fix the migration (NEVER edit the test to make it pass), and rerun.

- [ ] **Step 4: Generate updated TypeScript types**

```bash
npm run db:types  # or whatever script the repo uses; see package.json
```

Inspect the diff in `src/types/supabase.ts` — you should see a new `bulk_set_employee_availability` function entry under `Functions`. If the npm script isn't present, fall back to:

```bash
npx supabase gen types typescript --local > src/types/supabase.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<TS>_bulk_set_employee_availability.sql \
        supabase/tests/bulk_set_employee_availability.test.sql \
        src/types/supabase.ts
git commit -m "feat(db): bulk_set_employee_availability RPC + composite index"
```

---

## Task 4 — Hook `useBulkSetAvailability` (TDD)

**Files:**
- Create: `src/hooks/useBulkSetAvailability.ts`
- Test:   `tests/unit/useBulkSetAvailability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useBulkSetAvailability.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBulkSetAvailability } from '@/hooks/useBulkSetAvailability';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useBulkSetAvailability', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    toastMock.mockReset();
  });

  it('calls the RPC with restaurant_id, employee_ids, availability and invalidates the query', async () => {
    rpcMock.mockResolvedValue({
      data: [{ employees_updated: 2, rows_inserted: 14 }],
      error: null,
    });

    const { result } = renderHook(() => useBulkSetAvailability(), { wrapper });

    await result.current.mutateAsync({
      restaurantId: 'r1',
      employeeIds: ['e1', 'e2'],
      availability: [
        { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
      ],
    });

    expect(rpcMock).toHaveBeenCalledWith('bulk_set_employee_availability', {
      p_restaurant_id: 'r1',
      p_employee_ids: ['e1', 'e2'],
      p_availability: [
        { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
      ],
    });
    expect(toastMock).toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0].variant).not.toBe('destructive');
  });

  it('suppresses the success toast when silent: true', async () => {
    rpcMock.mockResolvedValue({
      data: [{ employees_updated: 1, rows_inserted: 7 }],
      error: null,
    });
    const { result } = renderHook(() => useBulkSetAvailability({ silent: true }), {
      wrapper,
    });
    await result.current.mutateAsync({
      restaurantId: 'r1',
      employeeIds: ['e1'],
      availability: [
        { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', is_available: true },
      ],
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('surfaces RPC errors with a destructive toast', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } });
    const { result } = renderHook(() => useBulkSetAvailability(), { wrapper });

    await expect(
      result.current.mutateAsync({
        restaurantId: 'r1',
        employeeIds: ['e1'],
        availability: [
          { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
        ],
      }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/useBulkSetAvailability.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useBulkSetAvailability.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type AvailabilityWindow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

export type BulkSetAvailabilityArgs = {
  restaurantId: string;
  employeeIds: string[];
  availability: AvailabilityWindow[];
};

type BulkSetAvailabilityResult = {
  employees_updated: number;
  rows_inserted: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "You don't have permission to set availability for these employees.",
  employee_not_in_restaurant:
    "One or more employees aren't in this restaurant. Refresh and try again.",
  invalid_day_of_week: 'Invalid day. Please re-open the dialog and try again.',
  is_available_required: 'Availability data is incomplete.',
};

function friendlyMessage(supabaseError: { message?: string } | null): string {
  if (!supabaseError?.message) return "Couldn't save availability. Try again.";
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (supabaseError.message.toLowerCase().includes(key)) {
      return ERROR_MESSAGES[key];
    }
  }
  return "Couldn't save availability. Try again.";
}

export function useBulkSetAvailability(options?: { silent?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const silent = options?.silent ?? false;

  return useMutation<BulkSetAvailabilityResult, Error, BulkSetAvailabilityArgs>({
    mutationFn: async ({ restaurantId, employeeIds, availability }) => {
      const { data, error } = await supabase.rpc('bulk_set_employee_availability', {
        p_restaurant_id: restaurantId,
        p_employee_ids: employeeIds,
        p_availability: availability,
      });
      if (error) {
        throw new Error(error.message);
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row as BulkSetAvailabilityResult) ?? {
        employees_updated: 0,
        rows_inserted: 0,
      };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['employee-availability', variables.restaurantId],
      });
      if (!silent) {
        toast({
          title: 'Availability saved',
          description: `Updated ${result.employees_updated} employee${result.employees_updated === 1 ? '' : 's'}.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Couldn't save availability",
        description: friendlyMessage({ message: error.message }),
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/useBulkSetAvailability.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBulkSetAvailability.ts tests/unit/useBulkSetAvailability.test.ts
git commit -m "feat(availability): useBulkSetAvailability mutation hook"
```

---

## Task 5 — Hook `useSendAvailabilityReminder` (TDD)

**Files:**
- Create: `src/hooks/useSendAvailabilityReminder.ts`
- Test:   `tests/unit/useSendAvailabilityReminder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useSendAvailabilityReminder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSendAvailabilityReminder } from '@/hooks/useSendAvailabilityReminder';

const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useSendAvailabilityReminder', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastMock.mockReset();
  });

  it('invokes notify-availability-reminder with restaurant_id and employee_ids', async () => {
    invokeMock.mockResolvedValue({ data: { sent: 2, skipped_no_email: 0, errors: 0 }, error: null });
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1', 'e2'] });

    expect(invokeMock).toHaveBeenCalledWith('notify-availability-reminder', {
      body: { restaurant_id: 'r1', employee_ids: ['e1', 'e2'] },
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/reminder/i) }),
    );
  });

  it('shows destructive toast when invoke rejects', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await expect(
      result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1'] }),
    ).rejects.toThrow('network down');
    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });

  it('shows destructive toast when invoke returns { error }', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const { result } = renderHook(() => useSendAvailabilityReminder(), { wrapper });
    await expect(
      result.current.mutateAsync({ restaurantId: 'r1', employeeIds: ['e1'] }),
    ).rejects.toThrow(/forbidden/);
    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0].variant === 'destructive')).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/useSendAvailabilityReminder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useSendAvailabilityReminder.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Args = { restaurantId: string; employeeIds: string[] };
type Result = { sent: number; skipped_no_email: number; errors: number };

export function useSendAvailabilityReminder() {
  const { toast } = useToast();
  return useMutation<Result, Error, Args>({
    mutationFn: async ({ restaurantId, employeeIds }) => {
      const { data, error } = await supabase.functions.invoke(
        'notify-availability-reminder',
        { body: { restaurant_id: restaurantId, employee_ids: employeeIds } },
      );
      if (error) {
        throw new Error(error.message || 'Failed to send reminders');
      }
      return data as Result;
    },
    onSuccess: (result) => {
      const headline =
        result.sent > 0
          ? `Sent ${result.sent} reminder${result.sent === 1 ? '' : 's'}`
          : 'No reminders sent';
      const skipped = result.skipped_no_email > 0
        ? ` ${result.skipped_no_email} employee${result.skipped_no_email === 1 ? '' : 's'} had no email on file.`
        : '';
      toast({ title: headline, description: skipped.trim() || undefined });
    },
    onError: (error) => {
      toast({
        title: "Couldn't send reminders",
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/useSendAvailabilityReminder.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSendAvailabilityReminder.ts tests/unit/useSendAvailabilityReminder.test.ts
git commit -m "feat(availability): useSendAvailabilityReminder mutation hook"
```

---

## Task 6 — Shared `AvailabilityGrid` sub-component (TDD)

This is the 7-day editable table reused by both `BulkSetAvailabilitySheet` and `EmployeeDialog`.

**Files:**
- Create: `src/components/scheduling/availability/AvailabilityGrid.tsx`

> **Test note:** A dedicated test file is unnecessary — the consumer tests in Task 7 and Task 10 exercise this component's full surface. Creating an isolated test here would duplicate coverage. If the consumer tests later prove insufficient, add a `tests/unit/AvailabilityGrid.test.tsx` then.

- [ ] **Step 1: Implement the grid**

Create `src/components/scheduling/availability/AvailabilityGrid.tsx`:

```tsx
import { Checkbox } from '@/components/ui/checkbox';
import { TimeInput } from '@/components/scheduling/TimeInput';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type AvailabilityRowValue = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

interface AvailabilityGridProps {
  value: AvailabilityRowValue[];      // length 7, sorted by day_of_week 0..6
  onChange: (next: AvailabilityRowValue[]) => void;
  idPrefix: string;                    // e.g. "bulk-avail" or "employee-avail"
}

export function AvailabilityGrid({ value, onChange, idPrefix }: AvailabilityGridProps) {
  function updateRow(index: number, patch: Partial<AvailabilityRowValue>) {
    const next = value.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Weekly availability</caption>
      <thead>
        <tr>
          <th scope="col" className="sr-only">Day</th>
          <th scope="col" className="sr-only">Available</th>
          <th scope="col" className="sr-only">Start time</th>
          <th scope="col" className="sr-only">End time</th>
        </tr>
      </thead>
      <tbody>
        {value.map((row, index) => {
          const dayLabel = DAY_LABELS[row.day_of_week];
          const checkboxId = `${idPrefix}-day-${row.day_of_week}`;
          return (
            <tr key={row.day_of_week} className="border-b border-border/40">
              <th scope="row" className="py-2 pr-3 text-left text-[13px] font-medium text-foreground">
                {dayLabel}
              </th>
              <td className="py-2 pr-3 align-middle">
                <Checkbox
                  id={checkboxId}
                  checked={row.is_available}
                  onCheckedChange={(checked) =>
                    updateRow(index, { is_available: checked === true })
                  }
                  aria-label={`${dayLabel} available`}
                  className="min-h-[20px] min-w-[20px]"
                />
              </td>
              <td className="py-2 pr-2 align-middle">
                <TimeInput
                  id={`${idPrefix}-start-${row.day_of_week}`}
                  label={`${dayLabel} start`}
                  value={row.start_time.slice(0, 5)}
                  onChange={(v) => updateRow(index, { start_time: `${v}:00` })}
                />
              </td>
              <td className="py-2 align-middle">
                <TimeInput
                  id={`${idPrefix}-end-${row.day_of_week}`}
                  label={`${dayLabel} end`}
                  value={row.end_time.slice(0, 5)}
                  onChange={(v) => updateRow(index, { end_time: `${v}:00` })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

Note on label visibility: `<TimeInput>` already renders a visible `<Label>`; the `sr-only` table headers above are deliberate so screen readers still get column semantics without doubling the visual label.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/availability/AvailabilityGrid.tsx
git commit -m "feat(availability): AvailabilityGrid shared editable 7-day table"
```

---

## Task 7 — `MissingAvailabilityBanner` component (TDD)

**Files:**
- Create: `src/components/scheduling/availability/MissingAvailabilityBanner.tsx`
- Test:   `tests/unit/MissingAvailabilityBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/MissingAvailabilityBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissingAvailabilityBanner } from '@/components/scheduling/availability/MissingAvailabilityBanner';

describe('MissingAvailabilityBanner', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(
      <MissingAvailabilityBanner
        count={0}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an alert with pluralized text and two CTA buttons', () => {
    render(
      <MissingAvailabilityBanner
        count={3}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveTextContent(/3 employees can.+t be scheduled/i);
    expect(screen.getByRole('button', { name: /set defaults/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /email reminder/i })).toBeEnabled();
  });

  it('singularizes "1 employee can\'t be scheduled"', () => {
    render(
      <MissingAvailabilityBanner
        count={1}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/1 employee can.+t be scheduled/i);
  });

  it('invokes callbacks on click', () => {
    const onSetDefaults = vi.fn();
    const onSendReminder = vi.fn();
    render(
      <MissingAvailabilityBanner
        count={2}
        onSetDefaults={onSetDefaults}
        onSendReminder={onSendReminder}
        reminderPending={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /email reminder/i }));
    expect(onSetDefaults).toHaveBeenCalledTimes(1);
    expect(onSendReminder).toHaveBeenCalledTimes(1);
  });

  it('disables the reminder button and shows a spinner while reminderPending', () => {
    render(
      <MissingAvailabilityBanner
        count={2}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending
      />,
    );
    const reminderBtn = screen.getByRole('button', { name: /email reminder/i });
    expect(reminderBtn).toBeDisabled();
    expect(reminderBtn.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/MissingAvailabilityBanner.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner**

Create `src/components/scheduling/availability/MissingAvailabilityBanner.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface MissingAvailabilityBannerProps {
  count: number;
  onSetDefaults: () => void;
  onSendReminder: () => void;
  reminderPending: boolean;
}

export function MissingAvailabilityBanner({
  count,
  onSetDefaults,
  onSendReminder,
  reminderPending,
}: MissingAvailabilityBannerProps) {
  if (count <= 0) return null;
  const noun = count === 1 ? 'employee' : 'employees';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mx-6 mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="h-4 w-4 mt-0.5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground">
            {count} {noun} can&apos;t be scheduled — availability missing
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px] text-[13px]"
              onClick={onSetDefaults}
            >
              Set defaults
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] text-[13px]"
              onClick={onSendReminder}
              disabled={reminderPending}
              aria-label="Email reminder"
            >
              {reminderPending && (
                <span
                  aria-hidden="true"
                  className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              Email reminder
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/MissingAvailabilityBanner.test.tsx
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/availability/MissingAvailabilityBanner.tsx \
        tests/unit/MissingAvailabilityBanner.test.tsx
git commit -m "feat(availability): MissingAvailabilityBanner component"
```

---

## Task 8 — `BulkSetAvailabilitySheet` (TDD)

**Files:**
- Create: `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx`
- Test:   `tests/unit/BulkSetAvailabilitySheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/BulkSetAvailabilitySheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkSetAvailabilitySheet } from '@/components/scheduling/availability/BulkSetAvailabilitySheet';

const mutateMock = vi.fn();
vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: mutateMock,
    isPending: false,
  }),
}));

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  restaurantId: 'r1',
  employees: [
    { id: 'e1', name: 'Alice', status: 'active' as const, position: 'Server' },
    { id: 'e2', name: 'Bob',   status: 'active' as const, position: 'Cook' },
    { id: 'e3', name: 'Carol', status: 'active' as const, position: 'Server' },
  ],
  preCheckedIds: ['e1', 'e3'],
  defaults: [
    { day_of_week: 0, start_time: '09:00:00', end_time: '17:00:00', is_available: false },
    { day_of_week: 1, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 2, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 3, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 4, start_time: '10:00:00', end_time: '22:00:00', is_available: true },
    { day_of_week: 5, start_time: '10:00:00', end_time: '23:00:00', is_available: true },
    { day_of_week: 6, start_time: '10:00:00', end_time: '23:00:00', is_available: true },
  ],
};

function renderSheet(props = baseProps) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BulkSetAvailabilitySheet {...props} />
    </QueryClientProvider>,
  );
}

describe('BulkSetAvailabilitySheet', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    mutateMock.mockResolvedValue({ employees_updated: 2, rows_inserted: 14 });
  });

  it('pre-checks employees from preCheckedIds', () => {
    renderSheet();
    expect(
      (screen.getByRole('checkbox', { name: /Alice/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (screen.getByRole('checkbox', { name: /Bob/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      (screen.getByRole('checkbox', { name: /Carol/ }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows submit label "Apply to N employees" reflecting the selection', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /apply to 2 employees/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    expect(screen.getByRole('button', { name: /apply to 3 employees/i })).toBeEnabled();
  });

  it('disables submit with aria-disabled when no employees are selected', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: /Alice/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Carol/ }));
    const submit = screen.getByRole('button', { name: /select at least one employee/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
  });

  it('invokes the mutation with prechecked ids and the supplied defaults', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /apply to 2 employees/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const args = mutateMock.mock.calls[0][0];
    expect(args.restaurantId).toBe('r1');
    expect(args.employeeIds.sort()).toEqual(['e1', 'e3']);
    expect(args.availability).toHaveLength(7);
    // closed-day row must keep is_available=false
    expect(args.availability.find((a: { day_of_week: number; is_available: boolean }) => a.day_of_week === 0).is_available).toBe(false);
  });

  it('renders the 7-day grid with namespaced ids', () => {
    renderSheet();
    expect(document.getElementById('bulk-avail-day-0')).not.toBeNull();
    expect(document.getElementById('bulk-avail-day-6')).not.toBeNull();
    // namespace must NOT collide with the employee-dialog version
    expect(document.getElementById('employee-avail-day-0')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/BulkSetAvailabilitySheet.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sheet**

Create `src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AvailabilityGrid, type AvailabilityRowValue } from './AvailabilityGrid';
import { useBulkSetAvailability } from '@/hooks/useBulkSetAvailability';

interface EmployeeLite {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'terminated';
  position?: string;
}

interface BulkSetAvailabilitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  employees: EmployeeLite[];
  preCheckedIds: string[];
  defaults: AvailabilityRowValue[];   // length 7
}

export function BulkSetAvailabilitySheet({
  open,
  onOpenChange,
  restaurantId,
  employees,
  preCheckedIds,
  defaults,
}: BulkSetAvailabilitySheetProps) {
  const mutation = useBulkSetAvailability();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(preCheckedIds),
  );
  const [grid, setGrid] = useState<AvailabilityRowValue[]>(defaults);

  // Re-seed when sheet (re)opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(preCheckedIds));
      setGrid(defaults);
    }
  }, [open, preCheckedIds, defaults]);

  const sortedEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'active')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = selectedIds.size;
  const submitDisabled = selectedCount === 0;

  async function handleApply() {
    if (submitDisabled) return;
    try {
      await mutation.mutateAsync({
        restaurantId,
        employeeIds: Array.from(selectedIds),
        availability: grid,
      });
      onOpenChange(false);
    } catch {
      // hook surfaces a destructive toast already
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <SheetTitle>Set default availability</SheetTitle>
          <SheetDescription>
            Apply a default weekly availability to selected employees.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Employee list */}
          <section aria-label="Employees">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Employees ({selectedCount} selected)
            </p>
            <ul className="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
              {sortedEmployees.map((emp) => {
                const checked = selectedIds.has(emp.id);
                const id = `bulk-emp-${emp.id}`;
                return (
                  <li key={emp.id}>
                    <label
                      htmlFor={id}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggle(emp.id)}
                        aria-label={emp.name}
                        className="min-h-[20px] min-w-[20px]"
                      />
                      <span className="text-[14px] font-medium text-foreground">
                        {emp.name}
                      </span>
                      {emp.position && (
                        <span className="text-[12px] text-muted-foreground">
                          {emp.position}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Grid */}
          <section aria-label="Weekly availability">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Weekly availability
            </p>
            <AvailabilityGrid
              value={grid}
              onChange={setGrid}
              idPrefix="bulk-avail"
            />
          </section>
        </div>

        <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
          <Button
            variant="ghost"
            className="min-h-[44px]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px]"
            onClick={handleApply}
            aria-disabled={submitDisabled || mutation.isPending}
            disabled={mutation.isPending}
            aria-label={
              submitDisabled
                ? 'Select at least one employee'
                : `Apply to ${selectedCount} employee${selectedCount === 1 ? '' : 's'}`
            }
          >
            {mutation.isPending && (
              <span
                aria-hidden="true"
                className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {submitDisabled
              ? 'Select at least one employee'
              : `Apply to ${selectedCount} employee${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/BulkSetAvailabilitySheet.test.tsx
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx \
        tests/unit/BulkSetAvailabilitySheet.test.tsx
git commit -m "feat(availability): BulkSetAvailabilitySheet (Sheet, not Dialog)"
```

---

## Task 9 — Wire banner + sheet into `GenerateScheduleDialog` (TDD)

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
- Test:   `tests/unit/GenerateScheduleDialog.banner.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `tests/unit/GenerateScheduleDialog.banner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerateScheduleDialog } from '@/components/scheduling/ShiftPlanner/GenerateScheduleDialog';

vi.mock('@/hooks/useSendAvailabilityReminder', () => ({
  useSendAvailabilityReminder: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 }),
    isPending: false,
  }),
}));

const employees = [
  { id: 'e1', name: 'Alice', position: 'Server', status: 'active' as const },
  { id: 'e2', name: 'Bob',   position: 'Cook',   status: 'active' as const },
  { id: 'e3', name: 'Carol', position: 'Server', status: 'active' as const },
];
const availability = [
  // Only Alice has availability — Bob and Carol are missing
  {
    id: 'av1', restaurant_id: 'r1', employee_id: 'e1', day_of_week: 1,
    start_time: '09:00:00', end_time: '17:00:00', is_available: true,
    notes: null, created_at: '', updated_at: '',
  },
] as never;

function makeProps(overrides = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    employees,
    existingShifts: [],
    weekStart: new Date('2026-05-25T00:00:00Z'),
    weekEnd:   new Date('2026-05-31T23:59:59Z'),
    isGenerating: false,
    onGenerate: vi.fn(),
    templates: [],
    availability,
    generationResult: null,
    generationError: null,
    onRetry: vi.fn(),
    restaurantId: 'r1',
    ...overrides,
  };
}

function renderDialog(props = makeProps()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GenerateScheduleDialog {...props} />
    </QueryClientProvider>,
  );
}

describe('GenerateScheduleDialog — missing availability banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows banner with the correct count when employees are missing availability', () => {
    renderDialog();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/2 employees can.+t be scheduled/i);
  });

  it('does not render the banner when all employees have availability', () => {
    renderDialog(
      makeProps({
        availability: employees.map((e, i) => ({
          id: `av-${e.id}`,
          restaurant_id: 'r1',
          employee_id: e.id,
          day_of_week: 1,
          start_time: '09:00:00',
          end_time: '17:00:00',
          is_available: true,
          notes: null,
          created_at: '',
          updated_at: '',
        })),
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('omits the no_availability group from Section 3 when the banner is visible', () => {
    renderDialog();
    // Section 3 header is rendered for OTHER warnings; "No availability set" must not appear
    expect(screen.queryByText(/no availability set/i)).toBeNull();
  });

  it('opens the BulkSetAvailabilitySheet when "Set defaults" is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set defaults/i }));
    // Sheet's title acts as our hook
    expect(screen.getByText(/set default availability/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/GenerateScheduleDialog.banner.test.tsx
```

Expected: FAIL — banner not rendered / sheet not present / `restaurantId` prop missing.

- [ ] **Step 3: Add `restaurantId` to dialog props and wire the banner**

Edit `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`:

3a. Add new imports after the existing import block (around line 17):

```ts
import { MissingAvailabilityBanner } from '@/components/scheduling/availability/MissingAvailabilityBanner';
import { BulkSetAvailabilitySheet } from '@/components/scheduling/availability/BulkSetAvailabilitySheet';
import { useEmployeesMissingAvailability } from '@/hooks/useEmployeesMissingAvailability';
import { useSendAvailabilityReminder } from '@/hooks/useSendAvailabilityReminder';
import { deriveDefaultAvailability } from '@/lib/availabilityDefaults';
```

3b. Extend `Employee` interface in this file to include `status`. Locate:

```ts
interface Employee {
  id: string;
  name: string;
  position: string;
}
```

Replace with:

```ts
interface Employee {
  id: string;
  name: string;
  position: string;
  status?: 'active' | 'inactive' | 'terminated';
}
```

3c. Add `restaurantId` to `GenerateScheduleDialogProps`:

```ts
interface GenerateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  restaurantId: string;            // NEW
  existingShifts: Shift[];
  // … rest unchanged
}
```

And add `restaurantId` to the destructured props at the top of the component:

```ts
export function GenerateScheduleDialog({
  open,
  onOpenChange,
  employees,
  restaurantId,                    // NEW
  existingShifts,
  // … rest unchanged
}
```

3d. Inside the component, add the banner state, derive missing employees, derive defaults:

Add immediately after `const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());`:

```ts
const [bulkSheetOpen, setBulkSheetOpen] = useState(false);
const reminder = useSendAvailabilityReminder();

const missingAvailabilityEmployees = useEmployeesMissingAvailability(
  employees as { id: string; name: string; status?: 'active' | 'inactive' | 'terminated' }[],
  availability,
);

const defaultAvailability = useMemo(
  () => deriveDefaultAvailability({ templates }),
  [templates],
);
```

3e. Update the `warningGroups` `useMemo` to exclude `no_availability` when the banner will render:

Locate the existing `warningGroups` block. Replace it with:

```ts
const showBanner = missingAvailabilityEmployees.length > 0 && phase === 'config';

const warningGroups = useMemo(() => {
  const groups = new Map<string, { label: string; items: typeof warnings }>();
  const typeLabels: Record<string, string> = {
    no_availability: 'No availability set',
    limited_availability: 'Limited availability',
    position_mismatch: 'No matching templates',
    no_time_overlap: 'No time overlap with templates',
  };
  for (const w of warnings) {
    if (showBanner && w.type === 'no_availability') continue;
    const group = groups.get(w.type) ?? { label: typeLabels[w.type] ?? w.type, items: [] };
    group.items.push(w);
    groups.set(w.type, group);
  }
  return groups;
}, [warnings, showBanner]);
```

3f. Render the banner immediately AFTER `<DialogHeader>` closes, BEFORE the `phase === 'config'` content. Locate the `</DialogHeader>` line and add this block after it:

```tsx
{showBanner && (
  <MissingAvailabilityBanner
    count={missingAvailabilityEmployees.length}
    onSetDefaults={() => setBulkSheetOpen(true)}
    onSendReminder={() =>
      reminder.mutate({
        restaurantId,
        employeeIds: missingAvailabilityEmployees.map((e) => e.id),
      })
    }
    reminderPending={reminder.isPending}
  />
)}
```

3g. Render the Sheet just before the closing `</Dialog>`:

```tsx
<BulkSetAvailabilitySheet
  open={bulkSheetOpen}
  onOpenChange={setBulkSheetOpen}
  restaurantId={restaurantId}
  employees={employees as {
    id: string;
    name: string;
    status: 'active' | 'inactive' | 'terminated';
    position?: string;
  }[]}
  preCheckedIds={missingAvailabilityEmployees.map((e) => e.id)}
  defaults={defaultAvailability}
/>
```

- [ ] **Step 4: Pass `restaurantId` from `ShiftPlannerTab`**

Edit `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — find the `<GenerateScheduleDialog` JSX (around line 676) and add `restaurantId={restaurantId}` to its prop list. Example:

```tsx
<GenerateScheduleDialog
  open={generateDialogOpen}
  onOpenChange={setGenerateDialogOpen}
  restaurantId={restaurantId}
  employees={employees}
  // … rest unchanged
/>
```

- [ ] **Step 5: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/GenerateScheduleDialog.banner.test.tsx
```

Expected: 4 passing tests.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx \
        src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx \
        tests/unit/GenerateScheduleDialog.banner.test.tsx
git commit -m "feat(scheduling): banner + bulk-set sheet on GenerateScheduleDialog"
```

---

## Task 10 — `EmployeeDialog` availability section (TDD)

**Files:**
- Modify: `src/components/EmployeeDialog.tsx`
- Test:   `tests/unit/EmployeeDialog.availabilitySection.test.tsx`

> **Approach:** This task is split into three commits for safety:
> 10A. Footer extraction (refactor only, no behavior change).
> 10B. Add availability section state + UI.
> 10C. Wire RPC call after successful employee insert.

### 10A. Footer extraction

- [ ] **Step 1: Refactor `EmployeeDialog` to put `DialogFooter` outside the scroll container**

Edit `src/components/EmployeeDialog.tsx`. Locate the `<DialogContent>` around line 524:

```tsx
<DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
```

Replace with the layout pattern from `GenerateScheduleDialog`:

```tsx
<DialogContent className="sm:max-w-[500px] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
```

Wrap the existing form body (everything that was previously scrollable) in a scroll container. The footer must move out of that container. Concretely:

Locate the `<form onSubmit={handleSubmit}>` around line 528 and structure it as:

```tsx
<form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
  <div className="flex-1 overflow-y-auto px-6 py-5">
    {/* everything that was inside the form except <DialogFooter> */}
  </div>
  <DialogFooter className="px-6 py-4 border-t border-border/40">
    {/* existing footer buttons */}
  </DialogFooter>
</form>
```

Visual diff guidance: the existing markup inside `<form>` should stay byte-for-byte the same except wrapped in the new scroll div, and `<DialogFooter>` is moved outside that scroll div but still inside the `<form>` so submit still works.

- [ ] **Step 2: Typecheck + visual sanity test**

```bash
npm run typecheck
npm test -- --run tests/unit/EmployeeDialog 2>&1 | tail -20
```

Expected: typecheck passes; any pre-existing `EmployeeDialog` tests still pass (no behavior change).

- [ ] **Step 3: Commit refactor**

```bash
git add src/components/EmployeeDialog.tsx
git commit -m "refactor(EmployeeDialog): extract footer outside scrollable body"
```

### 10B. Add availability section state + UI

- [ ] **Step 1: Write the failing test (covers full path, including 10C wiring)**

Create `tests/unit/EmployeeDialog.availabilitySection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployeeDialog } from '@/components/EmployeeDialog';

const createEmployeeMock = vi.fn();
const insertCompensationHistoryEntryMock = vi.fn();
vi.mock('@/hooks/useEmployees', () => ({
  useCreateEmployee: () => ({
    mutateAsync: createEmployeeMock,
    isPending: false,
  }),
  useUpdateEmployee: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@/hooks/useCompensationHistory', () => ({
  insertCompensationHistoryEntry: insertCompensationHistoryEntryMock,
}));

const bulkMutateMock = vi.fn();
vi.mock('@/hooks/useBulkSetAvailability', () => ({
  useBulkSetAvailability: () => ({
    mutateAsync: bulkMutateMock,
    isPending: false,
  }),
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDialog open onOpenChange={vi.fn()} restaurantId="r1" />
    </QueryClientProvider>,
  );
}

describe('EmployeeDialog — default availability section (create mode)', () => {
  beforeEach(() => {
    createEmployeeMock.mockReset().mockResolvedValue({ id: 'new-emp-1' });
    insertCompensationHistoryEntryMock.mockReset().mockResolvedValue(undefined);
    bulkMutateMock.mockReset().mockResolvedValue({ employees_updated: 1, rows_inserted: 7 });
    toastMock.mockReset();
  });

  it('renders the "Apply default template" radio selected by default in create mode', () => {
    renderDialog();
    expect(
      (screen.getByRole('radio', { name: /apply default template/i }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (screen.getByRole('radio', { name: /set later/i }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('expands the in-place grid (no new dialog) when Edit is clicked', async () => {
    renderDialog();
    const dialogCountBefore = document.querySelectorAll('[role="dialog"]').length;
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const dialogCountAfter = document.querySelectorAll('[role="dialog"]').length;
    expect(dialogCountAfter).toBe(dialogCountBefore); // grid is inline, not a Dialog
    expect(document.getElementById('employee-avail-day-0')).not.toBeNull();
    expect(document.getElementById('employee-avail-day-6')).not.toBeNull();
  });

  it('namespaces grid ids so they cannot collide with the bulk sheet', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(document.getElementById('employee-avail-day-1')).not.toBeNull();
    expect(document.getElementById('bulk-avail-day-1')).toBeNull();
  });

  // 10C wiring — these will fail until the next sub-task is implemented
  it('after employee insert succeeds with "Apply default", calls bulk RPC with [newEmployeeId]', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    await waitFor(() => expect(bulkMutateMock).toHaveBeenCalled());
    expect(bulkMutateMock.mock.calls[0][0].employeeIds).toEqual(['new-emp-1']);
    expect(bulkMutateMock.mock.calls[0][0].restaurantId).toBe('r1');
    expect(bulkMutateMock.mock.calls[0][0].availability).toHaveLength(7);
  });

  it('with "Set later", does NOT call bulk RPC after insert', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /set later/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'New Hire');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    expect(bulkMutateMock).not.toHaveBeenCalled();
  });
});
```

> If `useCompensationHistory` is not the actual module path / export name, locate the real `insertCompensationHistoryEntry` import inside `EmployeeDialog.tsx` and adjust the `vi.mock` to match. Run `grep -n "insertCompensationHistoryEntry" src/components/EmployeeDialog.tsx` to confirm.

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/EmployeeDialog.availabilitySection.test.tsx
```

Expected: FAIL — none of the new UI exists yet.

- [ ] **Step 3: Add availability section state + UI to `EmployeeDialog`**

Edit `src/components/EmployeeDialog.tsx`:

3a. Add imports near the top of the file:

```ts
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AvailabilityGrid, type AvailabilityRowValue } from '@/components/scheduling/availability/AvailabilityGrid';
import { deriveDefaultAvailability } from '@/lib/availabilityDefaults';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';   // see Step 3b
import { useBulkSetAvailability } from '@/hooks/useBulkSetAvailability';
```

3b. Locate the hook in this codebase that returns shift templates for a restaurant. Run:

```bash
grep -rn "shift_templates\|useShiftTemplates\|useTemplates" src/hooks 2>/dev/null | head -5
```

Use the discovered hook name in the import on line 3a. If the existing hook returns `{ templates, … }`, adjust the destructure below accordingly. (`ShiftPlannerTab` already imports this hook — copy its usage.)

3c. Inside the `EmployeeDialog` component, after the existing `const [notes, setNotes] = useState('');` and **only if there is no `employee` prop (create mode)**, add:

```ts
const isCreateMode = !employee;

const [availabilityChoice, setAvailabilityChoice] =
  useState<'apply_default' | 'set_later'>('apply_default');
const [availabilityExpanded, setAvailabilityExpanded] = useState(false);

const { templates: shiftTemplatesForDefaults = [] } = useShiftTemplates(restaurantId);

const defaultAvailability = useMemo<AvailabilityRowValue[]>(
  () => deriveDefaultAvailability({ templates: shiftTemplatesForDefaults }),
  [shiftTemplatesForDefaults],
);
const [availabilityGrid, setAvailabilityGrid] =
  useState<AvailabilityRowValue[]>(defaultAvailability);

useEffect(() => {
  // Re-seed when templates load
  setAvailabilityGrid(defaultAvailability);
}, [defaultAvailability]);

const bulkSetAvailability = useBulkSetAvailability({ silent: true });
```

3d. Add the new section inside the form, after the Notes field block and BEFORE `<DialogFooter>`. The section only renders in create mode:

```tsx
{isCreateMode && (
  <div className="space-y-3 pt-4 border-t border-border/40">
    <Label className="text-[13px] font-semibold">Default availability</Label>
    <RadioGroup
      value={availabilityChoice}
      onValueChange={(v) => setAvailabilityChoice(v as 'apply_default' | 'set_later')}
      className="space-y-2"
    >
      <label className="flex items-start gap-2">
        <RadioGroupItem value="apply_default" id="avail-apply-default" />
        <div className="flex-1">
          <p className="text-[14px] text-foreground">Apply default template</p>
          <p className="text-[12px] text-muted-foreground">
            Mon–Sun {availabilityGrid[1].start_time.slice(0,5)}–{availabilityGrid[1].end_time.slice(0,5)}
          </p>
        </div>
      </label>
      <label className="flex items-start gap-2">
        <RadioGroupItem value="set_later" id="avail-set-later" />
        <p className="text-[14px] text-foreground">Set later</p>
      </label>
    </RadioGroup>

    {availabilityChoice === 'apply_default' && (
      <Collapsible open={availabilityExpanded} onOpenChange={setAvailabilityExpanded}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="link" className="h-auto p-0 text-[13px]">
            {availabilityExpanded ? 'Hide' : 'Edit'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <AvailabilityGrid
            value={availabilityGrid}
            onChange={setAvailabilityGrid}
            idPrefix="employee-avail"
          />
        </CollapsibleContent>
      </Collapsible>
    )}
  </div>
)}
```

- [ ] **Step 4: Run the test — UI assertions should now pass, RPC assertions still fail**

```bash
npm test -- --run tests/unit/EmployeeDialog.availabilitySection.test.tsx
```

Expected: 3 passing (radio default, in-place edit, namespaced ids), 2 failing (RPC wire-up).

- [ ] **Step 5: Commit UI**

```bash
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.availabilitySection.test.tsx
git commit -m "feat(EmployeeDialog): default availability section UI (create mode)"
```

### 10C. Wire RPC call after successful employee insert

- [ ] **Step 1: Locate `createEmployeeWithHistory` (currently `src/components/EmployeeDialog.tsx:270`).**

Inside the `try { const newEmployee = await createEmployee.mutateAsync(employeePayload); … }`, immediately after the successful `insertCompensationHistoryEntry` block, **add** (do NOT remove the existing toast or `onOpenChange(false)` logic):

```ts
if (isCreateMode && availabilityChoice === 'apply_default') {
  try {
    await bulkSetAvailability.mutateAsync({
      restaurantId,
      employeeIds: [newEmployee.id],
      availability: availabilityGrid,
    });
  } catch {
    toast({
      title: 'Employee created',
      description: `${name} was added but default availability didn't save. Set it manually from the team page.`,
      variant: 'default',
    });
  }
}
```

The placement matters: put this block AFTER `insertCompensationHistoryEntry` succeeds and BEFORE the `send-team-invitation` `if (email?.trim())` block, so the employee row + comp history is committed first.

- [ ] **Step 2: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/EmployeeDialog.availabilitySection.test.tsx
```

Expected: 5 passing tests.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit RPC wire-up**

```bash
git add src/components/EmployeeDialog.tsx
git commit -m "feat(EmployeeDialog): apply default availability on create"
```

---

## Task 11 — Edge function `notify-availability-reminder` (TDD on the handler)

**Files:**
- Create: `supabase/functions/_shared/availabilityReminderHandler.ts`
- Create: `supabase/functions/notify-availability-reminder/index.ts`
- Create: `tests/unit/availabilityReminderHandler.test.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the failing handler test**

Create `tests/unit/availabilityReminderHandler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { processAvailabilityReminder, buildDeps } from '@/../supabase/functions/_shared/availabilityReminderHandler';

type FakeClient = {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
};

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const builder = (rows: unknown, error: unknown = null) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows, error }),
    then: undefined as never,
  });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === 'user_restaurants') return builder({ role: 'owner' });
      if (table === 'employees') {
        const fluent = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { id: 'e1', name: 'Alice', email: 'alice@test.com', restaurant_id: 'r1' },
              { id: 'e2', name: 'Bob',   email: null,             restaurant_id: 'r1' },
            ],
            error: null,
          }),
        };
        return fluent;
      }
      if (table === 'restaurants') return builder({ name: 'Wetzel\'s' });
      throw new Error(`unexpected table ${table}`);
    }),
    ...overrides,
  };
}

describe('processAvailabilityReminder', () => {
  it('returns 401 when no authorization header is supplied', async () => {
    const res = await processAvailabilityReminder(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }) }),
      {
        createClient: () => makeClient() as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not a manager', async () => {
    const client = makeClient();
    client.from = vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: 'staff' }, error: null }),
        };
      }
      return makeClient().from(table);
    });
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => client as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(403);
  });

  it('skips employees with null email and counts them as skipped_no_email', async () => {
    const sendEmail = vi.fn().mockResolvedValue(true);
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1', 'e2'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail,
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: 1, skipped_no_email: 1, errors: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][2]).toBe('alice@test.com'); // to
  });

  it('counts sendEmail failures in errors', async () => {
    const sendEmail = vi.fn().mockResolvedValue(false);
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1', 'e2'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail,
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    const body = await res.json();
    expect(body).toEqual({ sent: 0, skipped_no_email: 1, errors: 1 });
  });
});

describe('buildDeps', () => {
  const ENV_BACKUP = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('throws when APP_URL is missing', () => {
    delete process.env.APP_URL;
    process.env.RESEND_API_KEY = 'k';
    expect(() => buildDeps({ env: process.env as Record<string, string> })).toThrow(/APP_URL/);
  });

  it('throws when RESEND_API_KEY is missing', () => {
    process.env.APP_URL = 'https://app';
    delete process.env.RESEND_API_KEY;
    expect(() => buildDeps({ env: process.env as Record<string, string> })).toThrow(/RESEND_API_KEY/);
  });
});
```

> Vitest cannot import `.ts` files from `supabase/functions/_shared/` via Deno-style URL imports. The handler module below uses **Node-importable** code (`import { createClient } from '@supabase/supabase-js'`); the Deno entry (`index.ts`) re-wraps it with Deno's `Deno.env.get`. This split is the well-trodden Sonar 80% lesson pattern.

- [ ] **Step 2: Run the test to confirm RED**

```bash
npm test -- --run tests/unit/availabilityReminderHandler.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/_shared/availabilityReminderHandler.ts`:

```ts
// Pure handler for notify-availability-reminder.
// The Deno entry injects real Supabase / Resend clients via Deps;
// tests inject mocks. No top-level env reads.

type CreateClientFn = (authHeader: string | null) => {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => {
    select: (cols?: string) => {
      eq: (col: string, val: unknown) => {
        eq?: (col: string, val: unknown) => unknown;
        in?: (col: string, vals: unknown[]) => Promise<{ data: unknown; error: unknown }>;
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export type SendEmailFn = (
  resendApiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
) => Promise<boolean>;

export interface ReminderDeps {
  createClient: CreateClientFn;
  sendEmail: SendEmailFn;
  appUrl: string;
  resendApiKey: string;
  fromEmail: string;
}

type EmployeeRow = { id: string; name: string; email: string | null; restaurant_id: string };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export function buildDeps(args: {
  env: Record<string, string | undefined>;
  createClient?: CreateClientFn;
  sendEmail?: SendEmailFn;
}): ReminderDeps {
  const appUrl = args.env.APP_URL;
  const resendApiKey = args.env.RESEND_API_KEY;
  if (!appUrl) throw new Error('APP_URL is not configured');
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not configured');
  return {
    appUrl,
    resendApiKey,
    fromEmail: args.env.NOTIFICATION_FROM ?? 'EasyShiftHQ <notifications@easyshifthq.com>',
    createClient:
      args.createClient ??
      (() => {
        throw new Error('createClient not provided');
      }),
    sendEmail:
      args.sendEmail ??
      (() => {
        throw new Error('sendEmail not provided');
      }),
  };
}

export async function processAvailabilityReminder(
  req: Request,
  deps: ReminderDeps,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const supabase = deps.createClient(authHeader);
  const { data: userRes, error: authErr } = await supabase.auth.getUser();
  if (authErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => null)) as
    | { restaurant_id?: string; employee_ids?: string[] }
    | null;
  const restaurantId = body?.restaurant_id;
  const employeeIds = body?.employee_ids ?? [];
  if (!restaurantId || employeeIds.length === 0) {
    return json({ error: 'restaurant_id and employee_ids are required' }, 400);
  }

  // Manager check
  const userRes2 = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', userRes.user.id)
    .eq('restaurant_id', restaurantId)
    .single();
  const role = (userRes2.data as { role?: string } | null)?.role;
  if (!role || !['owner', 'manager'].includes(role)) {
    return json({ error: 'Access denied' }, 403);
  }

  // Restaurant name (for email subject)
  const restRes = await supabase
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .single();
  const restaurantName = (restRes.data as { name?: string } | null)?.name ?? 'Your restaurant';

  // Employees — INLINE restaurant_id filter (do NOT reuse getEmployeeEmails)
  const empRes = await supabase
    .from('employees')
    .select('id, name, email, restaurant_id')
    .eq('restaurant_id', restaurantId)
    .in('id', employeeIds);
  const employees = (empRes.data ?? []) as EmployeeRow[];

  let sent = 0;
  let skipped_no_email = 0;
  let errors = 0;

  const results = await Promise.allSettled(
    employees.map(async (emp) => {
      if (!emp.email) {
        skipped_no_email++;
        return;
      }
      const subject = `Set your availability — ${restaurantName}`;
      const html = `
        <p>Hi ${emp.name},</p>
        <p>Your manager is preparing next week's schedule and you don't have availability set in EasyShift yet. Setting your availability helps you get scheduled for the shifts you can actually work.</p>
        <p><a href="${deps.appUrl}/availability">Set yours now</a></p>
        <p>— The ${restaurantName} team</p>
      `;
      const ok = await deps.sendEmail(deps.resendApiKey, deps.fromEmail, emp.email, subject, html);
      if (ok) sent++;
      else errors++;
    }),
  );
  for (const r of results) {
    if (r.status === 'rejected') errors++;
  }

  return json({ sent, skipped_no_email, errors }, 200);
}
```

- [ ] **Step 4: Implement the Deno entry**

Create `supabase/functions/notify-availability-reminder/index.ts`:

```ts
// deno-lint-ignore-file
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail, NOTIFICATION_FROM } from '../_shared/notificationHelpers.ts';
import { processAvailabilityReminder, buildDeps } from '../_shared/availabilityReminderHandler.ts';

const deps = buildDeps({
  env: {
    APP_URL: Deno.env.get('APP_URL') ?? undefined,
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? undefined,
    NOTIFICATION_FROM: NOTIFICATION_FROM,
  },
  createClient: (authHeader) =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: authHeader ? { Authorization: authHeader } : {} } },
    ) as never,
  sendEmail: (key, from, to, subject, html) => sendEmail(key, from, to, subject, html),
});

serve((req) => processAvailabilityReminder(req, deps));
```

- [ ] **Step 5: Register the function in `supabase/config.toml`**

Find the alphabetical position for `notify-availability-reminder` in `supabase/config.toml` and add:

```toml
[functions.notify-availability-reminder]
verify_jwt = true
```

- [ ] **Step 6: Run the test to confirm GREEN**

```bash
npm test -- --run tests/unit/availabilityReminderHandler.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/availabilityReminderHandler.ts \
        supabase/functions/notify-availability-reminder/index.ts \
        supabase/config.toml \
        tests/unit/availabilityReminderHandler.test.ts
git commit -m "feat(edge): notify-availability-reminder split-handler function"
```

---

## Task 12 — Final integration verify (typecheck + full test suite + build)

**Files:** none

- [ ] **Step 1: Type-check the whole repo**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: zero errors. If there are warnings introduced by new files, fix them inline — do not suppress.

- [ ] **Step 3: Full test suite**

```bash
npm test -- --run 2>&1 | tail -25
```

Expected: previously-recorded baseline + the count of new tests added across Tasks 1, 2, 4, 5, 7, 8, 9, 10, 11. (Approximately 4012 → 4012 + ~38.) No failures, no new skips.

- [ ] **Step 4: Production build**

```bash
npm run build
```

Expected: build succeeds, no new bundle-size warnings beyond preexisting ones.

- [ ] **Step 5: Update progress.md**

Edit `progress.md` and mark "Phase 4–9: Build, verify, ship" in-progress, with these sub-items checked: build complete, local verify complete. Then commit:

```bash
git add progress.md
git commit -m "chore(progress): mark Phase 4-9 build + local verify complete"
```

---

## Task 13 — Push and open PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/employee-availability-onboarding
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(scheduling): availability onboarding loop — banner + bulk-set + create-time prompt" --body "$(cat <<'EOF'
## Summary
- Adds a missing-availability banner to `GenerateScheduleDialog` (role="alert", iPhone-SE visible) with two CTAs: open the bulk-set sheet, or email a reminder.
- Adds `BulkSetAvailabilitySheet` (shadcn `Sheet`, not Dialog — avoids stacked-dialog focus bugs) with employee checklist + 7-day editable grid.
- Adds an inline "Default availability" section to `EmployeeDialog` (create mode) — `<RadioGroup>` between "Apply default template" (default) and "Set later"; in-place `<Collapsible>` Edit, never a new dialog.
- New RPC `bulk_set_employee_availability` (SECURITY DEFINER, owner/manager only, tenant-validated, idempotent delete-then-insert in one statement, supports multi-window-per-day).
- New edge function `notify-availability-reminder` (verify_jwt=true, anon-key + forwarded auth, inline restaurant_id filter on employees, fail-fast on missing APP_URL/RESEND_API_KEY).
- New composite index `idx_employee_availability_restaurant_employee_day` (CONCURRENTLY).

## Test plan
- [ ] Generate Schedule on the affected restaurant — verify banner shows the right count.
- [ ] Click "Set defaults" → sheet opens with all missing employees pre-checked → apply → toast → re-generate fills more slots.
- [ ] Click "Email reminder" → toast confirms send → check Resend log → employee receives email.
- [ ] Create a new employee with "Apply default" selected → verify 7 availability rows exist.
- [ ] Create a new employee with "Set later" → verify no availability rows are written.
- [ ] Manager who is NOT owner gets the same UI; staff cannot reach the dialog at all.
- [ ] Cross-tenant injection attempt on the RPC returns 23503.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI**

Watch the PR's checks until they all pass. If any check fails:
1. Read the failure output.
2. Fix the underlying issue (NEVER `--no-verify` or skip hooks).
3. Create a new commit with the fix.
4. Push.

- [ ] **Step 4: Update progress.md to "Ready for review"**

```bash
git add progress.md
git commit -m "chore(progress): mark feature ready for review"
git push
```

---

## Self-Review

### Spec coverage check

Re-reading `docs/superpowers/specs/2026-05-21-employee-availability-onboarding-design.md`:

| Spec requirement | Task that implements it |
|---|---|
| `deriveDefaultAvailability` pure util | Task 1 |
| Banner on `GenerateScheduleDialog` w/ `role="alert"`, `aria-live="polite"`, min-h-[44px] CTAs | Task 7 + Task 9 |
| Banner moved below header (not between sections) | Task 9 Step 3f |
| `no_availability` excluded from Section 3 when banner present | Task 9 Step 3e |
| `BulkSetAvailabilitySheet` = shadcn `Sheet` (not Dialog) | Task 8 |
| Pre-checked = missing employees; alphabetical; no search | Task 8 |
| 7-day `<table>` w/ `sr-only` `<caption>` | Task 6 (`AvailabilityGrid`) |
| `<TimeInput>` reuse | Task 6 |
| Namespaced ids `bulk-avail-day-N` vs `employee-avail-day-N` | Task 6 idPrefix + Task 8/10 consumer ids |
| Submit-disabled w/ `aria-disabled` + descriptive label | Task 8 |
| "Email reminder" button spinner while pending | Task 7 |
| `EmployeeDialog` footer outside scroll container BEFORE adding section | Task 10A |
| `<RadioGroup>` for Apply default / Set later | Task 10B |
| In-place `<Collapsible>` Edit, never new Dialog | Task 10B + test guard |
| RPC sig + all error codes (42501 / 23503 / 22003 / 22004) | Task 3 |
| RPC requires `is_available` explicitly (no silent default) | Task 3 |
| RPC empty-array returns (0, 0) | Task 3 + pgTAP test 6 |
| Composite index CONCURRENTLY | Task 3 |
| Multi-window-per-day supported by RPC | Task 3 + pgTAP test 9 |
| Edge fn = split-handler pattern (Sonar 80%) | Task 11 |
| Edge fn = anon-key + forwarded auth (NOT service-role) | Task 11 |
| Edge fn = inline restaurant_id filter on employees (NOT `getEmployeeEmails`) | Task 11 |
| Edge fn = fail-fast on missing APP_URL and RESEND_API_KEY | Task 11 + tests |
| Edge fn HTTP 401/403/500 contract | Task 11 + tests |
| `useBulkSetAvailability` w/ `silent: true` opt-in | Task 4 + test |
| `useSendAvailabilityReminder` both `mockRejected` and `mockResolved({error})` paths | Task 5 + tests |
| `EmployeeDialog` toast warning on availability RPC failure | Task 10C |
| Query invalidation `['employee-availability', restaurant_id]` | Task 4 onSuccess |
| `verify_jwt = true` for edge function | Task 11 config.toml |

All spec requirements have an implementing task.

### Placeholder scan

Searched for "TBD", "TODO", "implement later", "fill in", "similar to Task" — none present in this plan.

### Type-consistency scan

- `AvailabilityRowValue` is the type exported by `AvailabilityGrid.tsx` (Task 6). `BulkSetAvailabilitySheet` (Task 8), `GenerateScheduleDialog` (Task 9), and `EmployeeDialog` (Task 10) all import it from that file — matches.
- `AvailabilityWindow` is the hook-facing type in `useBulkSetAvailability.ts` (Task 4). It has the same 4 fields as `AvailabilityRowValue`. They are intentionally distinct symbols so the hook stays decoupled from the grid component; consumers pass the grid value directly, which is structurally compatible.
- `BulkSetAvailabilityArgs.employeeIds: string[]` matches the RPC param `p_employee_ids UUID[]` (Task 3) — at the JS layer they're strings.
- The pgTAP test inserts into `employees(id, restaurant_id, name, status)` — confirm this matches the real `employees` columns by spot-checking before running. (If `status` is not a column on `employees` in this repo, change to `is_active = true` per the column actually present in `getAllActiveEmployeeEmails`.)
- Query-key kebab-case `'employee-availability'` matches the existing `useEmployeeAvailability` key in `src/hooks/useAvailability.tsx:9` — invalidation reaches the correct query.

### Inconsistencies fixed inline

- Spec said `tests/db/...` for pgTAP; this plan uses `supabase/tests/...` per repo convention (already documented in the Deviations section).
- Spec implied `business_hours` exists on `restaurants`; verified it does not — `deriveDefaultAvailability` keeps the optional parameter but no caller in this PR passes a value.
- Spec query key was snake_case; corrected to kebab-case `'employee-availability'`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-employee-availability-onboarding-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — A fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
