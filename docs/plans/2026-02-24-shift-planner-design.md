# Shift Planner: Definitions, Templates & Schedule Builder

**Date:** 2026-02-24
**Status:** Approved

## Problem

Managers need a structured way to define recurring shift patterns (e.g., "Opening Shift for Cashiers") and build weekly staffing plans. Currently, shifts are created one-at-a-time or imported from external systems. There's no concept of "we need 3 cashiers for opening every Monday" that can be reused week after week.

## Solution

A 3-layer system:

1. **Shift Definitions** — Named time blocks optionally tied to a role (e.g., "Opening Shift", 6am-2pm)
2. **Week Templates** — Named weekly staffing plans that specify headcount per shift/role/day (e.g., "Regular Week: Mon Opening needs 3 cashiers, 2 bartenders")
3. **Schedule Slots** — Generated schedule for a specific week with assignable employee slots

## Data Architecture

### Option chosen: Extend existing tables (Option A)

Build on the existing `shift_templates` table and add `week_templates`, `week_template_slots`, and `schedule_slots`.

### Schema

#### 1. Extend `shift_templates` (shift definitions)

Add columns to existing table:
- `color TEXT` — visual grouping color (hex or preset)
- `description TEXT` — optional notes

Existing columns retained: `name`, `start_time`, `end_time`, `break_duration`, `position`, `day_of_week`, `is_active`.

Note: `day_of_week` becomes optional (nullable) since shift definitions are now day-agnostic. The day is specified in `week_template_slots` instead. Existing rows with `day_of_week` set are unaffected.

#### 2. New: `week_templates`

```sql
CREATE TABLE week_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

One can be `is_active` per restaurant (enforced by trigger or application logic).

#### 3. New: `week_template_slots`

```sql
CREATE TABLE week_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_template_id UUID NOT NULL REFERENCES week_templates(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  position TEXT,           -- NULL = inherit from shift_template; required if shift has no position
  headcount INTEGER NOT NULL DEFAULT 1 CHECK (headcount > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4. New: `schedule_slots`

```sql
CREATE TABLE schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  week_template_slot_id UUID REFERENCES week_template_slots(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  slot_index INTEGER NOT NULL DEFAULT 0,  -- 0-based index within headcount
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unfilled' CHECK (status IN ('unfilled', 'assigned', 'confirmed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. RPC: `generate_schedule_from_template`

```sql
-- Input: restaurant_id, week_template_id, week_start_date
-- Behavior:
--   1. Read week_template_slots for the template
--   2. For each slot × headcount:
--      a. Create a shifts row (employee_id=NULL, source_type='template', status='scheduled')
--      b. Create a schedule_slots row linking to the shift
--   3. Skip if schedule_slots already exist for this week+template
--   4. Return count of slots created
```

## UI Design

### Integration Point

New "Shift Planner" tab on the existing Scheduling page (`src/pages/Scheduling.tsx`), alongside Schedule, Time-Off, Availability, and Shift Trades tabs.

### Sub-views

#### A. Shift Definitions Manager

- Accessible via gear icon or "Manage Shifts" button
- List of all shift definitions with name, time range, position, color
- Create/edit dialog: name, start_time, end_time, break_duration, position (optional), color, description
- Toggle active/inactive
- Delete with confirmation

#### B. Week Template Builder (default view)

- Dropdown to select/create week template
- 7-column grid (Mon-Sun)
- Each column shows shift blocks for that day
- Each block: shift name, time, roles with headcount (e.g., "Opening 6am-2pm: Cashier x3, Bartender x2")
- Add block: pick shift definition, set role + headcount
- Remove/edit blocks per day
- Total labor hours preview per day at column footer

#### C. Schedule Generator & Assignment

- Week date picker
- "Generate from Template" button
- Slot-filling board: grouped by shift block, each row is a shift definition + day
- Unfilled slots show role badge + "Assign" button
- Filled slots show employee name
- Employee sidebar/dropdown filtered by matching position
- Progress indicator: "12/18 slots filled"
- "Publish" button integrates with existing publish workflow

### Tab Flow

Template Builder is the default view. "Generate Schedule for [week]" transitions to the Assignment view for that specific week.

## Data Flow

1. **Template creation:** Manager builds shift definitions, then assembles a week template specifying which shifts run on which days with what headcount.

2. **Schedule generation:** Manager picks a target week and clicks "Generate." RPC creates `schedule_slots` + empty `shifts` rows. If schedule already exists for that week, warn and offer to regenerate.

3. **Employee assignment:** Manager clicks on an unfilled slot and picks an employee (filtered by position). Updates both `schedule_slots.employee_id` and `shifts.employee_id`. Shift appears in Week View immediately.

4. **Publishing:** Uses existing `publish_schedule` flow. All shifts for the week get published, employees get notified.

5. **Conflict detection:** Reuses `useCheckConflicts` when assigning employees.

## Coexistence with Existing Features

- Manually created shifts (from Week View) are unaffected — no `schedule_slots` link
- Template-generated shifts have `source_type = 'template'` for identification
- Sling-imported shifts are also unaffected
- Week template can be changed without affecting already-generated schedules

## Out of Scope (v1)

- No drag-and-drop for assignment (click-to-assign only)
- No AI auto-fill suggestions
- No availability-aware conflict warnings beyond time overlap
- No mobile-optimized planner layout
- No multi-week generation in one action

## Files to Create/Modify

### New files:
- `supabase/migrations/YYYYMMDD_shift_planner_tables.sql`
- `src/hooks/useShiftDefinitions.ts`
- `src/hooks/useWeekTemplates.ts`
- `src/hooks/useScheduleSlots.ts`
- `src/components/scheduling/ShiftPlanner.tsx` (main tab component)
- `src/components/scheduling/ShiftDefinitionsManager.tsx`
- `src/components/scheduling/WeekTemplateBuilder.tsx`
- `src/components/scheduling/ScheduleAssignment.tsx`
- `src/components/scheduling/ShiftDefinitionDialog.tsx`
- `src/components/scheduling/WeekTemplateDialog.tsx`
- `tests/unit/useWeekTemplates.test.ts`
- `tests/unit/useScheduleSlots.test.ts`
- `supabase/tests/shift_planner.sql` (pgTAP tests)

### Modified files:
- `src/pages/Scheduling.tsx` — add Shift Planner tab
- `src/types/scheduling.ts` — add new types
- `supabase/migrations/` — extend shift_templates table
