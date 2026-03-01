# Shift Planner v2 — Template-First Redesign

## Problem

The v1 shift planner uses an employee-rows × day-columns grid where you click empty cells to manually enter shift times. The actual workflow restaurant managers want is:

1. Define **shift templates** ("Morning Weekdays 6AM-12PM, Server")
2. See those templates as **rows** in a weekly grid
3. **Drag employees** from a sidebar into template/day cells to build the schedule

## Data Model

### `shift_templates` table (existing, one migration to extend)

```sql
-- Add multi-day support: days INTEGER[] replaces single day_of_week
ALTER TABLE shift_templates ADD COLUMN days INTEGER[] NOT NULL DEFAULT '{}';
-- Migrate existing data: copy day_of_week into days array
UPDATE shift_templates SET days = ARRAY[day_of_week] WHERE day_of_week IS NOT NULL;
-- Drop old column
ALTER TABLE shift_templates DROP COLUMN day_of_week;
```

Final schema:
- `id`, `restaurant_id`, `name`, `days` (integer array, 0=Sun..6=Sat)
- `start_time` (TIME), `end_time` (TIME), `break_duration`, `position`
- `is_active`, `created_at`, `updated_at`

### `shifts` table — no changes

Shifts created from templates are normal shift rows. The template provides times/position; the shift stores the actual employee assignment.

## UI Layout

Two-panel layout within the existing Planner tab:

```
┌──────────────────────────────────────────────────┐ ┌──────────────┐
│  < Feb 23 – Mar 1 >  Today         32h scheduled │ │  EMPLOYEES   │
├──────────┬──────┬──────┬──────┬──────┬──────┬────┤ │              │
│          │ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │    │ │ ● Alice      │
│          │  23  │  24  │  25  │  26  │  27  │    │ │   Server     │
├──────────┼──────┼──────┼──────┼──────┼──────┤    │ │ ● Bob        │
│ Morning  │Alice │Alice │ Bob  │      │Alice │    │ │   Cook       │
│ 6a-12p   │ Bob  │Carol │      │      │ Bob  │    │ │ ● Carol      │
│ Server   │      │      │      │      │      │    │ │   Server     │
├──────────┼──────┼──────┼──────┼──────┼──────┤    │ │ ● Dave       │
│ Evening  │      │ Dave │ Dave │ Dave │      │    │ │   Bartender  │
│ 5p-11p   │      │      │ Eve  │      │      │    │ │ ● Eve        │
│ Bartender│      │      │      │      │      │    │ │   Bartender  │
├──────────┴──────┴──────┴──────┴──────┴──────┤    │ │              │
│  [+ Add Shift Template]                      │    │ │              │
└──────────────────────────────────────────────────┘ └──────────────┘
```

### Key interactions

- **Drag** employee chip from sidebar → drop into shift/day cell → creates a shift
- **Click X** on employee chip in cell → deletes that shift (unassigns)
- **Click** template row header → edit/delete the template
- **"+ Add Shift Template"** → dialog for name, time range, position, days checkboxes
- Cells for days NOT in the template's `days` array are greyed out / disabled
- Today column gets a subtle highlight

## Component Architecture

### Replace (v1 → v2)

| v1 Component | v2 Component | Why |
|---|---|---|
| `WeeklyGrid.tsx` | `TemplateGrid.tsx` | Shift rows × day columns instead of employee rows |
| `ShiftBlock.tsx` | `EmployeeChip.tsx` | Small removable tag, not a full shift card |
| `EmptyCell.tsx` | `ShiftCell.tsx` | Droppable cell within a template row |
| `ShiftQuickCreate.tsx` | `TemplateFormDialog.tsx` | Creates/edits templates, not individual shifts |
| `ShiftPlannerTab.tsx` | Rewrite internals | Two-panel layout, template-centric data flow |

### Keep as-is

- `PlannerHeader.tsx` — week nav + hours summary
- `ShiftInterval` + `ShiftValidator` — time math + validation on assignment
- `@dnd-kit` — same library, drag sources change from shift blocks to employee sidebar

### Add new

- `EmployeeSidebar.tsx` — right panel with draggable employee list
- `TemplateRowHeader.tsx` — left column: template name, time, position, edit menu

### Hooks

- **`useShiftTemplates(restaurantId)`** — new CRUD hook for `shift_templates`
- **`useShiftPlanner`** — adapted: `buildGridData` groups by template (matching start_time + end_time + position) instead of by employee

## Drag-and-Drop Flow

1. Employee chip in sidebar: `useDraggable({ data: { employee } })`
2. Each grid cell: `useDroppable({ data: { templateId, day } })`
3. On drop:
   - Look up template → get `start_time`, `end_time`, `position`
   - Build `ShiftInterval` from template times + cell's day
   - Run `validateShift()` (overlap, clopen, time-off)
   - If valid → `createShift()` with template times/position + employee
   - If invalid → show error alert
4. Remove: click X on chip → `deleteShift(shiftId)`

No shift-to-shift dragging in v1. Employees only drag from sidebar into cells.

## YAGNI — Not building

- Recurring schedule generation ("copy this week to next week")
- Employee availability display in cells
- Shift-to-shift drag (move employee between cells)
- Template groups / categories
- Auto-scheduling / optimization
