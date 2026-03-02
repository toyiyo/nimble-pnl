# Shift Planner v2 — Template-First Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the shift planner so managers define shift templates (e.g., "Morning Weekdays 6AM-12PM") and drag employees from a sidebar into template/day cells to build the weekly schedule.

**Architecture:** The `shift_templates` table gets a `days` integer array column (replacing `day_of_week`). A new `useShiftTemplates` hook handles template CRUD. The grid flips from employee-rows to template-rows. Employees live in a sidebar and are dragged into cells, which creates actual `shifts` rows using the template's times/position. ShiftInterval and ShiftValidator are reused for validation on assignment.

**Tech Stack:** React, TypeScript, @dnd-kit, Supabase, React Query, Vitest, Playwright

---

### Task 1: Migrate `shift_templates` — replace `day_of_week` with `days` array

**Files:**
- Create: `supabase/migrations/<timestamp>_shift_templates_days_array.sql`
- Modify: `src/types/scheduling.ts:110-122`

**Step 1: Write the migration SQL**

```sql
-- Add days array column
ALTER TABLE shift_templates ADD COLUMN IF NOT EXISTS days INTEGER[] NOT NULL DEFAULT '{}';

-- Migrate existing data: copy day_of_week into days array
UPDATE shift_templates SET days = ARRAY[day_of_week] WHERE day_of_week IS NOT NULL AND days = '{}';

-- Drop old column and its constraint
ALTER TABLE shift_templates DROP CONSTRAINT IF EXISTS valid_day_of_week;
ALTER TABLE shift_templates DROP COLUMN IF EXISTS day_of_week;

-- Add check: each element must be 0-6
ALTER TABLE shift_templates ADD CONSTRAINT valid_days CHECK (
  days <@ ARRAY[0,1,2,3,4,5,6]
);
```

**Step 2: Apply the migration**

Run: `npx supabase migration new shift_templates_days_array`
Then paste the SQL into the generated file.
Run: `npx supabase db reset` to apply locally.

**Step 3: Update the TypeScript interface**

In `src/types/scheduling.ts`, change `ShiftTemplate`:

```typescript
export interface ShiftTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  days: number[];           // [0,1,2,3,4,5,6] — 0=Sunday, 6=Saturday
  start_time: string;       // HH:MM (TIME format)
  end_time: string;
  break_duration: number;
  position: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

**Step 4: Commit**

```bash
git add supabase/migrations/ src/types/scheduling.ts
git commit -m "feat: migrate shift_templates to multi-day support (days array)"
```

---

### Task 2: `useShiftTemplates` hook — CRUD for shift templates

**Files:**
- Create: `src/hooks/useShiftTemplates.ts`
- Create: `tests/unit/useShiftTemplates.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';

