# Employee Availability Onboarding Loop — Design

**Status:** Draft for review
**Date:** 2026-05-21
**Author:** Jose M Delgado (with Claude)
**Branch:** `feature/employee-availability-onboarding`
**Predecessor:** PR #506 — *AI generator respects availability* (commit 152caf30)
**Triggered by:** Production diagnosis of Wetzel's - Cold Stone - Alamo Ranch (restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`) week 2026-05-25 — required 69 slots, AI filled 28 (59% gap).

---

## Problem

PR #506 made the AI scheduler validator correctly reject shifts for employees whose availability is unknown (no rows in `employee_availability`). Production data shows this is the **dominant failure mode**: 20 of 27 active employees at one customer have zero availability rows, so the AI has only 7 candidates for 69 weekly slots.

The validator is doing the right thing — the gap is in **onboarding**:

1. The Generate Schedule dialog doesn't surface *why* employees are being skipped.
2. There's no bulk way for a manager to seed availability across multiple employees.
3. The new-employee form (`EmployeeDialog`) never asks for availability, so every new hire defaults to "missing."

Symptom managers see: AI produces a partial schedule with open slots. They have no clear next step besides clicking into each employee one by one to set 7 days of availability.

## Goals

Make it easy for a manager — within a single session of the Generate Schedule dialog — to:

- See that N employees are blocking the schedule because they lack availability.
- Apply a sensible default template to those employees in one action.
- Optionally email those employees a reminder to set their own availability.
- For new hires: set availability at creation time so the next "missing availability" count doesn't grow.

Out of goal: replacing the per-employee detailed availability editor (`AvailabilityDialog`). That continues to exist for fine-tuning.

## Non-goals (deferred)

These items from the production diagnosis are **not** in scope for this PR:

- **D.** AI prompt fixes for area + day-aware close end-time
- **E.** Per-restaurant "assume fully available when missing" toggle
- **F.** Kiosk self-service availability flow
- **G.** AI prompt enrichment with non-schedulable count
- **H.** `staffing_settings.min_crew` fallback to templates

Each of these is a separate follow-up.

## Confirmed product decisions

From brainstorm Q&A on 2026-05-21:

| Question | Decision |
|---|---|
| Banner stance | **Hint, non-blocking.** Generate button remains enabled. |
| Bulk default | **Derived from active shift templates** (earliest start, latest end across all templates touching a given `day_of_week`), falling back to `restaurants.business_hours`. |
| Reminder channel | **Email only** (Resend). No push, no in-app banner. |
| Employee form UX | **Inline optional section** in the same dialog; default = "Apply default template," alternative = "Set later." |

## Architecture

### Data flow

```
GenerateScheduleDialog
  │
  ├─ existing prop: employees[], availability[], templates[]
  │   → derives missingAvailabilityEmployees (client-side, no new fetch)
  │
  ├─ NEW: amber banner in config phase
  │   ├─ text: "{N} {employee/s} can't be scheduled — availability missing"
  │   ├─ button: "Set defaults" → opens BulkSetAvailabilityDialog
  │   └─ button: "Email reminder" → calls useSendAvailabilityReminder
  │
  └─ NEW: BulkSetAvailabilityDialog
      │
      ├─ selectable employee list (pre-checked = those missing availability)
      ├─ editable 7-day grid (defaults from deriveDefaultAvailability(templates, business_hours))
      ├─ submit → bulk_set_employee_availability RPC
      └─ on success: invalidates ['employee_availability'] queries; toast

EmployeeDialog
  │
  ├─ NEW: "Default availability" section in create mode
  │   ├─ radio: "Apply default template" (default) | "Set later"
  │   └─ if apply: shows the same 7-day grid (defaults from same util)
  │
  └─ on submit: after employees insert succeeds, if "Apply default" selected,
     calls the same RPC with [newEmployeeId]
```

### New code surfaces

#### Pure utilities

**`src/lib/availabilityDefaults.ts`** (new) — one exported function:

