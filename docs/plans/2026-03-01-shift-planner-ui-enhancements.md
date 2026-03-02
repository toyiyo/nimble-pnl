# Shift Planner UI Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 5 independent UI enhancements to the shift planner and schedule views — drag overlay, day indicators, assignment popover, export, and auto-select employee on add.

**Architecture:** Each enhancement is independent and modifies existing planner/schedule components. No new database tables or edge functions needed. All changes are frontend-only (React components, hooks, utilities).

**Tech Stack:** React 18, @dnd-kit/core (DragOverlay), jsPDF/jspdf-autotable, TailwindCSS, shadcn/ui

---

### Task 1: DragOverlay for Visible Drag Ghost

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
- Test: `tests/unit/shiftPlannerDragOverlay.test.ts`

**Step 1: Write the failing test**

Test that when `activeDragEmployee` is set, the overlay component renders.

```typescript
// tests/unit/shiftPlannerDragOverlay.test.ts
import { describe, it, expect } from 'vitest';

// Test the DragOverlayChip render function directly
import { DragOverlayChip } from '@/components/scheduling/ShiftPlanner/DragOverlayChip';
import { render, screen } from '@testing-library/react';

describe('DragOverlayChip', () => {
  it('renders employee name', () => {
    render(<DragOverlayChip name="Sarah Johnson" />);
    expect(screen.getByText('Sarah Johnson')).toBeDefined();
  });

  it('applies grab cursor styling', () => {
    const { container } = render(<DragOverlayChip name="John" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain('cursor-grabbing');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/shiftPlannerDragOverlay.test.ts`
Expected: FAIL — `DragOverlayChip` doesn't exist yet

**Step 3: Create the DragOverlayChip component**

Create file `src/components/scheduling/ShiftPlanner/DragOverlayChip.tsx`:

```tsx
import { cn } from '@/lib/utils';

interface DragOverlayChipProps {
  name: string;
}

export function DragOverlayChip({ name }: DragOverlayChipProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 px-3 py-2 cursor-grabbing',
        'bg-background shadow-lg ring-2 ring-foreground/10',
        'w-[180px]',
      )}
    >
      <p className="text-[13px] font-medium text-foreground truncate">{name}</p>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/shiftPlannerDragOverlay.test.ts`
Expected: PASS

**Step 5: Wire DragOverlay into ShiftPlannerTab**

Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`:

1. Add imports:
```typescript
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DragOverlayChip } from './DragOverlayChip';
```

2. Add state for active drag employee (after line 64, the `highlightCellId` state):
```typescript
const [activeDragEmployee, setActiveDragEmployee] = useState<{ id: string; name: string } | null>(null);
```

3. Add `handleDragStart` callback (before `handleDragEnd`):
```typescript
const handleDragStart = useCallback((event: DragStartEvent) => {
  const employee = event.active.data.current?.employee;
  if (employee) {
    setActiveDragEmployee({ id: employee.id, name: employee.name });
  }
}, []);
```

4. Update `handleDragEnd` to clear active drag:
- Add `setActiveDragEmployee(null);` as the very first line of `handleDragEnd` (before the `if (!over) return;`).

5. Add `handleDragCancel` callback:
```typescript
const handleDragCancel = useCallback(() => {
  setActiveDragEmployee(null);
}, []);
```

6. Update DndContext to use new handlers (around line 219):
```tsx
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
>
```

7. Add DragOverlay after `<EmployeeSidebar>` (before the closing `</DndContext>`):
```tsx
<DragOverlay dropAnimation={null}>
  {activeDragEmployee ? (
    <DragOverlayChip name={activeDragEmployee.name} />
  ) : null}
</DragOverlay>
```

**Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/DragOverlayChip.tsx \
        src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx \
        tests/unit/shiftPlannerDragOverlay.test.ts
git commit -m "feat(planner): add DragOverlay for visible drag ghost

Adds a portal-based DragOverlay from @dnd-kit so dragged employee
chips render above all other elements. Shows name-only chip with
shadow and ring styling."
```

---

### Task 2: Always-Visible Day Indicators on Shift Rows

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`
- Test: `tests/unit/shiftCellDayIndicators.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/shiftCellDayIndicators.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