// Test the pure helper that maps JS day (0=Sun) to template days
// and the grid-building logic
describe('useShiftTemplates helpers', () => {
  describe('jsDateToDayOfWeek', () => {
    it('should convert JS Sunday (0) to template Sunday (0)', () => {
      // JS Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat
      // Template days: 0=Sun, 1=Mon, ..., 6=Sat (same mapping)
      expect(jsDateToDayOfWeek(0)).toBe(0);
    });

    it('should convert JS Monday (1) to template Monday (1)', () => {
      expect(jsDateToDayOfWeek(1)).toBe(1);
    });

    it('should convert JS Saturday (6) to template Saturday (6)', () => {
      expect(jsDateToDayOfWeek(6)).toBe(6);
    });
  });

  describe('templateAppliesToDay', () => {
    it('should return true when day is in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(true); // Monday
    });

    it('should return false when day is not in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-01')).toBe(false); // Sunday
    });

    it('should handle weekend-only templates', () => {
      const template = { days: [0, 6] }; // Sat, Sun
      expect(templateAppliesToDay(template, '2026-02-28')).toBe(true);  // Saturday
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(false); // Monday
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useShiftTemplates.test.ts`
Expected: FAIL — functions not defined

**Step 3: Implement the hook**

Create `src/hooks/useShiftTemplates.ts`:

```typescript
import { useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Convert JS Date.getDay() value to template day_of_week (same mapping: 0=Sun). */
export function jsDateToDayOfWeek(jsDay: number): number {
  return jsDay;
}

/** Check if a template applies to a given YYYY-MM-DD date string. */
export function templateAppliesToDay(
  template: Pick<ShiftTemplate, 'days'>,
  dateStr: string,
): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = jsDateToDayOfWeek(date.getDay());
  return template.days.includes(dayOfWeek);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type TemplateInput = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>;

export function useShiftTemplates(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shift_templates', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('shift_templates')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('start_time');
      if (error) throw error;
      return data as ShiftTemplate[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const createMutation = useMutation({
    mutationFn: async (input: TemplateInput) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template created', description: 'Shift template has been added.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ShiftTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('shift_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('shift_templates')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift_templates', restaurantId] });
      toast({ title: 'Template removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return {
    templates: data || [],
    loading: isLoading,
    error,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: updateMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useShiftTemplates.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/useShiftTemplates.ts tests/unit/useShiftTemplates.test.ts
git commit -m "feat: add useShiftTemplates hook with CRUD and day helpers"
```

---

### Task 3: Adapt `useShiftPlanner` — template-centric grid data

**Files:**
- Modify: `src/hooks/useShiftPlanner.ts`
- Modify: `tests/unit/useShiftPlanner.test.ts`

**Context:** The current `buildGridData` groups shifts by `employeeId`. The new version groups shifts by template (matching on `start_time`, `end_time`, `position`). The hook also needs to expose `templates` and `createTemplate`/`deleteTemplate` from `useShiftTemplates`.

**Step 1: Write the new `buildTemplateGridData` test**

Add to `tests/unit/useShiftPlanner.test.ts`:

```typescript
import { buildTemplateGridData } from '@/hooks/useShiftPlanner';

describe('buildTemplateGridData', () => {
  const templates = [
    { id: 't1', start_time: '06:00:00', end_time: '12:00:00', position: 'Server', days: [1, 2, 3, 4, 5], name: 'Morning', restaurant_id: 'r1', break_duration: 0, is_active: true, created_at: '', updated_at: '' },
    { id: 't2', start_time: '17:00:00', end_time: '23:00:00', position: 'Bartender', days: [0, 6], name: 'Evening', restaurant_id: 'r1', break_duration: 0, is_active: true, created_at: '', updated_at: '' },
  ];

  const weekDays = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
  // Mon=2, Tue=3, Wed=4, Thu=5, Fri=6, Sat=7, Sun=8

  it('should group shifts by template ID and day', () => {
    const shifts = [
      { id: 's1', employee_id: 'e1', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'scheduled' },
      { id: 's2', employee_id: 'e2', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'scheduled' },
    ];
    const grid = buildTemplateGridData(shifts as any, templates as any, weekDays);
    const t1Days = grid.get('t1');
    expect(t1Days).toBeDefined();
    const monShifts = t1Days!.get('2026-03-02');
    expect(monShifts).toHaveLength(2);
  });

  it('should not match shifts to wrong template', () => {
    const shifts = [
      { id: 's1', employee_id: 'e1', start_time: '2026-03-02T17:00:00', end_time: '2026-03-02T23:00:00', position: 'Bartender', status: 'scheduled' },
    ];
    const grid = buildTemplateGridData(shifts as any, templates as any, weekDays);
    const t1Days = grid.get('t1');
    // Should NOT be under Morning template
    expect(t1Days?.get('2026-03-02') ?? []).toHaveLength(0);
  });

  it('should put unmatched shifts under __unmatched__', () => {
    const shifts = [
      { id: 's1', employee_id: 'e1', start_time: '2026-03-02T14:00:00', end_time: '2026-03-02T18:00:00', position: 'Host', status: 'scheduled' },
    ];
    const grid = buildTemplateGridData(shifts as any, templates as any, weekDays);
    const unmatched = grid.get('__unmatched__');
    expect(unmatched?.get('2026-03-02')).toHaveLength(1);
  });

  it('should exclude cancelled shifts', () => {
    const shifts = [
      { id: 's1', employee_id: 'e1', start_time: '2026-03-02T06:00:00', end_time: '2026-03-02T12:00:00', position: 'Server', status: 'cancelled' },
    ];
    const grid = buildTemplateGridData(shifts as any, templates as any, weekDays);
    expect(grid.get('t1')?.get('2026-03-02') ?? []).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: FAIL — `buildTemplateGridData` not defined

**Step 3: Implement `buildTemplateGridData` and update hook**

In `src/hooks/useShiftPlanner.ts`:

1. Add `buildTemplateGridData` function (exported for testing)
2. Import `useShiftTemplates` and expose its return values
3. Change the hook return type to include `templates` and template CRUD
4. Keep `getWeekDays`, `computeTotalHours`, week navigation, and validation logic

The matching logic: for each non-cancelled shift, extract its start time (HH:MM) and end time (HH:MM) and position, then find the template with matching `start_time`, `end_time`, and `position`. If no match, put under `__unmatched__`.

```typescript
export function buildTemplateGridData(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): Map<string, Map<string, Shift[]>> {
  const weekDaySet = new Set(weekDays);
  const grid = new Map<string, Map<string, Shift[]>>();

  // Initialize empty maps for each template
  for (const t of templates) {
    grid.set(t.id, new Map());
  }
  grid.set('__unmatched__', new Map());

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const dayStr = shift.start_time.split('T')[0];
    if (!weekDaySet.has(dayStr)) continue;

    // Extract HH:MM:SS from ISO timestamp
    const shiftStart = shift.start_time.split('T')[1]?.substring(0, 8);
    const shiftEnd = shift.end_time.split('T')[1]?.substring(0, 8);

    // Find matching template
    let matched = false;
    for (const t of templates) {
      if (t.start_time === shiftStart && t.end_time === shiftEnd && t.position === shift.position) {
        const templateDays = grid.get(t.id)!;
        let dayShifts = templateDays.get(dayStr);
        if (!dayShifts) {
          dayShifts = [];
          templateDays.set(dayStr, dayShifts);
        }
        dayShifts.push(shift);
        matched = true;
        break;
      }
    }

    if (!matched) {
      const unmatched = grid.get('__unmatched__')!;
      let dayShifts = unmatched.get(dayStr);
      if (!dayShifts) {
        dayShifts = [];
        unmatched.set(dayStr, dayShifts);
      }
      dayShifts.push(shift);
    }
  }

  return grid;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useShiftPlanner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/useShiftPlanner.ts tests/unit/useShiftPlanner.test.ts
git commit -m "feat: add buildTemplateGridData for template-centric shift grouping"
```

---

### Task 4: `TemplateFormDialog` — create/edit shift templates

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx`

**Context:** A dialog with fields: name, start time, end time, position (text input), days (checkboxes for Sun-Sat), break duration. Used for both create and edit. Follows Apple/Notion dialog structure from CLAUDE.md.

**Step 1: Create the component**

Key details:
- Props: `open`, `onOpenChange`, `template?` (for edit mode), `onSubmit`, `positions` (string array for autocomplete)
- Form fields: name (Input), start_time (time input), end_time (time input), position (Input or Select), days (7 toggle buttons), break_duration (number Input)
- Submit button: "Add Template" for create, "Save Changes" for edit
- Use the CLAUDE.md dialog structure: `DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40"`
- Day toggles: 7 small buttons (S M T W T F S) that toggle on/off, highlighted when selected
- Icon in header: `Clock` from lucide-react

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx
git commit -m "feat: add TemplateFormDialog for shift template CRUD"
```

---

### Task 5: `EmployeeSidebar` — draggable employee list

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx`

**Context:** Right-side panel showing all active employees. Each employee is a draggable chip using `useDraggable` from @dnd-kit. Shows employee name and position. Grouped or filterable by position.

**Step 1: Create the component**

Key details:
- Props: `employees: Employee[]`
- Each employee renders as a `useDraggable` element with `id: employee.id`, `data: { employee }`
- Layout: vertical list with `text-[14px] font-medium` name, `text-[12px] text-muted-foreground` position
- Container: `w-[200px] border-l border-border/40 bg-background p-3 overflow-y-auto`
- Header: `text-[12px] font-medium text-muted-foreground uppercase tracking-wider` "EMPLOYEES"
- Each chip: `rounded-lg border border-border/40 px-3 py-2 cursor-grab active:cursor-grabbing`
- Use `React.memo` for each employee chip to prevent re-renders

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx
git commit -m "feat: add EmployeeSidebar with draggable employee chips"
```

---

### Task 6: `EmployeeChip` — small removable tag in grid cells

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx`

**Context:** A small tag showing an assigned employee's name inside a grid cell. Has an X button to remove (delete the shift). Uses `React.memo`.

**Step 1: Create the component**

Key details:
- Props: `shift: Shift`, `onRemove: (shiftId: string) => void`
- Display: employee name (from `shift.employee?.name` or "Open"), compact
- Remove button: small X icon, `onClick => onRemove(shift.id)`
- Styling: `text-[12px] font-medium px-2 py-1 rounded-md bg-muted/50 border border-border/40 flex items-center gap-1`
- Position-based colors (reuse the same POSITION_COLORS map from the old ShiftBlock)
- `aria-label="Remove {name} from shift"`

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/EmployeeChip.tsx
git commit -m "feat: add EmployeeChip for assigned employees in grid cells"
```

---

### Task 7: `ShiftCell` — droppable cell in template grid

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`

**Context:** A single cell in the template grid (intersection of template row + day column). It's a drop target for employee chips. Shows assigned employees as EmployeeChip tags. Greyed out if the template doesn't apply to that day.

**Step 1: Create the component**

Key details:
- Props: `templateId: string`, `day: string`, `isActiveDay: boolean`, `shifts: Shift[]`, `onRemoveShift: (shiftId: string) => void`
- Uses `useDroppable({ id: \`${templateId}:${day}\`, data: { templateId, day } })`
- When `!isActiveDay`: render a disabled/greyed cell (`bg-muted/20 opacity-50 pointer-events-none`)
- When active: render EmployeeChip for each shift, highlight on drag over
- Styling: `min-h-[64px] p-1.5 border-l border-border/40`
- Drag-over highlight: `border-foreground/30 bg-foreground/5`

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftCell.tsx
git commit -m "feat: add ShiftCell as droppable cell in template grid"
```

---

### Task 8: `TemplateGrid` — the main grid component

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/TemplateGrid.tsx`

**Context:** Replaces the old `WeeklyGrid`. Renders template rows × day columns. Each row has a TemplateRowHeader on the left, then 7 ShiftCell components. DndContext wraps the whole grid.

**Step 1: Create the component**

Key details:
- Props: `weekDays: string[]`, `templates: ShiftTemplate[]`, `gridData: Map<string, Map<string, Shift[]>>`, `onAssign: (employeeId: string, templateId: string, day: string) => void`, `onRemoveShift: (shiftId: string) => void`, `onEditTemplate: (template: ShiftTemplate) => void`, `onAddTemplate: () => void`
- Grid layout: CSS grid with `gridTemplateColumns: '200px repeat(7, 1fr)'`
- Header row: "SHIFT" label + day headers (Mon/Tue/.../Sun with day numbers, today highlighted)
- Template rows: for each template, render a row with:
  - Left: TemplateRowHeader (name, time range, position, edit button)
  - 7 × ShiftCell (checking `templateAppliesToDay` for each day)
- Bottom: "+ Add Shift Template" button spanning full width
- DndContext is NOT here — it wraps at the ShiftPlannerTab level (because the sidebar is outside the grid)
- Use `formatLocalDate` for today check, reuse `DAY_LABELS` pattern

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateGrid.tsx
git commit -m "feat: add TemplateGrid with template rows and day columns"
```

---

### Task 9: `TemplateRowHeader` — left column of each template row

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx`

**Context:** Shows template name, time range (compact format), and position. Has a small edit/delete menu.

**Step 1: Create the component**

Key details:
- Props: `template: ShiftTemplate`, `onEdit: (template: ShiftTemplate) => void`, `onDelete: (templateId: string) => void`
- Layout: vertical stack in a sticky-left cell
  - `text-[14px] font-medium text-foreground` — template name
  - `text-[12px] text-muted-foreground` — compact time like "6a-12p"
  - `text-[12px] text-muted-foreground` — position
- Edit button: small `MoreHorizontal` icon, shows dropdown with "Edit" and "Delete"
- Use shadcn `DropdownMenu` for the actions menu
- `React.memo` with comparison on `template.id` + `template.updated_at`

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateRowHeader.tsx
git commit -m "feat: add TemplateRowHeader with edit/delete menu"
```

---

### Task 10: Rewrite `ShiftPlannerTab` — wire everything together

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/index.ts`

**Context:** The main orchestrator component. Two-panel layout: grid on left, employee sidebar on right. DndContext wraps both so employees can be dragged from sidebar into grid cells.

**Step 1: Rewrite ShiftPlannerTab**

Key wiring:
- `useShiftPlanner(restaurantId)` — get week nav, shifts, gridData, validation, mutations
- `useShiftTemplates(restaurantId)` — get templates, createTemplate, updateTemplate, deleteTemplate
- `useEmployees(restaurantId)` — get employees for sidebar
- State: `templateDialogOpen`, `editingTemplate`, `validationResult`
- DndContext with PointerSensor (activationConstraint: distance 8)
- `handleDragEnd`: extract employee from `active.data.current`, templateId+day from `over.data.current`, call `validateAndCreate` with the template's times/position
- Layout: `flex` container with grid taking `flex-1` and sidebar at `w-[200px]`
- Loading: Skeleton
- Error: error state (CalendarOff icon)
- Empty templates: "No shift templates yet" message with "Add Template" button

**Step 2: Update barrel export**

`src/components/scheduling/ShiftPlanner/index.ts` stays as `export { ShiftPlannerTab } from './ShiftPlannerTab'`

**Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/
git commit -m "feat: rewrite ShiftPlannerTab with template grid + employee sidebar"
```

---

### Task 11: Delete old components

**Files:**
- Delete: `src/components/scheduling/ShiftPlanner/WeeklyGrid.tsx`
- Delete: `src/components/scheduling/ShiftPlanner/ShiftBlock.tsx`
- Delete: `src/components/scheduling/ShiftPlanner/EmptyCell.tsx`
- Delete: `src/components/scheduling/ShiftPlanner/ShiftQuickCreate.tsx`

**Step 1: Remove files and verify build**

Run: `rm src/components/scheduling/ShiftPlanner/WeeklyGrid.tsx src/components/scheduling/ShiftPlanner/ShiftBlock.tsx src/components/scheduling/ShiftPlanner/EmptyCell.tsx src/components/scheduling/ShiftPlanner/ShiftQuickCreate.tsx`
Run: `npx tsc --noEmit` — should have zero errors (all imports should already point to new components)
Run: `npx vitest run` — all tests should pass

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old v1 shift planner components"
```

---

### Task 12: Update E2E tests

**Files:**
- Modify: `tests/e2e/shift-planner.spec.ts`

**Context:** The E2E tests need to match the new template-first flow: create a template, then assign an employee to it.

**Step 1: Rewrite the main test**

New flow:
1. Sign up, create restaurant, seed employees
2. Navigate to /scheduling, click Planner tab
3. Verify empty state ("No shift templates yet")
4. Click "Add Shift Template" button
5. Fill dialog: name="Morning", start=06:00, end=12:00, position=Server, days=Mon-Fri
6. Submit, verify template row appears in grid
7. Drag employee from sidebar into a cell (or click-based fallback: use Playwright to simulate drop)
8. Verify employee chip appears in the cell

Note: Playwright drag-and-drop with @dnd-kit can be tricky. Use `page.dispatchEvent` or the Playwright `dragTo` method. If drag is unreliable, test the assignment by calling the API directly and verifying the UI updates.

**Step 2: Commit**

```bash
git add tests/e2e/shift-planner.spec.ts
git commit -m "test: update E2E tests for template-first shift planner"
```

---

### Task 13: Build verification

**Step 1: Run full test suite**

Run: `npx vitest run` — all tests pass
Run: `npx tsc --noEmit` — zero TS errors
Run: `npx vite build` — build succeeds

**Step 2: Commit any remaining fixes, push**

```bash
git push
```