```ts
type RestaurantBusinessHours = {
  // existing restaurants.business_hours JSONB shape
  [dayOfWeek: number]: { open: string; close: string; is_closed: boolean } | null;
};

type ShiftTemplateForDefaults = {
  days: number[];        // shift_templates.days int[]
  start_time: string;    // 'HH:MM:SS' local
  end_time: string;      // 'HH:MM:SS' local
};

type AvailabilityDefault = {
  day_of_week: number;        // 0–6
  start_time: string;         // 'HH:MM:SS'
  end_time: string;           // 'HH:MM:SS'
  is_available: boolean;      // false when closed day with no template
};

export function deriveDefaultAvailability(args: {
  templates: ShiftTemplateForDefaults[];
  businessHours?: RestaurantBusinessHours | null;
}): AvailabilityDefault[];  // length 7, one per day_of_week
```

Algorithm per day_of_week 0–6:
1. Filter templates where `day_of_week ∈ template.days`.
2. If any: `start_time = MIN(template.start_time)`, `end_time = MAX(template.end_time)`, `is_available = true`.
3. Else if `businessHours[day_of_week]?.is_closed === false`: use business_hours.
4. Else: default to `{ start_time: '09:00:00', end_time: '17:00:00', is_available: false }` so the row exists but excludes the day.

This function is pure and is reused by both `BulkSetAvailabilityDialog` and `EmployeeDialog`.

#### React hooks

**`src/hooks/useEmployeesMissingAvailability.ts`** (new) — derives the list from already-fetched data:

```ts
function useEmployeesMissingAvailability(
  employees: Employee[],
  availability: EmployeeAvailability[],
): Employee[];
```

Filters active employees that have **zero** matching rows in `availability`. No network call.

**`src/hooks/useBulkSetAvailability.ts`** (new) — wraps `useMutation` over the new RPC. Includes a `silent: true` opt-in (per the 2026-05-16 bulk-mutation lesson) for use from `EmployeeDialog` where the parent owns the success toast.

**`src/hooks/useSendAvailabilityReminder.ts`** (new) — wraps `useMutation` over `supabase.functions.invoke('notify-availability-reminder', …)`. Both `mockRejectedValue` and `mockResolvedValue({error})` paths covered in tests (per the 2026-05-14 invoke-contract lesson).

#### React components

**`src/components/scheduling/availability/BulkSetAvailabilityDialog.tsx`** (new) — shadcn `Dialog`. Two-pane layout:
- Left: searchable employee checkbox list (pre-checked = those missing availability).
- Right: 7-day grid with start/end time inputs and an "Available" checkbox per row, defaulted from `deriveDefaultAvailability`.
- Submit button: `Apply to N employees`.

**`src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`** (modify): insert banner between `Section 1 — Employees` and `Section 2`. Banner only renders when `missingCount > 0`. Hidden when `missingCount === 0` so the dialog stays clean for fully-set teams.

