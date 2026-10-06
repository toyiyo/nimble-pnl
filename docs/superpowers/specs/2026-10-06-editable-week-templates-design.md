# Editable Week Templates — Design

Date: 2026-10-06
Branch: `feature/editable-week-templates`
Status: Draft for design review

## 1. Problem

A manager can save the current week as a template from the Copy Week dialog.
The manager cannot change a template after the save. The manager also cannot
make a template without first building a real week on the calendar. To make a
template, the manager must change live shifts. This is slow and it can change
a schedule that employees already see.

## 2. Goal

Give managers a separate editor for week templates. The editor shows a
Monday-to-Sunday grid with no calendar dates. The manager adds employees and
shifts, saves the template, edits it later, and applies it to a selected week.

Out of scope:

- Open (unassigned) template shifts. Every template shift keeps an employee.
- A change to how the apply step converts times (see section 9).
- Template shifts that carry an area or a `shift_template_id`.

## 3. Current state (cited)

### 3.1 Storage

- Table `schedule_plan_templates` stores one row per template. The shifts are
  one JSONB array in the `shifts` column, with a `shift_count` column
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:4-12`).
- RLS has SELECT, INSERT and DELETE policies. There is no UPDATE policy
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:25-53`).
- Each JSONB element has the `TemplateShiftSnapshot` shape: `day_offset`
  (0 = Monday … 6 = Sunday), `start_time` and `end_time` as `HH:MM:SS`,
  `break_duration`, `position`, `employee_id`, `employee_name`, `notes`
  (`src/types/scheduling.ts:319-328`).

### 3.2 RPCs

