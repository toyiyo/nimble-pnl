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
  ├─ NEW: amber banner BELOW the dialog header (above Section 1)
  │   role="alert" aria-live="polite"
  │   ├─ text: "{N} {employee/s} can't be scheduled — availability missing"
  │   ├─ button: "Set defaults" → opens BulkSetAvailabilitySheet (slides over)
  │   └─ button: "Email reminder" → calls useSendAvailabilityReminder
  │
  ├─ Section 3 (existing) — when banner is shown, EXCLUDE `no_availability`
  │   from warningGroups so the same fact isn't surfaced twice. Banner is
  │   the canonical surface; Section 3 only handles other warnings.
  │
  └─ NEW: BulkSetAvailabilitySheet (NOT a Dialog)
      shadcn `Sheet` (side: "right" on desktop, "bottom" on mobile)
      │
      ├─ scrollable employee checkbox list (pre-checked = those missing)
      │   alphabetical, no search input (defer until customer >40 employees)
      ├─ editable 7-day grid (defaults from deriveDefaultAvailability(templates, business_hours))
      ├─ desktop: single-column on <md, two-column on md+
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

**`src/components/scheduling/availability/BulkSetAvailabilitySheet.tsx`** (new) — shadcn `Sheet`, NOT `Dialog`. This avoids stacked-dialog focus restoration bugs when opened from `GenerateScheduleDialog`. Side = `"right"` on `md+`, side = `"bottom"` on `<md`.
- Responsive layout:
  - `md+`: two columns inside the sheet — left = employee list, right = 7-day grid
  - `<md`: single column — employee list scrolls above the grid
- Employee list: alphabetical checkbox list, pre-checked = those missing availability. **No search input** (defer to a follow-up if a customer crosses 40 employees).
- 7-day grid: semantic `<table>` with `<caption className="sr-only">Weekly availability</caption>`. Row = day, columns = start, end, is_available. Time inputs use the existing `<TimeInput>` component from `AvailabilityDialog` (label + native `<input type="time">` paired via `htmlFor`).
- Per-row checkbox `id` is namespaced: `bulk-avail-day-${dayOfWeek}` so it never collides with the same grid rendered in `EmployeeDialog`.
- Submit button: `Apply to N employees`. When `N === 0`: button is `aria-disabled="true"` with label `"Select at least one employee"`. While pending: button shows spinner.
- Min touch target: every button is `min-h-[44px]`.

**`src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`** (modify):
- Insert banner immediately **below the dialog header**, above Section 1, so it's visible without scrolling on iPhone SE viewport (the original "between Section 1 and Section 2" placement could be off-screen on small viewports when Section 2 also renders).
- Banner conditional render: `missingCount > 0 && <Banner …>` (full DOM removal, not `display: none`).
- Banner ARIA: `role="alert" aria-live="polite"` (NOT `role="status"` — this is an actionable prompt, not a passive notification).
- Banner styling reuses the existing `bg-amber-500/10 border-amber-500/20` semantic tokens from the dialog's existing Section 3 alert. CTAs are `min-h-[44px]` for touch.
- When the banner is rendered, the existing `warningGroups` rendering in Section 3 must **exclude** `no_availability` group so the same fact isn't surfaced twice. Move the exclusion filter into the `warningGroups` `useMemo`.
- "Email reminder" button: disabled with spinner while `useSendAvailabilityReminder` is `isPending`.