**`src/components/EmployeeDialog.tsx`** (modify): add a new section *Default availability* visible only in create mode (when there's no `employeeId`). Two radios + the same 7-day grid (read-only label form: "Mon 10:00–22:00 ✓") with an "Edit" link that flips the grid to editable.

### Backend: one new RPC + one new edge function

#### RPC: `bulk_set_employee_availability`

Migration file: `supabase/migrations/<ts>_bulk_set_employee_availability.sql`.

```sql
CREATE OR REPLACE FUNCTION public.bulk_set_employee_availability(
  p_restaurant_id   UUID,
  p_employee_ids    UUID[],
  p_availability    JSONB    -- array of {day_of_week, start_time, end_time, is_available}
)
RETURNS TABLE (
  employees_updated  INTEGER,
  rows_inserted      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_inserted INTEGER := 0;
  v_employees_updated INTEGER := 0;
BEGIN
  -- Authz: caller must be owner/manager of the restaurant
  IF NOT public.user_has_restaurant_access(p_restaurant_id, true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Validate employees belong to the restaurant (defense-in-depth alongside FK)
  IF EXISTS (
    SELECT 1 FROM unnest(p_employee_ids) AS eid
    WHERE NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = eid AND restaurant_id = p_restaurant_id
    )
  ) THEN
    RAISE EXCEPTION 'employee_not_in_restaurant' USING ERRCODE = '23503';
  END IF;

  -- Delete + insert in one transaction. Days specified in p_availability
  -- replace any existing rows for those (employee, day) tuples.
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
      COALESCE((a->>'is_available')::boolean, true)
    FROM unnest(p_employee_ids) AS eid
    CROSS JOIN jsonb_array_elements(p_availability) AS a
    RETURNING 1
  )
  SELECT
    COUNT(*) FILTER (WHERE TRUE),
    array_length(p_employee_ids, 1)
  INTO v_rows_inserted, v_employees_updated
  FROM inserted;

  RETURN QUERY SELECT v_employees_updated, v_rows_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) TO authenticated;
```

Notes:
- `SECURITY DEFINER` + explicit `user_has_restaurant_access(..., true)` check is the pattern already used by `user_has_restaurant_access` itself (require_manager_role).
- The validator check ensures cross-tenant employee IDs can't be smuggled into one restaurant's call.
- No new schema constraint. Delete+insert handles "existing rows for those days" idempotently. Days NOT in `p_availability` are left untouched (so calling with only `[{day_of_week:1, ...}]` only replaces Monday, not the rest).
- pgTAP test covers: happy path, manager-role enforcement (staff role gets `42501`), tenant isolation (employee from another restaurant gets `23503`), idempotent re-application.

#### Edge function: `notify-availability-reminder`

Split-handler pattern per the 2026-05-11 Sonar coverage lesson:
- `supabase/functions/_shared/availabilityReminderHandler.ts` — pure `processAvailabilityReminder(req, deps)` for vitest.
- `supabase/functions/notify-availability-reminder/index.ts` — small entry: reads env, builds deps, returns response.

Auth gate (per the 2026-05-13 verify_jwt lesson): this function is called from the **browser** with the manager's JWT, so `verify_jwt = true` (default). No service-role Bearer check needed; RLS-via-RPC verifies the caller can see those employees.

Request body:
```ts
{
  restaurant_id: string;
  employee_ids: string[];
}
```

Handler logic:
1. Verify caller has manager access to `restaurant_id` (server-side via Supabase client with anon key; RLS does the work).
2. Read employees by id with `restaurant_id` filter — defense-in-depth.
3. For each employee with a non-null email, send a Resend email using the helper from `_shared/notificationHelpers.ts`.
4. Collect `Promise.allSettled` results; return `{ sent: N, skipped_no_email: M, errors: K }`.

Email template (in-handler template literal):

```
Subject: Set your availability — {restaurant_name}

Hi {employee_name},

{manager_name} is preparing next week's schedule and you don't have availability
set in EasyShift yet. Setting your availability helps you get scheduled for the
shifts you can actually work.

Set yours now: {app_url}/availability

Thanks,
The {restaurant_name} team
```

`app_url` comes from a required env var; fail-fast on missing per the 2026-05-14 env-var lesson.

#### Migrations summary

| File | Purpose |
|---|---|
| `supabase/migrations/<ts>_bulk_set_employee_availability.sql` | New RPC |

No table schema changes. No new tables. No new indexes (existing `idx_employee_availability_employee_id` and `idx_employee_availability_restaurant_id` cover the RPC's queries).

### Tests

| Test file | Covers |
|---|---|
| `tests/unit/availabilityDefaults.test.ts` | `deriveDefaultAvailability` — template-derived, business-hours fallback, closed-day, no-data-at-all, multiple templates per day merged |
| `tests/unit/useEmployeesMissingAvailability.test.ts` | Filtering: active vs inactive, zero rows, partial rows (still missing rest), null employee_id |
| `tests/unit/useBulkSetAvailability.test.ts` | Hook: success, RPC error, network error, `silent: true` suppresses toast, invalidates `['employee_availability', restaurant_id]` query |
| `tests/unit/useSendAvailabilityReminder.test.ts` | Hook: both `mockRejectedValue` and `mockResolvedValue({error})` paths |
| `tests/unit/BulkSetAvailabilityDialog.test.tsx` | Renders prechecked list, 7-day grid edit, submit fires mutation with correct payload, closed-day rendered as is_available=false |
| `tests/unit/GenerateScheduleDialog.banner.test.tsx` | Banner shows when missingCount > 0, hidden when 0, both action buttons call props |
| `tests/unit/EmployeeDialog.availabilitySection.test.tsx` | "Apply default template" path triggers RPC after employee insert; "Set later" path does NOT trigger RPC |
| `tests/unit/availabilityReminderHandler.test.ts` | processAvailabilityReminder — auth missing → 401, employee not in restaurant → skipped, email send failure → counted in `errors` |
| `tests/db/bulk_set_employee_availability.spec.sql` (pgTAP) | RPC: happy path, staff-role denied, cross-tenant employee_id rejected, idempotent re-run preserves count |

### Error handling

| Failure | UX |
|---|---|
| RPC returns `forbidden` (42501) | Toast: "You don't have permission to set availability for these employees." |
| RPC returns `employee_not_in_restaurant` (23503) | Toast: "One or more employees aren't in this restaurant. Refresh and try again." |
| Network failure on RPC | Toast: "Couldn't save availability. Try again." (catch in `useBulkSetAvailability.onError`) |
| Reminder edge function returns `{ error }` | Toast: "Couldn't send reminders." |
| `EmployeeDialog` — employee insert succeeds but availability RPC fails | Toast warning: "{name} was added but default availability didn't save. Set it manually from the team page." (Employee creation is the primary action and must not roll back.) |

### Accessibility

- Banner has `role="status"` (consistent with PR #506's a11y pattern) so screen readers announce the count.
- Each action button has a descriptive label, not an icon alone.
- BulkSetAvailabilityDialog: focus moves to dialog header on open; ESC closes; submit-disabled state when no employees selected.
- 7-day grid uses semantic `<table>` with row headers per day.
- Time inputs are `<input type="time">` so they get native a11y.

### Performance

- No new network call to render the banner — it derives from already-fetched employees + availability.
- `deriveDefaultAvailability` is pure and O(7 × T) where T = templates ≤ 50 in practice.
- Bulk RPC is one round-trip regardless of N employees × 7 days.
- React Query invalidation: `['employee_availability', restaurant_id]` after RPC success refetches the planner's availability list. No global invalidation.

## Decided trade-offs

- **No multi-row-per-day availability today.** Some restaurants might want "Mon 09:00-13:00 AND 17:00-22:00 available." Schema allows it, but no UI today. This RPC's delete-then-insert idiom preserves that future option (just call with multiple `day_of_week: 1` rows in `p_availability` and they all insert).
- **Reminder is email-only.** Skipping web push for this PR. Employees who don't check email won't see the prompt. If adoption is low, web push is a small follow-up.
- **Banner is non-blocking.** Manager can click Generate with 20 missing. We accept this — the partial-fill UX still works, and forcing a block would frustrate managers who legitimately want a partial schedule. The amber color + count + "Set defaults" CTA are designed to make the right next step obvious.
- **Default template defaults `is_available = true` for open days, `false` for closed.** When a day has no template and no business_hours, we still write a row with `is_available = false` so the AI scheduler has explicit data (no row = "unknown," which is the bug we're fixing).
- **No "delete all availability for employee" affordance here.** That's an `AvailabilityDialog`-scoped concern. Bulk dialog is additive — it overwrites rows for the days you explicitly set, not all days.

## Risk register

| Risk | Mitigation |
|---|---|
| Manager applies defaults, then employee disagrees and starts getting bad shifts | Reminder email links to `/availability` so employees can override. Default is conservative (wide window). |
| Restaurants without business hours configured and without templates | `deriveDefaultAvailability` falls back to a closed-by-default row. Manager sees 7 rows all marked unavailable, which they can edit. |
| 100+ employees in bulk dialog → slow render | Search filter + checkbox virtualization not needed at 30-employee scale; revisit if a customer crosses 200. |
| Pre-existing rows with overnight `end_time < start_time` (relies on the 2026-03-21 overnight migration) | RPC inserts honor the same constraint. We won't be writing overnight defaults; the bulk default never spans midnight. |
| Cross-tenant employee_id injection | RPC's pre-INSERT validator + RLS on the table provide defense-in-depth. |

## Implementation phasing (preview for Phase 3 plan)

1. **Pure utility** (`availabilityDefaults`) — TDD, ~5 tasks
2. **RPC + pgTAP** — migration + tests
3. **Hooks** — `useEmployeesMissingAvailability`, `useBulkSetAvailability`, `useSendAvailabilityReminder`
4. **BulkSetAvailabilityDialog** — component + tests
5. **GenerateScheduleDialog banner** — integration + tests
6. **EmployeeDialog inline section** — modification + tests
7. **Edge function** (`notify-availability-reminder`) — split-handler + tests
8. **Wire-up** — pass props down through `ShiftPlannerTab` → `GenerateScheduleDialog` → banner
9. **Local verify** — typecheck, lint, full test suite, build
10. **Ship** — PR, CI loop, multi-model review, CodeRabbit