- `save_schedule_plan_template` checks only that the caller has a
  `user_restaurants` row. It does not check a role or a capability
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:69-76`).
- The save RPC refuses an empty array and refuses a sixth template
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:78-94`).
- The save RPC does not check the shape of the JSONB elements. It does not
  check that `employee_id` belongs to the restaurant
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:96-98`).
- `apply_schedule_plan_template` is `SECURITY DEFINER`. It checks only
  membership (`supabase/migrations/20260328100000_schedule_plan_templates.sql:126-133`).
  It inserts each element into `shifts` with the given `employee_id` and no
  check that the employee belongs to `p_restaurant_id`
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:148-163`).
- `delete_schedule_plan_template` checks only membership
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:215-221`).
- No RPC updates a template. No later migration changes these functions
  (`grep -l schedule_plan_template supabase/migrations/*` returns one file).

### 3.3 Client

- `useSchedulePlanTemplates` exposes `templates`, `saveTemplate`,
  `applyTemplate` and `deleteTemplate`. It has no update mutation
  (`src/hooks/useSchedulePlanTemplates.ts:10-130`).
- `saveTemplate` takes live `Shift[]` and a week start. It converts them with
  `buildTemplateSnapshot` (`src/hooks/useSchedulePlanTemplates.ts:33-37`).
  `buildTemplateSnapshot` reads local times with `formatLocalTime`
  (`src/lib/schedulePlanTemplates.ts:17-32`, `src/hooks/useShiftPlanner.ts:45-49`).
- `buildShiftsFromTemplate` turns a snapshot into timestamps in the browser
  time zone. When `end <= start`, it moves the end to the next day
  (`src/lib/schedulePlanTemplates.ts:35-74`).
- The Copy Week dialog is the only place that lists, saves, applies and
  deletes templates (`src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:81-88`).
  It caps the list with `MAX_TEMPLATES = 5`
  (`src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:35`).
- The Scheduling page has the tabs Schedule, Time-Off, Availability, Shift
  Trades and Planner (`src/pages/Scheduling.tsx:926-972`). The Shift Trades tab
  shows only when `canManageSchedule` is true
  (`src/pages/Scheduling.tsx:950-963`). `canManageSchedule` is
  `isResolved && hasCapability('edit:scheduling')`
  (`src/pages/Scheduling.tsx:239`). The value is false until permissions
  resolve.
- An effect moves the user back to the Schedule tab when the trades tab is
  active and the capability is false (`src/pages/Scheduling.tsx:319-323`).
- SQL code checks the same capability with
  `user_has_capability(p_restaurant_id, 'edit:scheduling')`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:62`,
  first definition in `supabase/migrations/20260730140000_user_has_capability_from_areas.sql:54-60`).
  The newest definition grants `edit:scheduling` to owner, manager,
  operations_manager and collaborator_operations_manager. Chef gets only
  `view:scheduling`
  (`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:129-130`).

### 3.4 Name conflict

The Planner tab already uses the word "template" for `shift_templates` (shift
definitions per row). The new tab uses the label **Week Templates** to keep the
two ideas apart.

## 4. User decisions (from brainstorm)

| Question | Decision |
|---|---|
| Where does the editor live? | A new **Week Templates** tab on the Scheduling page. Only users with `edit:scheduling` see it. |
| How is a row built? | One row per employee. No open shifts. |
| How are changes saved? | A local draft and an explicit **Save** button. **Discard** drops the draft. A prompt shows before unsaved changes are lost. |
| Template limit | Raise from 5 to 20 per restaurant. |

## 5. Visual design

### 5.1 Desktop (≥ 1024px)

```
Schedule | Time-Off | Availability | Shift Trades | Planner | Week Templates
┌───────────────────────┐ ┌──────────────────────────────────────────────────────────────┐
│ WEEK TEMPLATES   3/20 │ │ [▢] Weekday Lunch (name input)      ● Unsaved                 │
│ [+ New template]      │ │                         [Discard] [Save] [Apply to week…] [⋯] │
│                       │ ├──────────────┬──────┬──────┬──────┬─────┬─────┬─────┬─────┬───┤
│ ▸ Weekday Lunch       │ │ EMPLOYEE     │ MON  │ TUE  │ WED  │ THU │ FRI │ SAT │ SUN │ H │
│   14 shifts · 96h     │ ├──────────────┼──────┼──────┼──────┼─────┼─────┼─────┼─────┼───┤
│   Summer Peak         │ │ Alice        │ 9a–5p│ 9a–5p│  +   │ ... │     │     │     │ 16│
│   22 shifts · 160h    │ │ Server       │Server│Server│      │     │     │     │     │   │
│   Holiday             │ │ Bob          │  +   │11a–7p│11a–7p│     │     │     │10–4p│ 22│
│   9 shifts · 61h      │ │ + Add employee ▾                                            │
│                       │ ├──────────────┼──────┼──────┼──────┼─────┼─────┼─────┼─────┼───┤
│                       │ │ TOTAL        │ 1·8h │2·16h │1·8h  │     │     │     │1·6h │ 38│
└───────────────────────┘ └──────────────┴──────┴──────┴──────┴─────┴─────┴─────┴─────┴───┘
```

- Left pane: a list card per template, with name, shift count and total
  hours. The selected card has `bg-muted/50` and `border-border`.
- Right pane: the editor for the selected template.
- The `⋯` menu holds **Duplicate** and **Delete**.

### 5.2 Mobile (< 1024px)

The list shows first. A tap on a template opens the editor full width, with a
**Back to templates** button. The grid scrolls horizontally inside its own
container (`overflow-x-auto`). The employee column is sticky (`sticky left-0`).
The page itself does not scroll horizontally.

### 5.3 Cells and the shift dialog

- An empty cell shows a `+` button on hover and on focus. The button has
  `aria-label="Add shift for {employee} on {Monday}"`.
- A cell with shifts shows one chip per shift: the time range on line 1 and
  the position on line 2. An overnight shift shows `→` after the end time.
  A chip is a `<button>` with an `aria-label` that names the employee, day and
  times. A click opens the shift dialog in edit mode.
- One `TemplateShiftDialog` instance lives at the editor level (single dialog
  pattern from CLAUDE.md). Fields: Start, End, Break (minutes), Position,
  Notes, and a **Days** toggle group (Mon … Sun). The Days group lets the
  manager add the same shift to many days in one step. In edit mode the Days
  group is hidden, and the dialog shows a **Delete shift** button.
- The dialog shows an inline error when the shift overlaps another shift of
  the same employee on the same day. Save is disabled until the error is gone.
  Start equal to End is an error.

### 5.4 Rows

- **Add employee** is a `Select` of active employees that are not already
  rows. A new row starts empty. Its position default comes from
  `employee.position`.
- Each row has a hover-reveal **Remove** icon button
  (`aria-label="Remove {employee} from template"`). A row with shifts asks for
  a confirm first.
- A shift whose `employee_id` is not in the active employee list shows the
  stored `employee_name` and an amber **Inactive** badge. The manager can
  remove the row. The apply step skips these shifts (section 7.3).

### 5.5 States

- Loading: skeleton list and skeleton grid.
- Error: an inline error card with a **Retry** button.
- Empty list: an empty state with "Create your first week template" and a
  **New template** button.
- New template: the editor opens with a draft named "Untitled template" and
  no rows. The template is not in the database until the first Save.
- Save with zero shifts is disabled, with the hint "Add at least one shift".

### 5.6 Apply

**Apply to week…** opens `ApplyWeekTemplateDialog`. It has a week picker
(`Calendar`), the Replace / Merge choice, and a summary line. The Replace and
Merge text is the same as in the Copy Week dialog. Apply is disabled while the
draft has unsaved changes, with the hint "Save changes before you apply".
After a successful apply, a toast shows the counts. The toast has a
**View week** action that moves the Schedule tab to that week.

### 5.7 Link from Copy Week

The Templates tab in the Copy Week dialog gets a text button **Edit templates**.
It closes the dialog and opens the Week Templates tab.

### 5.8 Styling

The editor follows the CLAUDE.md Apple/Notion rules: `text-[12px]` uppercase
headers, `text-[14px]` body, `text-[13px]` secondary text, `rounded-xl`
containers with `border-border/40`, semantic tokens only, and the primary
button style for **Save**.

## 6. Data flow

```
useSchedulePlanTemplates(restaurantId)
   ├─ templates (React Query, staleTime 30s)
   ├─ createTemplate({ name, shifts: TemplateShiftSnapshot[] })   → save_schedule_plan_template
   ├─ updateTemplate({ id, name, shifts, expectedUpdatedAt })     → update_schedule_plan_template
   ├─ saveTemplate (existing, Copy Week)                          → save_schedule_plan_template
   ├─ applyTemplate (existing, plus inactive filter)              → apply_schedule_plan_template
   └─ deleteTemplate (existing)                                   → delete_schedule_plan_template

WeekTemplatesTab
   ├─ WeekTemplateList (left)
   └─ WeekTemplateEditor (right)
        ├─ draft state: useState<TemplateDraft>, pure helpers in src/lib/weekTemplateDraft.ts
        ├─ TemplateShiftDialog (single instance)
        └─ ApplyWeekTemplateDialog
```

### 6.1 Draft model (`src/lib/weekTemplateDraft.ts`)

```ts
interface TemplateDraft {
  id: string | null;               // null = not saved yet
  name: string;
  updatedAt: string | null;        // for the optimistic check
  rowEmployeeIds: string[];        // row order, includes empty rows
  shifts: DraftShift[];            // TemplateShiftSnapshot + a local key
}
```

Pure helpers, each with unit tests:

- `draftFromTemplate(template)`, `emptyDraft()`
- `addShifts(draft, input, days[])`, `updateShift(draft, key, input)`,
  `removeShift(draft, key)`
- `addEmployeeRow(draft, employeeId)`, `removeEmployeeRow(draft, employeeId)`
- `findOverlap(draft, employeeId, day, start, end, ignoreKey?)`: absolute
  minutes from Monday 00:00, so an overnight Monday shift that ends at 02:00
  overlaps a Tuesday 01:00 shift. Sunday overnight shifts do not wrap to Monday
  (the next week is not part of the template).
- `shiftHours(shift)`: `(end − start, +24h when end <= start) − break`.
- `buildGrid(draft)`: `Map<employeeId, ShiftsByDay[7]>`, sorted by start.
- `dayTotals(draft)` and `employeeTotals(draft)`.
- `toSnapshot(draft, employees)`: strips local keys and fills
  `employee_name` from the current employee list.
- `isDraftDirty(draft, saved)`: deep compare of name and sorted shifts. Empty
  rows do not make a draft dirty, and empty rows are not saved.

### 6.2 Unsaved changes

The tab keeps a `dirty` flag. These actions ask for a confirm
(`AlertDialog`) when `dirty` is true: select another template, New template,
leave the Week Templates tab. A `beforeunload` listener warns on page close.

## 7. Database changes (one migration)

File: `supabase/migrations/20261006120000_editable_week_templates.sql`.

### 7.1 Shape validator

`validate_schedule_plan_template_shifts(p_restaurant_id UUID, p_shifts JSONB)
RETURNS void`, `LANGUAGE plpgsql`, `STABLE`, `SET search_path = public`.

It raises an exception when:

- `p_shifts` is not an array, or the array has more than 500 elements.
- an element has no `employee_id`, or `day_offset` is not an integer 0–6.
- `start_time` or `end_time` does not match `^\d{2}:\d{2}(:\d{2})?$`, or the
  two values are equal.
- `break_duration` is not an integer 0–480.
- `position` is null or longer than 100 characters. `notes` is longer than
  500 characters.
- an `employee_id` does not belong to `p_restaurant_id` (one set query with
  `NOT EXISTS` against `employees`).

### 7.2 New RPC `update_schedule_plan_template`

```
update_schedule_plan_template(
  p_restaurant_id UUID, p_template_id UUID, p_name TEXT,
  p_shifts JSONB, p_expected_updated_at TIMESTAMPTZ
) RETURNS jsonb
SECURITY DEFINER, SET search_path = public
```

1. `user_has_capability(p_restaurant_id, 'edit:scheduling')`, else raise
   `Not authorized`.
2. Trim `p_name`. Refuse an empty name or a name longer than 100 characters.
3. Refuse an empty array (`Cannot save an empty schedule template`).
4. Call the shape validator.
5. `UPDATE … WHERE id = p_template_id AND restaurant_id = p_restaurant_id
   AND updated_at = p_expected_updated_at RETURNING *`.
6. When no row returns: if the row exists, raise
   `Template was changed by another user. Reload and try again.`; else raise
   `Template not found`.
7. Return `id`, `name`, `shift_count`, `updated_at`.

The compare-and-set in step 5 is one statement on one row. Two concurrent
saves cannot both match the same `updated_at`, because the trigger
`update_schedule_plan_templates_updated_at` sets a new value on each update
(`supabase/migrations/20260328100000_schedule_plan_templates.sql:17-20`).
`run-tla` check: no cron, cursor, retry or multi-step state machine is
involved, so no TLA+ model is needed.

Note: `update_updated_at_column()` uses `now()`, which is the transaction
start time. Two updates in one transaction get the same value. The client
never does that, so the check holds for the client path.

### 7.3 Changes to existing RPCs (`CREATE OR REPLACE`, same signatures)

- `save_schedule_plan_template`: capability check instead of membership;
  limit 5 → 20; name trim and length check; call the shape validator.
  The return value also gets `updated_at`.
- `apply_schedule_plan_template`: capability check instead of membership.
  It skips elements whose `employee_id` is not an active employee of
  `p_restaurant_id` (`employees.is_active`), and counts them in
  `skipped_count`. This closes the cross-tenant insert in section 3.2.
- `delete_schedule_plan_template`: capability check instead of membership.
- Add `SET search_path = public` to all five functions.
- `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` on
  the four RPCs. On the validator: `REVOKE EXECUTE … FROM PUBLIC, anon,
  authenticated`. Only the definer RPCs call it.

Role impact: today any member, staff included, can call these RPCs. After the
change, only users with `edit:scheduling` can. The Copy Week button has no
capability gate (`src/pages/Scheduling.tsx:1193-1199`). So the Copy Week dialog gets
a `canManageTemplates` prop. When the prop is false, the dialog hides the
Templates tab and the "Save as template" form. Copy Week itself does not
change.

### 7.4 RLS

Delete the INSERT and DELETE policies
(`supabase/migrations/20260328100000_schedule_plan_templates.sql:35-53`).
They check membership only, so a direct `insert` or `delete` from the client
skips the capability check, the limit and the validator. No client code
writes to the table directly; the only `.from('schedule_plan_templates')` is
the SELECT at `src/hooks/useSchedulePlanTemplates.ts:20-24`. All writes go
through the `SECURITY DEFINER` RPCs. The SELECT policy stays. No UPDATE
policy is added. A pgTAP test proves that a direct insert and a direct
delete fail.

## 8. Client changes

| File | Change |
|---|---|
| `src/lib/weekTemplateDraft.ts` (new) | Pure draft helpers (6.1). |
| `src/hooks/useSchedulePlanTemplates.ts` | Add `createTemplate`, `updateTemplate`. Export `MAX_SCHEDULE_PLAN_TEMPLATES = 20`. |
| `src/types/scheduling.ts` | Add `TemplateDraft`, `DraftShift`. |
| `src/components/scheduling/WeekTemplates/WeekTemplatesTab.tsx` (new) | Layout, selection, dirty guard. |
| `src/components/scheduling/WeekTemplates/WeekTemplateList.tsx` (new) | Left pane. |
| `src/components/scheduling/WeekTemplates/WeekTemplateEditor.tsx` (new) | Header, grid, totals. |
| `src/components/scheduling/WeekTemplates/TemplateShiftDialog.tsx` (new) | Add / edit one shift. |
| `src/components/scheduling/WeekTemplates/ApplyWeekTemplateDialog.tsx` (new) | Week picker, mode, apply. |
| `src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx` | Use the shared limit. Add **Edit templates** link. Add the `canManageTemplates` prop. |
| `src/pages/Scheduling.tsx` | New tab trigger and content, gated by `canManageSchedule`. Extend the fallback effect. |

The grid holds at most about 50 rows × 7 cells. No virtualization is needed.
Row components are `React.memo` with stable callbacks.

## 9. Known limits

- The apply step uses the browser time zone, not the restaurant time zone
  (`src/lib/schedulePlanTemplates.ts:44-55`). This design keeps that
  behavior. A manager in a different time zone from the restaurant gets
  shifted times. This is an existing defect, and it gets its own issue.
- Last-write-wins is replaced by an optimistic check only for the editor.
  The Copy Week save creates a new row, so it needs no check.

## 10. Tests

- Unit (`tests/unit/weekTemplateDraft.test.ts`): every helper in 6.1,
  including overnight overlap, Sunday overnight, break hours, dirty compare,
  and empty rows.
- Unit (`tests/unit/useSchedulePlanTemplates.test.ts`): `createTemplate` and
  `updateTemplate` call the right RPC with the right arguments, invalidate the
  query, and show the toast on error.
- pgTAP (`supabase/tests/schedule_plan_templates_edit.test.sql`): update
  happy path; stale `updated_at`; not found; other tenant; staff without
  `edit:scheduling`; shape validator errors; foreign `employee_id`; limit 20;
  apply skips a foreign or inactive employee.
- The existing pgTAP file `supabase/tests/schedule_plan_templates.test.sql`
  must stay green. Update its limit test from 5 to 20.
- E2E (`tests/e2e/week-templates.spec.ts`): a manager opens Week Templates,
  creates a template, adds an employee, adds a shift on Mon–Wed, saves,
  reloads, edits a shift, saves, applies the template to next week, and sees
  the shifts on the Schedule tab.

## 11. Changes from design review

The Supabase and frontend reviewers found no problem with the approach. This
section lists the changes. Where it conflicts with an earlier section, this
section wins.

### 11.1 Database

1. **Time format.** The validator uses
   `^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$` for `start_time` and `end_time`.
   It compares the two values as `::time`, not as text.
2. **`day_offset` type.** The validator checks `jsonb_typeof = 'number'` and
   that the value is a whole number before the cast.
3. **Update RPC.** A NULL `p_expected_updated_at` raises
   `Expected updated_at is required`. The existence check in step 6 filters by
   `id` and `restaurant_id`, so it does not tell a caller that another
   tenant's template exists.
4. **Precision of `updated_at`.** The client sends the raw `updated_at`
   string that PostgREST returns. It never converts it through a JS `Date`,
   because a `Date` drops microseconds and the compare then always fails.
   After each save, the draft takes `updated_at` from the RPC return value.
   A unit test covers this round trip.
5. **Apply filter.** The active-employee filter (`employees.restaurant_id =
   p_restaurant_id AND employees.is_active`) applies to the replace INSERT
   and to the merge INSERT. `skipped_count` stays `v_total -
   v_inserted_count`. Deleted rows are not part of it.
6. **Existing pgTAP file.** Rewrite every save payload in
   `supabase/tests/schedule_plan_templates.test.sql` to the
   `TemplateShiftSnapshot` shape (`day_offset`, `HH:MM:SS` times,
   `employee_name`). The old payloads send ISO timestamps, and the validator
   rejects them. Change the limit test to 20.
7. **Copy Week save.** `computeDayOffset`
   (`src/lib/schedulePlanTemplates.ts:5-10`) can return -1 or 7 for a shift
   at the edge of the week. `buildTemplateSnapshot` drops shifts with an
   offset outside 0–6. A unit test covers this.

### 11.2 Page and tab

1. **Fallback effect.** The effect that leaves the Week Templates tab runs
   only when `isResolved` is true and `canManageSchedule` is false. Before
   resolve, the tab stays, so a manager does not lose a draft.
2. **Dirty guard at page level.** `WeekTemplatesTab` reports its dirty state
   through an `onDirtyChange(dirty)` prop. `Scheduling.tsx` keeps the flag and
   wraps the `Tabs` `onValueChange` (`src/pages/Scheduling.tsx:926`). When the
   flag is true and the user leaves the tab, an `AlertDialog` asks first.
3. **Accepted limits.** The app uses `BrowserRouter` (`src/App.tsx:353`), so
   `useBlocker` is not available. A click on an in-app link, or a restaurant
   switch, drops the draft without a prompt. `beforeunload` covers a page
   close or reload. The tab choice is local state
   (`src/pages/Scheduling.tsx:267`), so a reload opens the Schedule tab.
4. **Tab trigger.** The trigger has `aria-label="Week Templates"`, the same
   as the Planner trigger (`src/pages/Scheduling.tsx:964-971`), because the
   label text is `hidden sm:inline`.
5. **Copy Week link.** `CopyWeekDialog` gets `onEditTemplates()`. The page
   closes the dialog and sets the tab.

### 11.3 Editor

1. **Server refetch.** The query refetches on focus and after 30s
   (`src/hooks/useSchedulePlanTemplates.ts:30`). The editor builds the draft
   with `draftFromTemplate` only when the selected id changes. When the server
   `updated_at` changes and the draft is clean, the editor loads the new
   version. When the draft is dirty, the editor shows a notice: "This template
   changed in another session. Save will fail. Discard to load the new
   version."
2. **Touch.** Below `lg`, the `+` button shows all the time. Above `lg`, it
   shows on row hover and on focus.
3. **Mobile grid.** The employee column is `w-36 sticky left-0 z-10
   bg-background`. Each day column is `min-w-[96px]`. The hours column is
   `w-16`. The shift dialog has a sticky footer, so Save stays visible at
   375×667.
4. **Grid a11y.** The grid is a native `<table>` with `<th scope="col">` and
   `<th scope="row">`. The Hours header is a full word. The name input has
   `aria-label="Template name"`. The `⋯` button has
   `aria-label="Template actions"`. The selected list card has
   `aria-current="true"`. The overlap error has `role="alert"` and is linked
   to the Start input with `aria-describedby`.
5. **Reuse.** Start and End use `TimeInput`
   (`src/components/scheduling/TimeInput.tsx:5-19`). The Days toggle copies
   the `aria-pressed` button pattern from
   `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:326-350`.
   Warning: that dialog uses index 0 = Sunday, and `day_offset` uses
   0 = Monday. A helper `dayOffsetToJsDay` maps the two, with a unit test.
6. **Replace / Merge.** The radio block lives in `src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:557-592`.
   Move it to a shared `MergeModeField` component. Both dialogs use it, so
   the text stays the same.
7. **After apply.** The apply dialog shows the result counts and a
   **View week** button. The button calls `onViewWeek(monday)`. The page sets
   `currentWeekStart` and the Schedule tab. The hook toast stays as it is.
8. **Employee list states.** **Add employee** shows a disabled select with
   "Loading employees…" while loading, and an inline error with **Retry** on
   failure.
9. **Memo rows.** Rows are `React.memo` with a compare of the row's shift
   keys and values. `buildGrid` reuses the previous row array when the row did
   not change.
10. **Inactive badge.** `bg-amber-500/10 text-amber-700 dark:text-amber-400`.
11. **Query columns.** The templates query selects explicit columns:
    `id, restaurant_id, name, shifts, shift_count, created_at, updated_at`.