**`src/components/EmployeeDialog.tsx`** (modify):
- BEFORE adding the new section, **extract the existing `<DialogFooter>` outside the scrollable `DialogContent`** (same pattern as `GenerateScheduleDialog` lines 421–441: `flex-1 overflow-y-auto` body + fixed `border-t` footer). The dialog is already tall and adding a 7-day grid would push the primary "Add Employee" CTA off-screen on iPhone SE without this.
- Add a *Default availability* section visible **only in create mode** (when there's no `employeeId`). Use shadcn `<RadioGroup>` + `<RadioGroupItem>` (NOT the `aria-pressed` button-toggle pattern used elsewhere in the dialog — radios are correct for binary mutually-exclusive default-selected choices).
- Two options:
  - **Apply default template** (default selected): shows a one-line summary `"Mon–Sun 10:00–22:00"` plus a small `"Edit"` text-button. Clicking `"Edit"` flips the section to expanded mode (`<Collapsible>`) revealing the same 7-day grid as `BulkSetAvailabilitySheet`. Per-row checkbox `id` is namespaced `employee-avail-day-${dayOfWeek}` to avoid DOM collisions.
  - **Set later**: collapses the grid; no availability rows will be written on submit.
- **CRITICAL anti-pattern guard:** The `"Edit"` link must be an **in-place collapsible**, NEVER a new `Dialog`. `EmployeeDialog` already stacks two child dialogs (effective-date modal, high-rate AlertDialog); a third layer is forbidden per CLAUDE.md's single-dialog-at-list-level rule.

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

  -- Empty-array guard (array_length returns NULL for an empty array, which
  -- would otherwise produce NULL in the return column).
  IF array_length(p_employee_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER;
    RETURN;
  END IF;

  -- Validate day_of_week range BEFORE INSERT so we get a clean error code
  -- rather than leaking the underlying CHECK constraint name.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE (elem->>'day_of_week')::int NOT BETWEEN 0 AND 6
  ) THEN
    RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = '22003';
  END IF;

  -- Require is_available to be present in every JSONB element so that
  -- closed-day rows (is_available=false) are never silently flipped to true.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE NOT (elem ? 'is_available')
       OR jsonb_typeof(elem->'is_available') != 'boolean'
  ) THEN
    RAISE EXCEPTION 'is_available_required' USING ERRCODE = '22004';
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
  -- days_to_replace uses IN, which de-duplicates day_of_week values, so
  -- callers may pass multiple JSONB elements per day to support future
  -- multi-window availability (e.g., split shifts).
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
GRANT EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) TO authenticated;

-- Composite index covering the delete predicate exactly. Created CONCURRENTLY
-- because employee_availability is populated in production.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_employee_availability_restaurant_employee_day
  ON employee_availability (restaurant_id, employee_id, day_of_week);