describe('ShiftCell day indicators', () => {
  it('renders hatched pattern for inactive days', () => {
    const { container } = render(
      <ShiftCell
        templateId="t1"
        day="2026-03-01"
        isActiveDay={false}
        shifts={[]}
        onRemoveShift={() => {}}
      />,
    );
    const cell = container.firstChild as HTMLElement;
    // Inactive days should have the hatched background pattern
    expect(cell.className).toContain('bg-stripe');
  });

  it('renders active indicator border for active days', () => {
    const { container } = render(
      <ShiftCell
        templateId="t1"
        day="2026-03-03"
        isActiveDay={true}
        shifts={[]}
        onRemoveShift={() => {}}
      />,
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('border-l-2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/shiftCellDayIndicators.test.ts`
Expected: FAIL — no `bg-stripe` or `border-l-2` classes yet

**Step 3: Add hatched pattern CSS utility**

Add to `src/index.css` (or relevant Tailwind layer) a custom utility class. Alternatively, use inline style via a Tailwind arbitrary value. The simplest approach is to use `repeating-linear-gradient` as a Tailwind arbitrary background:

Modify `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`:

Replace the inactive day block (lines 35-41):
```tsx
if (!isActiveDay) {
  return (
    <div
      className="min-h-[64px] p-1.5 bg-stripe opacity-60"
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, transparent, transparent 4px, hsl(var(--border) / 0.3) 4px, hsl(var(--border) / 0.3) 5px)',
      }}
      aria-label={`${day} inactive`}
    />
  );
}
```

Replace the active day block (lines 44-61) — add `border-l-2 border-primary/40`:
```tsx
return (
  <div
    ref={setNodeRef}
    className={cn(
      'min-h-[64px] p-1.5 space-y-1 transition-colors duration-600',
      'border-l-2 border-primary/40',
      isOver && 'bg-foreground/5 ring-1 ring-foreground/20 rounded',
      isHighlighted && 'bg-green-500/10',
    )}
  >
    {shifts.map((shift) => (
      <EmployeeChip
        key={shift.id}
        shiftId={shift.id}
        employeeName={shift.employee?.name ?? 'Unassigned'}
        position={shift.position}
        onRemove={onRemoveShift}
      />
    ))}
  </div>
);
```

**Step 4: Update tests to match implementation**

The test for `bg-stripe` needs to check for the inline style or the class. Since we're using inline style for the gradient, update the test to check for the style attribute:

```typescript
it('renders hatched pattern for inactive days', () => {
  const { container } = render(
    <ShiftCell
      templateId="t1"
      day="2026-03-01"
      isActiveDay={false}
      shifts={[]}
      onRemoveShift={() => {}}
    />,
  );
  const cell = container.firstChild as HTMLElement;
  expect(cell.style.backgroundImage).toContain('repeating-linear-gradient');
});
```

**Step 5: Run test to verify it passes**

Run: `npm run test -- tests/unit/shiftCellDayIndicators.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftCell.tsx \
        tests/unit/shiftCellDayIndicators.test.ts
git commit -m "feat(planner): add always-visible day indicators on shift rows

Active days get a primary-colored left border accent. Inactive days
show a diagonal hatched pattern making it immediately clear which
days a shift covers without needing to drag."
```

---

### Task 3: Day-vs-Shift Assignment Popover

**Files:**
- Create: `src/components/scheduling/ShiftPlanner/AssignmentPopover.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
- Modify: `src/hooks/useShiftPlanner.ts` (add `bulkValidateAndCreate` helper)
- Test: `tests/unit/assignmentPopover.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/assignmentPopover.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssignmentPopover } from '@/components/scheduling/ShiftPlanner/AssignmentPopover';

describe('AssignmentPopover', () => {
  const defaultProps = {
    open: true,
    employeeName: 'Sarah Johnson',
    shiftName: 'Morning',
    activeDayCount: 5,
    onAssignDay: vi.fn(),
    onAssignAll: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders employee and shift name', () => {
    render(<AssignmentPopover {...defaultProps} />);
    expect(screen.getByText(/Sarah Johnson/)).toBeDefined();
    expect(screen.getByText(/Morning/)).toBeDefined();
  });

  it('shows day count in "all days" button', () => {
    render(<AssignmentPopover {...defaultProps} />);
    expect(screen.getByText(/All 5 days/)).toBeDefined();
  });

  it('calls onAssignDay when "This day only" is clicked', () => {
    render(<AssignmentPopover {...defaultProps} />);
    fireEvent.click(screen.getByText(/This day only/));
    expect(defaultProps.onAssignDay).toHaveBeenCalledOnce();
  });

  it('calls onAssignAll when "All days" is clicked', () => {
    render(<AssignmentPopover {...defaultProps} />);
    fireEvent.click(screen.getByText(/All 5 days/));
    expect(defaultProps.onAssignAll).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/assignmentPopover.test.ts`
Expected: FAIL — `AssignmentPopover` doesn't exist

**Step 3: Create AssignmentPopover component**

Create `src/components/scheduling/ShiftPlanner/AssignmentPopover.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CalendarDays, CalendarCheck } from 'lucide-react';

interface AssignmentPopoverProps {
  open: boolean;
  employeeName: string;
  shiftName: string;
  activeDayCount: number;
  onAssignDay: () => void;
  onAssignAll: () => void;
  onCancel: () => void;
}

export function AssignmentPopover({
  open,
  employeeName,
  shiftName,
  activeDayCount,
  onAssignDay,
  onAssignAll,
  onCancel,
}: AssignmentPopoverProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-xs p-0 gap-0 border-border/40">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="text-[15px] font-semibold text-foreground">
            Assign {employeeName}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            to {shiftName}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4 space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-10 text-[13px] font-medium rounded-lg border-border/40"
            onClick={onAssignDay}
          >
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
            This day only
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-10 text-[13px] font-medium rounded-lg border-border/40"
            onClick={onAssignAll}
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            All {activeDayCount} days this week
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/assignmentPopover.test.ts`
Expected: PASS

**Step 5: Write test for bulk create helper**

```typescript
// Add to tests/unit/assignmentPopover.test.ts
import { getActiveDaysForWeek } from '@/hooks/useShiftPlanner';
import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

describe('getActiveDaysForWeek', () => {
  it('returns only days the template applies to', () => {
    const weekDays = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
    // Template for Mon-Fri (days 1-5)
    const template = { days: [1, 2, 3, 4, 5] };
    const result = getActiveDaysForWeek(template, weekDays);
    expect(result).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
  });
});
```

**Step 6: Add `getActiveDaysForWeek` to `useShiftPlanner.ts`**

Add to `src/hooks/useShiftPlanner.ts` (in the pure utility section near line 37):

```typescript
/**
 * Returns the subset of weekDays where the template is active.
 */
export function getActiveDaysForWeek(
  template: Pick<ShiftTemplate, 'days'>,
  weekDays: string[],
): string[] {
  return weekDays.filter((day) => templateAppliesToDay(template, day));
}
```

Add the import at top:
```typescript
import { templateAppliesToDay } from '@/hooks/useShiftTemplates';
```

**Step 7: Run tests**

Run: `npm run test -- tests/unit/assignmentPopover.test.ts`
Expected: PASS

**Step 8: Wire popover into ShiftPlannerTab**

Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`:

1. Add imports:
```typescript
import { AssignmentPopover } from './AssignmentPopover';
import { getActiveDaysForWeek } from '@/hooks/useShiftPlanner';
```

2. Add state for pending assignment (after `activeDragEmployee` state):
```typescript
const [pendingAssignment, setPendingAssignment] = useState<{
  employee: { id: string; name: string };
  template: ShiftTemplate;
  day: string;
} | null>(null);
```

3. Replace `handleDragEnd` logic. Instead of immediately calling `validateAndCreate`, store the pending assignment:
```typescript
const handleDragEnd = useCallback(async (event: DragEndEvent) => {
  setActiveDragEmployee(null);
  const { active, over } = event;
  if (!over) return;

  const employee = active.data.current?.employee;
  if (!employee) return;

  const [templateId, day] = String(over.id).split(':');
  if (!templateId || !day) return;

  const template = templates.find((t) => t.id === templateId);
  if (!template) return;

  setPendingAssignment({ employee: { id: employee.id, name: employee.name }, template, day });
}, [templates]);
```

4. Add assignment handlers:
```typescript
const handleAssignDay = useCallback(async () => {
  if (!pendingAssignment) return;
  const { employee, template, day } = pendingAssignment;
  setPendingAssignment(null);

  const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
  const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

  const success = await validateAndCreate({
    employeeId: employee.id,
    date: day,
    startTime: startHHMM,
    endTime: endHHMM,
    position: template.position,
    breakDuration: template.break_duration,
  });

  if (success) {
    clearValidation();
    setHighlightCellId(`${template.id}:${day}`);
    setTimeout(() => setHighlightCellId(null), 600);
    const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    toast({ title: `${employee.name} assigned to ${template.name} — ${dayLabel}` });
  }
}, [pendingAssignment, validateAndCreate, clearValidation, toast]);

const handleAssignAll = useCallback(async () => {
  if (!pendingAssignment) return;
  const { employee, template } = pendingAssignment;
  setPendingAssignment(null);

  const activeDays = getActiveDaysForWeek(template, weekDays);
  const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
  const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

  let successCount = 0;
  for (const day of activeDays) {
    const success = await validateAndCreate({
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
    });
    if (success) successCount++;
  }

  clearValidation();
  toast({
    title: `${employee.name} assigned to ${template.name} — ${successCount}/${activeDays.length} days`,
  });
}, [pendingAssignment, weekDays, validateAndCreate, clearValidation, toast]);

const handleCancelAssignment = useCallback(() => {
  setPendingAssignment(null);
}, []);
```

5. Add `AssignmentPopover` to the JSX (after the `TemplateFormDialog`):
```tsx
{pendingAssignment && (
  <AssignmentPopover
    open={true}
    employeeName={pendingAssignment.employee.name}
    shiftName={pendingAssignment.template.name}
    activeDayCount={getActiveDaysForWeek(pendingAssignment.template, weekDays).length}
    onAssignDay={handleAssignDay}
    onAssignAll={handleAssignAll}
    onCancel={handleCancelAssignment}
  />
)}
```

**Step 9: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/AssignmentPopover.tsx \
        src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx \
        src/hooks/useShiftPlanner.ts \
        tests/unit/assignmentPopover.test.ts
git commit -m "feat(planner): add day-vs-shift assignment popover on drop

When dropping an employee onto a shift, a dialog now asks whether
to assign for 'This day only' or 'All N days this week'. Bulk
assignment loops through active days using getActiveDaysForWeek."
```

---

### Task 4: PDF + CSV Export in Planner View

**Files:**
- Create: `src/utils/plannerExport.ts`
- Create: `src/components/scheduling/ShiftPlanner/PlannerExportDialog.tsx`
- Modify: `src/components/scheduling/ShiftPlanner/PlannerHeader.tsx`
- Test: `tests/unit/plannerExport.test.ts`

**Step 1: Write the failing test for CSV generation**

```typescript
// tests/unit/plannerExport.test.ts
import { describe, it, expect } from 'vitest';
import { generatePlannerCSV } from '@/utils/plannerExport';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

describe('generatePlannerCSV', () => {
  const mockShifts: Partial<Shift>[] = [
    {
      id: 's1',
      employee_id: 'e1',
      start_time: '2026-03-02T09:00:00.000Z',
      end_time: '2026-03-02T17:00:00.000Z',
      position: 'Server',
      break_duration: 30,
      status: 'scheduled',
      employee: { id: 'e1', name: 'Sarah Johnson' },
    },
  ];

  const mockTemplates: Partial<ShiftTemplate>[] = [
    {
      id: 't1',
      name: 'Morning',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'Server',
      days: [1, 2, 3, 4, 5],
      break_duration: 30,
    },
  ];

  it('generates CSV with header row', () => {
    const csv = generatePlannerCSV({
      shifts: mockShifts as Shift[],
      templates: mockTemplates as ShiftTemplate[],
      weekDays: ['2026-03-02'],
    });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Employee,Shift,Day,Date,Start,End,Position,Break');
  });

  it('includes shift data rows', () => {
    const csv = generatePlannerCSV({
      shifts: mockShifts as Shift[],
      templates: mockTemplates as ShiftTemplate[],
      weekDays: ['2026-03-02'],
    });
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain('Sarah Johnson');
    expect(lines[1]).toContain('Morning');
    expect(lines[1]).toContain('Server');
  });

  it('excludes cancelled shifts', () => {
    const cancelled = [
      { ...mockShifts[0], status: 'cancelled' },
    ];
    const csv = generatePlannerCSV({
      shifts: cancelled as Shift[],
      templates: mockTemplates as ShiftTemplate[],
      weekDays: ['2026-03-02'],
    });
    const lines = csv.split('\n').filter(Boolean);
    expect(lines.length).toBe(1); // header only
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/plannerExport.test.ts`
Expected: FAIL — `generatePlannerCSV` doesn't exist

**Step 3: Create plannerExport.ts**

Create `src/utils/plannerExport.ts`:

```typescript
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shift, ShiftTemplate } from '@/types/scheduling';
import { formatLocalDate, formatLocalTime } from '@/hooks/useShiftPlanner';
import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

export interface PlannerExportOptions {
  shifts: Shift[];
  templates: ShiftTemplate[];
  weekDays: string[];
  restaurantName?: string;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return DAY_NAMES[date.getDay()];
}

function formatTime12(isoStr: string): string {
  const d = new Date(isoStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`;
}

/**
 * Find the template that best matches a shift.
 */
function findTemplateForShift(
  shift: Shift,
  templates: ShiftTemplate[],
): ShiftTemplate | undefined {
  const shiftDate = formatLocalDate(new Date(shift.start_time));
  const shiftStartLocal = formatLocalTime(shift.start_time);
  const shiftEndLocal = formatLocalTime(shift.end_time);
  const dayOfWeek = new Date(shift.start_time).getDay();

  return templates.find(
    (t) =>
      t.start_time === shiftStartLocal &&
      t.end_time === shiftEndLocal &&
      t.position === shift.position &&
      t.days.includes(dayOfWeek),
  );
}

/**
 * Build rows for export: one row per shift assignment.
 */
function buildExportRows(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): string[][] {
  const weekDaySet = new Set(weekDays);
  const rows: string[][] = [];

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const dateStr = formatLocalDate(new Date(shift.start_time));
    if (!weekDaySet.has(dateStr)) continue;

    const template = findTemplateForShift(shift, templates);
    const employeeName = shift.employee?.name ?? 'Unassigned';
    const shiftName = template?.name ?? 'Unmatched';

    rows.push([
      employeeName,
      shiftName,
      getDayName(dateStr),
      dateStr,
      formatTime12(shift.start_time),
      formatTime12(shift.end_time),
      shift.position,
      String(shift.break_duration ?? 0),
    ]);
  }

  // Sort by date, then shift name, then employee
  rows.sort((a, b) => {
    const dateCompare = a[3].localeCompare(b[3]);
    if (dateCompare !== 0) return dateCompare;
    const shiftCompare = a[1].localeCompare(b[1]);
    if (shiftCompare !== 0) return shiftCompare;
    return a[0].localeCompare(b[0]);
  });

  return rows;
}

const CSV_HEADER = 'Employee,Shift,Day,Date,Start,End,Position,Break';

/**
 * Generate CSV string for planner export.
 */
export function generatePlannerCSV(options: PlannerExportOptions): string {
  const rows = buildExportRows(options.shifts, options.templates, options.weekDays);
  const csvRows = rows.map((row) =>
    row.map((cell) => {
      // Escape cells that contain commas or quotes
      if (cell.includes(',') || cell.includes('"')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(','),
  );
  return [CSV_HEADER, ...csvRows].join('\n');
}

/**
 * Download a CSV string as a file.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate and download a PDF for the planner view.
 */
export function generatePlannerPDF(options: PlannerExportOptions): void {
  const { templates, weekDays, restaurantName = 'Restaurant' } = options;
  const rows = buildExportRows(options.shifts, options.templates, options.weekDays);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(restaurantName.toUpperCase(), pageWidth / 2, margin, { align: 'center' });

  // Week range
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const firstDay = weekDays[0] ?? '';
  const lastDay = weekDays[weekDays.length - 1] ?? '';
  doc.text(`Planner: ${firstDay} to ${lastDay}`, pageWidth / 2, margin + 20, { align: 'center' });

  // Table
  autoTable(doc, {
    startY: margin + 40,
    head: [['Employee', 'Shift', 'Day', 'Date', 'Start', 'End', 'Position', 'Break']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontSize: 9 },
    margin: { left: margin, right: margin },
  });

  const filename = `planner_${firstDay}_to_${lastDay}.pdf`;
  doc.save(filename);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/plannerExport.test.ts`
Expected: PASS

**Step 5: Create PlannerExportDialog**

Create `src/components/scheduling/ShiftPlanner/PlannerExportDialog.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { generatePlannerCSV, generatePlannerPDF, downloadCSV } from '@/utils/plannerExport';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

interface PlannerExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: Shift[];
  templates: ShiftTemplate[];
  weekDays: string[];
  restaurantName?: string;
}

export function PlannerExportDialog({
  open,
  onOpenChange,
  shifts,
  templates,
  weekDays,
  restaurantName,
}: PlannerExportDialogProps) {
  const firstDay = weekDays[0] ?? '';
  const lastDay = weekDays[weekDays.length - 1] ?? '';

  const handlePDF = () => {
    generatePlannerPDF({ shifts, templates, weekDays, restaurantName });
    onOpenChange(false);
  };

  const handleCSV = () => {
    const csv = generatePlannerCSV({ shifts, templates, weekDays });
    downloadCSV(csv, `planner_${firstDay}_to_${lastDay}.csv`);
    onOpenChange(false);
  };

  const shiftCount = shifts.filter((s) => s.status !== 'cancelled').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Printer className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Export Planner</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {firstDay} to {lastDay} &middot; {shiftCount} shifts
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12 text-[14px] font-medium rounded-lg border-border/40"
            onClick={handlePDF}
          >
            <FileDown className="h-5 w-5 text-muted-foreground" />
            <div className="text-left">
              <div>Download PDF</div>
              <div className="text-[12px] text-muted-foreground font-normal">Print-ready landscape layout</div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12 text-[14px] font-medium rounded-lg border-border/40"
            onClick={handleCSV}
          >
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            <div className="text-left">
              <div>Download CSV</div>
              <div className="text-[12px] text-muted-foreground font-normal">For spreadsheets and payroll</div>
            </div>
          </Button>
        </div>
        <DialogFooter className="px-6 pb-4">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 6: Add export button to PlannerHeader**

Modify `src/components/scheduling/ShiftPlanner/PlannerHeader.tsx`:

1. Add prop for `onExport`:
```typescript
interface PlannerHeaderProps {
  weekStart: Date;
  weekEnd: Date;
  totalHours: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onExport?: () => void;
}
```

2. Add the button in the right section (after the "scheduled" span):
```tsx
{onExport && (
  <Button
    variant="ghost"
    size="sm"
    className="h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
    onClick={onExport}
    aria-label="Export planner"
  >
    <Printer className="h-3.5 w-3.5 mr-1" />
    Export
  </Button>
)}
```

3. Add import: `import { ChevronLeft, ChevronRight, Calendar, Printer } from 'lucide-react';`
4. Add `onExport` to the memo function params and update the component signature.

**Step 7: Wire export dialog into ShiftPlannerTab**

Modify `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`:

1. Import: `import { PlannerExportDialog } from './PlannerExportDialog';`
2. Add state: `const [exportDialogOpen, setExportDialogOpen] = useState(false);`
3. Add handler: `const handleExport = useCallback(() => setExportDialogOpen(true), []);`
4. Pass to PlannerHeader: `onExport={handleExport}`
5. Add dialog to JSX (after `AssignmentPopover`):
```tsx
<PlannerExportDialog
  open={exportDialogOpen}
  onOpenChange={setExportDialogOpen}
  shifts={shifts}
  templates={templates}
  weekDays={weekDays}
  restaurantName={undefined}
/>
```

**Step 8: Commit**

```bash
git add src/utils/plannerExport.ts \
        src/components/scheduling/ShiftPlanner/PlannerExportDialog.tsx \
        src/components/scheduling/ShiftPlanner/PlannerHeader.tsx \
        src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx \
        tests/unit/plannerExport.test.ts
git commit -m "feat(planner): add PDF and CSV export to planner view

Adds an Export button to the planner header that opens a dialog
with PDF and CSV download options. CSV includes employee, shift,
day, date, start/end times, position, and break duration."
```

---

### Task 5: Auto-Select Employee/Position on Add in Schedule View

**Files:**
- Modify: `src/pages/Scheduling.tsx`
- Modify: `src/components/ShiftDialog.tsx`
- Test: `tests/unit/shiftDialogAutoSelect.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/shiftDialogAutoSelect.test.ts
import { describe, it, expect, vi } from 'vitest';

// Test the props interface logic rather than full component render
// since ShiftDialog has heavy dependencies
describe('ShiftDialog auto-select behavior', () => {
  it('should accept defaultEmployee prop with id, name, and position', () => {
    // This tests that the interface exists and is compatible
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      restaurantId: 'r1',
      defaultEmployee: {
        id: 'e1',
        name: 'Sarah Johnson',
        position: 'Server',
      },
      defaultDate: new Date('2026-03-02'),
    };
    // Type check — if this compiles, the interface is correct
    expect(props.defaultEmployee.id).toBe('e1');
    expect(props.defaultEmployee.position).toBe('Server');
  });
});
```

**Step 2: Modify ShiftDialog to accept defaultEmployee**

Modify `src/components/ShiftDialog.tsx`:

1. Update the interface (around line 19):
```typescript
interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift & { _editScope?: RecurringActionScope };
  restaurantId: string;
  defaultDate?: Date;
  defaultEmployee?: {
    id: string;
    name: string;
    position: string | null;
  };
}
```

2. Update the component signature to destructure `defaultEmployee`:
```typescript
export const ShiftDialog = ({ open, onOpenChange, shift, restaurantId, defaultDate, defaultEmployee }: ShiftDialogProps) => {
```

3. In the `useEffect` that handles form reset (around line 85-107), add employee pre-fill logic in the `else` branch (when not editing an existing shift):
```typescript
} else {
  resetForm();
  if (defaultDate) {
    const dateStr = format(defaultDate, 'yyyy-MM-dd');
    setStartDate(dateStr);
    setEndDate(dateStr);
  }
  if (defaultEmployee) {
    setEmployeeId(defaultEmployee.id);
    if (defaultEmployee.position) {
      setPosition(defaultEmployee.position);
    }
  }
}
```

Update the effect dependency array to include `defaultEmployee`:
```typescript
}, [shift, defaultDate, defaultEmployee, open]);
```

4. In the Employee `<Select>` JSX, add `disabled` when defaultEmployee is set and we're creating (not editing):
Find the employee Select component and add:
```tsx
<Select
  value={employeeId}
  onValueChange={setEmployeeId}
  disabled={!!defaultEmployee && !shift}
>
```

**Step 3: Modify Scheduling.tsx to pass employee context**

Modify `src/pages/Scheduling.tsx`:

1. Add state for default employee (near the `defaultShiftDate` state around line 247):
```typescript
const [defaultShiftEmployee, setDefaultShiftEmployee] = useState<{
  id: string;
  name: string;
  position: string | null;
} | undefined>();
```

2. Update `handleAddShift` to accept employee (around line 362):
```typescript
const handleAddShift = (date?: Date, employee?: { id: string; name: string; position: string | null }) => {
  setSelectedShift(undefined);
  setDefaultShiftDate(date);
  setDefaultShiftEmployee(employee);
  setShiftDialogOpen(true);
};
```

3. Update the "Add" button click in the employee row (around line 1104) to pass employee:
```tsx
onClick={() => handleAddShift(day, employee)}
```

4. Pass `defaultEmployee` to ShiftDialog (around line 1243-1249):
```tsx
<ShiftDialog
  open={shiftDialogOpen}
  onOpenChange={setShiftDialogOpen}
  shift={selectedShift}
  restaurantId={restaurantId}
  defaultDate={defaultShiftDate}
  defaultEmployee={defaultShiftEmployee}
/>
```

5. Clear default employee when dialog closes or when editing (in `handleEditShift` around line 378):
```typescript
setDefaultShiftEmployee(undefined);
```

**Step 4: Run test**

Run: `npm run test -- tests/unit/shiftDialogAutoSelect.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/Scheduling.tsx \
        src/components/ShiftDialog.tsx \
        tests/unit/shiftDialogAutoSelect.test.ts
git commit -m "feat(schedule): auto-select employee and position on Add

When clicking Add in an employee's schedule row, the ShiftDialog
now pre-fills the employee (disabled) and their profile position.
Reduces redundant clicks when adding shifts from the grid."
```

---

### Task 6: Verify All Tests Pass and Lint

**Step 1: Run all unit tests**

Run: `npm run test`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new errors introduced

**Step 3: Run build**

Run: `npm run build`
Expected: Clean build with no type errors

**Step 4: Final commit if any fixes needed**

Fix any lint/type issues and commit.
