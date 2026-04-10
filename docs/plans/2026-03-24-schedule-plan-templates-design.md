# Schedule Plan Templates — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Feature:** Save and reuse weekly schedule plans as named templates

## Problem

Managers build weekly schedules by assigning employees to shifts. When the same arrangement repeats (e.g., a standard week), they must manually recreate it or hunt for the original week to copy from. There is no way to save a complete week's shift assignments as a reusable starting point.

## Solution

Add the ability to **save** the current week's shifts as a named template and **apply** a saved template to any future week. Integrated into the existing Copy Week dialog as a second tab.

## Requirements

- Save current week's shifts (with employee assignments) as a named template
- Apply a saved template to a target week with two modes: Replace (delete unlocked + insert) or Merge (insert only where no overlap)
- Max 5 templates per restaurant
- Delete templates from the list
- Templates capture a point-in-time snapshot — changes to the source week don't affect saved templates

## Data Model

### New table: `schedule_plan_templates`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| restaurant_id | UUID | FK → restaurants(id), NOT NULL |
| name | TEXT | NOT NULL |
| shifts | JSONB | NOT NULL |
| shift_count | INT | NOT NULL, set by save RPC from jsonb_array_length(shifts) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

**RLS:** All operations filtered by `restaurant_id` matching the authenticated user's restaurant access.