```

Notes:
- `SECURITY DEFINER` + explicit `user_has_restaurant_access(..., true)` check is the pattern already used by `user_has_restaurant_access` itself (require_manager_role).
- The validator check ensures cross-tenant employee IDs can't be smuggled into one restaurant's call.
- `is_available` is REQUIRED in every JSONB element (no silent default) so closed-day rows can't be silently flipped to available.
- Composite index `(restaurant_id, employee_id, day_of_week)` is built CONCURRENTLY to avoid table locks; covers both this RPC's predicate and the existing `check_availability_conflict` RPC.
- No new schema constraint on the table itself. Delete+insert handles "existing rows for those days" idempotently. Days NOT in `p_availability` are left untouched (so calling with only `[{day_of_week:1, ...}]` only replaces Monday, not the rest).
- pgTAP test covers: happy path, manager-role enforcement (staff role gets `42501`), tenant isolation (employee from another restaurant gets `23503`), empty array returns `(0, 0)`, out-of-range day returns `22003`, missing `is_available` returns `22004`, idempotent re-application.

> **Pre-existing tech debt (not fixed in this PR):** `user_has_restaurant_access`
> (migration `20251123100050_create_availability_tables.sql`, line 64) is
> `SECURITY DEFINER` without `SET search_path`. This new RPC is safe because it
> pins its own `search_path = public` before calling the helper, but a follow-up
> migration should add `SET search_path = public, pg_temp` to that helper.

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
1. Verify caller has manager access to `restaurant_id`. Use the **anon-key + forwarded `Authorization` header** pattern from `notify-schedule-published/index.ts` (lines 28–61) — do NOT use `createAuthenticatedClient` (service-role) since that would bypass RLS.
2. Read employees by id with **explicit `.eq('restaurant_id', restaurantId)` filter inline** — do NOT reuse `getEmployeeEmails(supabase, ids[])` from `_shared/notificationHelpers.ts` because that helper has no tenant filter and is a footgun.
3. For each employee with a non-null email, call `sendEmail` from `_shared/notificationHelpers.ts` with the Resend API key.
4. Collect `Promise.allSettled` results; return `{ sent: N, skipped_no_email: M, errors: K }`.

Auth-failure HTTP contract:
- Missing/invalid auth header → respond `401` (not `500`).
- Caller not a manager of the restaurant → respond `403`.
- Any other error → respond `500` with a generic message.

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

`app_url` comes from a required env var (`APP_URL`); **fail-fast on missing** per the 2026-05-14 env-var lesson. **`RESEND_API_KEY` is also fail-fast** — reading it at module level without a null check (the existing `notify-schedule-published` precedent) leads to silent `Authorization: Bearer undefined` Resend calls. Both env vars are validated in the handler's `deps`-building step so vitest can cover the missing-env branch.

#### Migrations summary

| File | Purpose |
|---|---|
| `supabase/migrations/<ts>_bulk_set_employee_availability.sql` | New RPC |
| `supabase/migrations/<ts>_bulk_set_employee_availability_index.sql` | New composite index `idx_employee_availability_restaurant_employee_day` (`CREATE INDEX CONCURRENTLY` — must be its own migration since it cannot run inside a transaction) |

No table schema changes. No new tables. One new composite index (above) that exactly matches the RPC's `restaurant_id + employee_id + day_of_week` delete predicate.

### Tests

| Test file | Covers |
|---|---|
| `tests/unit/availabilityDefaults.test.ts` | `deriveDefaultAvailability` — template-derived, business-hours fallback, closed-day, no-data-at-all, multiple templates per day merged |
| `tests/unit/useEmployeesMissingAvailability.test.ts` | Filtering: active vs inactive, zero rows, partial rows (still missing rest), null employee_id |
| `tests/unit/useBulkSetAvailability.test.ts` | Hook: success, RPC error, network error, `silent: true` suppresses toast, invalidates `['employee_availability', restaurant_id]` query |
| `tests/unit/useSendAvailabilityReminder.test.ts` | Hook: both `mockRejectedValue` and `mockResolvedValue({error})` paths |
| `tests/unit/BulkSetAvailabilitySheet.test.tsx` | Renders prechecked list, 7-day grid edit, submit fires mutation with correct payload, closed-day rendered as is_available=false, mobile single-column layout at <md, submit disabled when 0 selected with proper aria-disabled |
| `tests/unit/GenerateScheduleDialog.banner.test.tsx` | Banner shows when missingCount > 0, hidden (fully unmounted) when 0, `role="alert"` and `aria-live="polite"`, both action buttons call props, reminder button shows spinner while pending, `no_availability` excluded from Section 3 when banner present |
| `tests/unit/EmployeeDialog.availabilitySection.test.tsx` | "Apply default template" path triggers RPC after employee insert; "Set later" path does NOT trigger RPC; collapsible Edit reveals the grid in-place (no new Dialog opened); namespaced checkbox ids; footer outside scroll container |
| `tests/unit/availabilityReminderHandler.test.ts` | processAvailabilityReminder — auth missing → 401, caller not manager → 403, employee not in restaurant → filtered out, email send failure → counted in `errors`, missing `APP_URL` env → throws at deps build, missing `RESEND_API_KEY` env → throws at deps build |
| `tests/db/bulk_set_employee_availability.spec.sql` (pgTAP) | RPC: happy path, staff-role denied (42501), cross-tenant employee_id rejected (23503), empty array returns (0,0), out-of-range day_of_week rejected (22003), missing is_available rejected (22004), idempotent re-run preserves count, multi-window same-day (two day_of_week=1 rows) both insert |

### Error handling

| Failure | UX |
|---|---|
| RPC returns `forbidden` (42501) | Toast: "You don't have permission to set availability for these employees." |
| RPC returns `employee_not_in_restaurant` (23503) | Toast: "One or more employees aren't in this restaurant. Refresh and try again." |
| Network failure on RPC | Toast: "Couldn't save availability. Try again." (catch in `useBulkSetAvailability.onError`) |
| Reminder edge function returns `{ error }` | Toast: "Couldn't send reminders." |
| `EmployeeDialog` — employee insert succeeds but availability RPC fails | Toast warning: "{name} was added but default availability didn't save. Set it manually from the team page." (Employee creation is the primary action and must not roll back.) |

### Accessibility

- Banner has `role="alert" aria-live="polite"` (per the architecture section and design-review fold-ins) so screen readers announce the count as an actionable prompt.
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
| Cross-tenant email leak in edge function via misuse of `getEmployeeEmails` helper (which lacks a `restaurant_id` filter) | Edge function specifies "do NOT reuse `getEmployeeEmails`; query employees inline with explicit `.eq('restaurant_id', restaurantId)`." Documented in the handler-logic section. |
| Stacked-dialog focus restoration bug if `BulkSetAvailabilitySheet` were a `Dialog` | Use shadcn `Sheet` instead of `Dialog` — separate overlay mechanism, no focus-trap conflict with the parent `GenerateScheduleDialog`. |

## Design-review fold-ins (Phase 2.5)

The following critical/major concerns from the Phase 2.5 design reviewers were folded into the design above:

### Supabase reviewer
- **Critical:** Edge function tenant isolation gap — pinned to anon-key + forwarded auth-header pattern, explicit `restaurant_id` filter on the employee query, do-not-reuse `getEmployeeEmails`.
- **Major:** Composite index `(restaurant_id, employee_id, day_of_week)` added, `CREATE INDEX CONCURRENTLY`.
- **Major:** Empty-array guard returning `(0, 0)` so `array_length` never produces `NULL`.
- **Major:** Day-of-week range validation upfront (`22003`).
- **Major:** `user_has_restaurant_access` search-path noted as pre-existing tech debt, deferred to follow-up.
- **Minor:** `RESEND_API_KEY` fail-fast added alongside `APP_URL`.
- **Minor:** HTTP 401/403/500 contract stated explicitly.
- **Minor:** `is_available` made required (no silent default).
- **Minor:** Multi-window-per-day documented in SQL comment.

### Frontend reviewer
- **Critical:** Banner ARIA role changed from `role="status"` to `role="alert"`.
- **Critical:** `BulkSetAvailabilityDialog` reworked as `BulkSetAvailabilitySheet` (shadcn `Sheet`) to avoid stacked-dialog focus-restoration bugs.
- **Critical:** `EmployeeDialog` footer extracted outside scroll container before adding the new section.
- **Major:** Single-column mobile collapse for the Sheet at `<md`.
- **Major:** `<TimeInput>` reuse mandated instead of bare `<input type="time">`.
- **Major:** `no_availability` excluded from Section 3 `warningGroups` when banner is present (deduplication).
- **Major:** Banner moved to immediately below header (not between sections) for iPhone-SE visibility.
- **Major:** Edit affordance in `EmployeeDialog` is an in-place `<Collapsible>` — never a new dialog (CLAUDE.md single-dialog rule).
- **Major:** Banner CTAs are `min-h-[44px]` for touch.
- **Minor:** `<table>` gets `sr-only` `<caption>`; checkbox `id`s namespaced `bulk-avail-day-N` vs `employee-avail-day-N`.
- **Minor:** Submit-disabled state has descriptive label `"Select at least one employee"` with `aria-disabled="true"`.
- **Minor:** "Email reminder" button shows spinner while `isPending`.
- **Minor:** Search input deferred until customer >40 employees; spec says "scrollable" not "searchable".
- **Minor:** Use shadcn `<RadioGroup>` (not button-toggle pattern) for "Apply default / Set later".

### Decisions on minor/declined items

- **Supabase reviewer minor (`is_available` defaulting):** Followed the stricter option — `is_available` is now REQUIRED in every JSONB element. The RPC raises `is_available_required` (22004) if missing.
- **Frontend reviewer minor (search input):** Spec changed from "searchable" to "scrollable, alphabetical" — search deferred to a follow-up if a customer crosses 40 employees.
- **Frontend reviewer minor (`EmployeeDialog` orange palette):** Out of scope for this PR. The new availability section uses semantic tokens (`bg-amber-500/10`, `border-amber-500/20`); pre-existing orange literals are not refactored here.

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