**Constraint:** Max 5 rows per `restaurant_id` enforced in the save RPC using `SELECT count(*) ... FOR UPDATE` to prevent TOCTOU races (not a CHECK constraint, since CHECK can't do cross-row counts).

**Trigger:** Uses existing `set_updated_at` trigger function for `updated_at` column.

### JSONB `shifts` array element structure

```json
{
  "day_offset": 0,
  "start_time": "09:00:00",
  "end_time": "17:00:00",
  "break_duration": 30,
  "position": "Server",
  "employee_id": "uuid",
  "employee_name": "Alice Johnson",
  "notes": null
}
```

- `day_offset`: 0 (Monday) through 6 (Sunday) — Monday-anchored to match the codebase convention (`getMondayOfWeek()`, `getWeekDays()`, `buildCopyPayload`). Week-agnostic, mapped to target week dates at apply time.
- `employee_name`: denormalized for display in template list/preview without joining employees table
- `employee_id`: used to assign shifts at apply time; if employee no longer exists or is inactive, the **entire shift is skipped** (not created) because `shifts.employee_id` has a NOT NULL constraint. The `skipped_count` in the apply response tells the user how many shifts were skipped.

## RPCs

### `save_schedule_plan_template(p_restaurant_id UUID, p_name TEXT, p_shifts JSONB)`

1. Validate `jsonb_array_length(p_shifts) > 0` — raise exception if empty
2. `SELECT count(*) FROM schedule_plan_templates WHERE restaurant_id = p_restaurant_id FOR UPDATE` — locks rows to prevent TOCTOU race
3. If count >= 5, raise exception 'Maximum of 5 schedule templates allowed'
4. Insert row with `shift_count = jsonb_array_length(p_shifts)`
5. Return the new template row

### `apply_schedule_plan_template(p_restaurant_id UUID, p_template_id UUID, p_target_week_start DATE, p_target_week_end DATE, p_merge_mode TEXT)`

Parameters match the existing `copy_week_shifts` pattern — explicit start and end dates for the target week range.

1. Fetch template shifts JSONB
2. Compute target dates: for each shift, `p_target_week_start + (shift->>'day_offset')::int * INTERVAL '1 day'`
3. Validate employee_ids: `LEFT JOIN employees WHERE status = 'active'`. Shifts referencing inactive/deleted employees are **skipped entirely** (NOT inserted) because `shifts.employee_id` is NOT NULL. Track in `skipped_count`.
4. If `p_merge_mode = 'replace'`:
   - Delete existing unlocked shifts in `[p_target_week_start, p_target_week_end]` range (same pattern as `copy_week_shifts`)
   - Insert all valid template shifts mapped to target dates
5. If `p_merge_mode = 'merge'`:
   - For each template shift, check for **time-range overlap**: does any existing shift for the same `employee_id` on the same target date have `(existing.start_time, existing.end_time) OVERLAPS (new.start_time, new.end_time)`?
   - Insert only non-overlapping shifts; overlapping ones added to `skipped_count`
6. Set all new shifts: `status='scheduled'`, `is_published=false`, `locked=false`
7. Return `{ inserted_count, skipped_count, deleted_count }`

### `delete_schedule_plan_template(p_restaurant_id UUID, p_template_id UUID)`

1. Delete the template row (RLS ensures restaurant isolation)
2. Return success

## UI Changes

### CopyWeekDialog — Enhanced with Tabs

The existing `CopyWeekDialog.tsx` gets Apple-style underline tabs:

**Tab 1: "Copy from Week"** (existing behavior, unchanged)
- Calendar picker for source week
- Shows source/target week ranges, shift count, warnings

**Tab 2: "Apply Template"** (new)
- List of saved templates showing: name, shift count, created date
- Select a template to see a brief summary
- Radio toggle: "Replace existing shifts" / "Merge with existing"
- Confirm button applies the selected template to the target week (same calendar picker as Copy tab, blocks past weeks — consistent with existing `isPastWeek` guard)
- Each template row has a trash icon for deletion (with confirmation)
- Empty state: "No saved templates yet. Save your current week as a template to get started."

### Save Template Action

**"Save as Template" button** in the CopyWeekDialog header area (visible from both tabs). Opens a small inline form:
- Text input for template name (required)
- Shows current week's shift count
- If at 5-template limit, button is disabled with tooltip "Maximum 5 templates reached. Delete one to save a new one."
- On save: calls `save_schedule_plan_template` RPC, shows success toast, switches to "Apply Template" tab

## TypeScript Types

Added to `src/types/scheduling.ts` (alongside existing `ShiftTemplate`):

```typescript
// Named distinctly from the existing ShiftTemplate (which defines time/position patterns)
interface SchedulePlanTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  shifts: TemplateShiftSnapshot[];
  shift_count: number;
  created_at: string;
  updated_at: string;
}

interface TemplateShiftSnapshot {
  day_offset: number;       // 0=Monday through 6=Sunday
  start_time: string;       // HH:MM:SS
  end_time: string;         // HH:MM:SS
  break_duration: number;
  position: string;
  employee_id: string;
  employee_name: string;
  notes: string | null;
}

interface ApplyTemplateResult {
  inserted_count: number;
  skipped_count: number;
  deleted_count: number;
}
```

## Hook

### `useSchedulePlanTemplates(restaurantId: string)`

```typescript
// Returns
{
  templates: SchedulePlanTemplate[];
  isLoading: boolean;
  error: Error | null;
  saveTemplate: (name: string, shifts: Shift[]) => Promise<void>;
  applyTemplate: (templateId: string, targetWeekStart: string, targetWeekEnd: string, mergeMode: 'replace' | 'merge') => Promise<ApplyTemplateResult>;
  deleteTemplate: (templateId: string) => Promise<void>;
}
```

- React Query with `staleTime: 30000`
- `saveTemplate` transforms current shifts into the JSONB snapshot format (computes day_offset from shift dates relative to week start). The `CopyWeekDialog` already receives `shifts` and `sourceWeekStart` as props from the parent — these are passed through to `buildTemplateSnapshot`.
- `applyTemplate` calls the apply RPC, invalidates shifts query on success
- `deleteTemplate` calls delete RPC with optimistic update

### Snapshot builder utility

`buildTemplateSnapshot(shifts: Shift[], weekStart: Date): TemplateShiftSnapshot[]`

Located in `src/lib/schedulePlanTemplates.ts`. Transforms shift objects into the JSONB format:
- Computes `day_offset` from each shift's local date relative to weekStart
- Extracts `start_time` and `end_time` as local HH:MM:SS strings
- Includes `employee_id`, `employee_name`, `position`, `break_duration`, `notes`
- Filters out cancelled shifts

## Testing

### pgTAP (SQL tests)
- Save template: happy path, 5-template limit, empty shifts array
- Apply template (replace mode): inserts shifts, deletes unlocked existing, preserves locked
- Apply template (merge mode): skips time-overlapping shifts, inserts non-overlapping
- Apply with inactive employee: skips shift entirely, increments skipped_count
- Delete template: removes row, RLS isolation
- Save RPC: TOCTOU race prevention (concurrent saves respect 5-template limit)

### Unit tests (Vitest)
- `buildTemplateSnapshot`: correct day_offset computation, time extraction, cancelled shift filtering
- Hook: save/apply/delete mutation behavior (mocked Supabase)

## Edge Cases

- **Employee no longer active:** Apply **skips the entire shift** (not created) because `shifts.employee_id` is NOT NULL. `skipped_count` in response tells user how many were skipped. A toast message lists which employees were missing.
- **5-template limit reached:** Save button disabled with clear message.
- **Target week has locked shifts:** Replace mode only deletes unlocked shifts. Locked shifts remain. Warning shown if locked shifts exist.
- **Empty week saved:** Prevented — save button disabled if current week has 0 shifts.
- **Overnight shifts:** `day_offset` uses the start_time's local date. End time crossing midnight is preserved correctly (same as copy_week_shifts logic).

## Out of Scope

- Template editing (rename, modify shifts) — users can delete and re-save
- Template sharing across restaurants
- Template versioning/history
- Scheduling template suggestions based on sales data
