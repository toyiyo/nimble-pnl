# Schedule Drag-to-Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow managers to drag existing shift cards in the schedule grid to copy them to other days for the same employee.

**Architecture:** Add `@dnd-kit/core` DnD context to the schedule grid table. ShiftCards become draggable, day cells become droppable. On drop, validate and create a copy of the shift on the target day using existing `useCreateShift` + `checkConflictsImperative`. New components extracted to `src/components/scheduling/` to avoid bloating the 17k-line Scheduling.tsx further.

**Tech Stack:** @dnd-kit/core (already installed), React, TypeScript, existing useCreateShift + checkConflictsImperative hooks

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/components/scheduling/DraggableShiftCard.tsx` (create) | Wraps ShiftCard with `useDraggable`, manages cursor/opacity styles |
| `src/components/scheduling/DroppableDayCell.tsx` (create) | Wraps each day `<td>` with `useDroppable`, visual drop feedback |
| `src/components/scheduling/ShiftDragOverlay.tsx` (create) | Floating ghost card for `<DragOverlay>` showing time + position |
| `src/components/scheduling/useShiftCopyDnd.ts` (create) | Hook encapsulating DnD state, handlers, validation, and copy logic |
| `src/pages/Scheduling.tsx` (modify) | Wire DndContext + new components into schedule grid |
| `tests/unit/useShiftCopyDnd.test.ts` (create) | Unit tests for copy logic, guards, time extraction |

---

### Task 1: Create useShiftCopyDnd hook (logic only, no UI)

**Files:**
- Create: `src/components/scheduling/useShiftCopyDnd.ts`
- Create: `tests/unit/useShiftCopyDnd.test.ts`
- Reference: `src/hooks/useShifts.tsx:89-119` (useCreateShift)
- Reference: `src/hooks/useConflictDetection.tsx:109-113` (checkConflictsImperative)
- Reference: `src/types/scheduling.ts` (Shift, ConflictCheck)

This hook manages all drag-to-copy state and logic. It returns:
- `activeDragShift` — the shift being dragged (for DragOverlay)
- `conflictDialog` — open/data/handlers for AvailabilityConflictDialog
- `highlightedCellId` — cell ID to flash green after copy
- `handleDragStart`, `handleDragEnd`, `handleDragCancel` — DnD event handlers
- `sensors` — configured PointerSensor

- [ ] **Step 1: Write failing tests for the copy logic helpers**

Create `tests/unit/useShiftCopyDnd.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractLocalTime, buildCopyPayload, shouldAllowDrop } from '@/components/scheduling/useShiftCopyDnd';

describe('extractLocalTime', () => {
  it('extracts HH:MM from a Date in local timezone', () => {
    // Create a date at 9:30 AM local time
    const date = new Date(2026, 2, 24, 9, 30, 0); // March 24, 2026 9:30 AM
    expect(extractLocalTime(date)).toBe('09:30');
  });

  it('handles midnight correctly', () => {
    const date = new Date(2026, 2, 24, 0, 0, 0);
    expect(extractLocalTime(date)).toBe('00:00');
  });

  it('handles PM times', () => {
    const date = new Date(2026, 2, 24, 22, 15, 0);
    expect(extractLocalTime(date)).toBe('22:15');
  });
});

describe('shouldAllowDrop', () => {
  it('returns false when dropping on the same day', () => {
    expect(shouldAllowDrop({
      sourceEmployeeId: 'emp-1',
      sourceDay: '2026-03-24',
      targetEmployeeId: 'emp-1',
      targetDay: '2026-03-24',
    })).toBe(false);
  });

  it('returns false when dropping on a different employee', () => {
    expect(shouldAllowDrop({
      sourceEmployeeId: 'emp-1',
      sourceDay: '2026-03-24',
      targetEmployeeId: 'emp-2',
      targetDay: '2026-03-25',
    })).toBe(false);
  });

  it('returns true for same employee, different day', () => {
    expect(shouldAllowDrop({
      sourceEmployeeId: 'emp-1',
      sourceDay: '2026-03-24',
      targetEmployeeId: 'emp-1',
      targetDay: '2026-03-25',
    })).toBe(true);
  });
});

describe('buildCopyPayload', () => {
  const baseShift = {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: new Date(2026, 2, 24, 9, 0, 0).toISOString(),
    end_time: new Date(2026, 2, 24, 17, 0, 0).toISOString(),
    break_duration: 30,
    position: 'Server',
    notes: 'Morning shift',
    status: 'scheduled' as const,
    is_recurring: true,
    recurrence_pattern: { type: 'weekly' as const, endType: 'never' as const },
    recurrence_parent_id: 'parent-1',
    is_published: false,
    locked: false,
    created_at: '',
    updated_at: '',
  };

  it('builds payload with correct target date and local times', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26');
    expect(payload.employee_id).toBe('emp-1');
    expect(payload.restaurant_id).toBe('rest-1');
    expect(payload.position).toBe('Server');
    expect(payload.break_duration).toBe(30);
    expect(payload.notes).toBe('Morning shift');
    // start_time should be on target date with same local time
    const start = new Date(payload.start_time);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(26);
  });

  it('strips recurrence fields — always creates a one-off', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26');
    expect(payload.is_recurring).toBe(false);
    expect(payload.recurrence_pattern).toBeNull();
    expect(payload.recurrence_parent_id).toBeNull();
  });

  it('sets status to scheduled and locked to false', () => {
    const payload = buildCopyPayload({ ...baseShift, status: 'confirmed', locked: true }, '2026-03-26');
    expect(payload.status).toBe('scheduled');
    expect(payload.locked).toBe(false);
    expect(payload.is_published).toBe(false);
  });

  it('handles overnight shifts (end time next day)', () => {
    const overnight = {
      ...baseShift,
      start_time: new Date(2026, 2, 24, 22, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 25, 2, 0, 0).toISOString(),
    };
    const payload = buildCopyPayload(overnight, '2026-03-28');
    const start = new Date(payload.start_time);
    const end = new Date(payload.end_time);
    expect(start.getHours()).toBe(22);
    expect(start.getDate()).toBe(28);
    expect(end.getHours()).toBe(2);
    expect(end.getDate()).toBe(29); // next day
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/useShiftCopyDnd.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the exported helper functions**

Create `src/components/scheduling/useShiftCopyDnd.ts`:

```typescript
import { useState, useCallback, useRef } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { format, parseISO } from 'date-fns';
import type { Shift, ConflictCheck } from '@/types/scheduling';
import type { ConflictDialogData } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';
import { checkConflictsImperative } from '@/hooks/useConflictDetection';
import { useCreateShift } from '@/hooks/useShifts';
import { useToast } from '@/hooks/use-toast';

// --- Pure helpers (exported for testing) ---

/** Extract HH:MM from a Date using local timezone. */
export function extractLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Guard: is this a valid drop target? */
export function shouldAllowDrop(params: {
  sourceEmployeeId: string;
  sourceDay: string;
  targetEmployeeId: string;
  targetDay: string;
}): boolean {
  return (
    params.sourceEmployeeId === params.targetEmployeeId &&
    params.sourceDay !== params.targetDay
  );
}

/** Build a shift creation payload from a source shift + target date. */
export function buildCopyPayload(
  shift: Shift,
  targetDay: string, // 'YYYY-MM-DD'
): Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'> {
  const sourceStart = parseISO(shift.start_time);
  const sourceEnd = parseISO(shift.end_time);
  const durationMs = sourceEnd.getTime() - sourceStart.getTime();

  // Build new start on target day with same local time
  const [year, month, day] = targetDay.split('-').map(Number);
  const newStart = new Date(year, month - 1, day, sourceStart.getHours(), sourceStart.getMinutes(), sourceStart.getSeconds());
  const newEnd = new Date(newStart.getTime() + durationMs);

  return {
    restaurant_id: shift.restaurant_id,
    employee_id: shift.employee_id,
    start_time: newStart.toISOString(),
    end_time: newEnd.toISOString(),
    break_duration: shift.break_duration,
    position: shift.position,
    notes: shift.notes,
    status: 'scheduled',
    is_recurring: false,
    recurrence_pattern: null,
    recurrence_parent_id: null,
    is_published: false,
    locked: false,
  };
}

// --- DnD State Types ---

interface DragData {
  shift: Shift;
  employeeId: string;
  day: string; // 'YYYY-MM-DD'
}

interface ShiftCopyDndState {
  activeDragShift: Shift | null;
  conflictDialogOpen: boolean;
  conflictDialogData: ConflictDialogData | null;
  pendingPayload: Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'> | null;
  highlightedCellId: string | null;
}

// --- Hook ---

export function useShiftCopyDnd(restaurantTimezone: string) {
  const [state, setState] = useState<ShiftCopyDndState>({
    activeDragShift: null,
    conflictDialogOpen: false,
    conflictDialogData: null,
    pendingPayload: null,
    highlightedCellId: null,
  });

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const createShift = useCreateShift();
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data?.shift) {
      setState((prev) => ({ ...prev, activeDragShift: data.shift }));
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setState((prev) => ({ ...prev, activeDragShift: null }));
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setState((prev) => ({ ...prev, activeDragShift: null }));

      if (!over) return;

      const dragData = active.data.current as DragData | undefined;
      if (!dragData?.shift) return;

      // Parse drop target: "employeeId:YYYY-MM-DD"
      const overIdStr = String(over.id);
      const colonIdx = overIdStr.lastIndexOf(':');
      if (colonIdx === -1) return;
      // Employee IDs are UUIDs which don't contain colons, but dates use hyphens
      // Format: "uuid:YYYY-MM-DD" — split on last colon
      const targetEmployeeId = overIdStr.slice(0, colonIdx);
      const targetDay = overIdStr.slice(colonIdx + 1);

      if (
        !shouldAllowDrop({
          sourceEmployeeId: dragData.employeeId,
          sourceDay: dragData.day,
          targetEmployeeId,
          targetDay,
        })
      ) {
        return;
      }

      const payload = buildCopyPayload(dragData.shift, targetDay);

      // Check for conflicts
      try {
        const { conflicts, hasConflicts } = await checkConflictsImperative({
          employeeId: payload.employee_id,
          restaurantId: payload.restaurant_id,
          startTime: payload.start_time,
          endTime: payload.end_time,
        });

        if (hasConflicts) {
          setState((prev) => ({
            ...prev,
            conflictDialogOpen: true,
            conflictDialogData: {
              employeeName: dragData.shift.employee?.name || 'Employee',
              conflicts,
              warnings: [],
            },
            pendingPayload: payload,
          }));
          return;
        }
      } catch {
        // If conflict check fails, proceed with creation (server will validate)
      }

      // No conflicts — create directly
      await executeCreate(payload, targetDay);
    },
    [restaurantTimezone, executeCreate],
  );

  const executeCreate = useCallback(
    async (
      payload: Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>,
      targetDay: string,
    ) => {
      // NOTE: useCreateShift already fires a success/error toast via onSuccess/onError,
      // so we do NOT call toast() here to avoid a double-notification.
      await createShift.mutateAsync(payload);
      const cellId = `${payload.employee_id}:${targetDay}`;
      setState((prev) => ({ ...prev, highlightedCellId: cellId }));
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, highlightedCellId: null }));
      }, 600);
    },
    [createShift, toast],
  );

  const handleConflictConfirm = useCallback(async () => {
    const payload = state.pendingPayload;
    if (!payload) return;
    // Extract targetDay from payload start_time
    const targetDay = format(parseISO(payload.start_time), 'yyyy-MM-dd');
    setState((prev) => ({
      ...prev,
      conflictDialogOpen: false,
      conflictDialogData: null,
      pendingPayload: null,
    }));
    await executeCreate(payload, targetDay);
  }, [state.pendingPayload, executeCreate]);

  const handleConflictCancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      conflictDialogOpen: false,
      conflictDialogData: null,
      pendingPayload: null,
    }));
  }, []);

  return {
    sensors,
    activeDragShift: state.activeDragShift,
    highlightedCellId: state.highlightedCellId,
    conflictDialog: {
      open: state.conflictDialogOpen,
      data: state.conflictDialogData,
      onConfirm: handleConflictConfirm,
      onCancel: handleConflictCancel,
    },
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/useShiftCopyDnd.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/useShiftCopyDnd.ts tests/unit/useShiftCopyDnd.test.ts
git commit -m "feat: add useShiftCopyDnd hook with copy logic and validation"
```

---

### Task 2: Create ShiftDragOverlay component

**Files:**
- Create: `src/components/scheduling/ShiftDragOverlay.tsx`
- Reference: `src/components/scheduling/ShiftPlanner/DragOverlayChip.tsx` (pattern)
- Reference: `src/pages/Scheduling.tsx:104-236` (ShiftCard rendering)

- [ ] **Step 1: Create ShiftDragOverlay component**

Create `src/components/scheduling/ShiftDragOverlay.tsx`:

```typescript
import { format, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Shift } from '@/types/scheduling';

interface ShiftDragOverlayProps {
  shift: Shift;
}

/**
 * Floating ghost card rendered inside DragOverlay during shift drag-to-copy.
 * Shows time range + position for clear visual feedback.
 */
export function ShiftDragOverlay({ shift }: Readonly<ShiftDragOverlayProps>) {
  const start = parseISO(shift.start_time);
  const end = parseISO(shift.end_time);
  const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 px-3 py-2 cursor-grabbing min-w-[120px]',
        'bg-background shadow-lg ring-2 ring-foreground/20',
      )}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <span>
          {format(start, 'h:mm')}
          <span className="text-muted-foreground font-normal">{format(start, 'a').toLowerCase()}</span>
        </span>
        <span className="text-muted-foreground">–</span>
        <span>
          {format(end, 'h:mm')}
          <span className="text-muted-foreground font-normal">{format(end, 'a').toLowerCase()}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
        <Clock className="h-2.5 w-2.5" />
        <span>{durationHours.toFixed(1)}h</span>
        <span className="mx-0.5">·</span>
        <span>{shift.position}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduling/ShiftDragOverlay.tsx
git commit -m "feat: add ShiftDragOverlay ghost card component"
```

---

### Task 3: Create DraggableShiftCard wrapper

**Files:**
- Create: `src/components/scheduling/DraggableShiftCard.tsx`
- Reference: `src/pages/Scheduling.tsx:95-236` (ShiftCard props/rendering)

- [ ] **Step 1: Create DraggableShiftCard component**

Create `src/components/scheduling/DraggableShiftCard.tsx`:

```typescript
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { Shift } from '@/types/scheduling';

interface DraggableShiftCardProps {
  shift: Shift;
  employeeId: string;
  day: string; // 'YYYY-MM-DD'
  children: React.ReactNode;
}

/**
 * Wraps a ShiftCard to make it draggable for copy-to-day.
 * Passes shift data to DnD context and applies drag styles.
 */
export function DraggableShiftCard({
  shift,
  employeeId,
  day,
  children,
}: Readonly<DraggableShiftCardProps>) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    data: { shift, employeeId, day },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      aria-roledescription="draggable shift"
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduling/DraggableShiftCard.tsx
git commit -m "feat: add DraggableShiftCard wrapper component"
```

---

### Task 4: Create DroppableDayCell component

**Files:**
- Create: `src/components/scheduling/DroppableDayCell.tsx`
- Reference: `src/pages/Scheduling.tsx:1127-1158` (current day cell td)

- [ ] **Step 1: Create DroppableDayCell component**

Create `src/components/scheduling/DroppableDayCell.tsx`:

```typescript
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

interface DroppableDayCellProps {
  employeeId: string;
  day: string; // 'YYYY-MM-DD'
  isToday: boolean;
  isHighlighted: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a schedule grid day cell as a drop target for shift copy.
 * Shows visual feedback when a shift is dragged over it.
 */
export function DroppableDayCell({
  employeeId,
  day,
  isToday: dayIsToday,
  isHighlighted,
  children,
}: Readonly<DroppableDayCellProps>) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${employeeId}:${day}`,
  });

  return (
    <td
      ref={setNodeRef}
      className={cn(
        'p-2 align-top transition-colors',
        dayIsToday && 'bg-primary/5',
        isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/30 rounded-lg',
        isHighlighted && 'bg-green-500/10 transition-colors duration-600',
      )}
    >
      {children}
    </td>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/scheduling/DroppableDayCell.tsx
git commit -m "feat: add DroppableDayCell component with drop feedback"
```

---

### Task 5: Wire DnD into Scheduling.tsx schedule grid

**Files:**
- Modify: `src/pages/Scheduling.tsx` (imports, DndContext wrapper, replace ShiftCard + td)
- Reference: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx:1-4` (DndContext pattern)

- [ ] **Step 1: Add imports to Scheduling.tsx**

Add to the imports at the top of `src/pages/Scheduling.tsx`:

```typescript
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useShiftCopyDnd } from '@/components/scheduling/useShiftCopyDnd';
import { DraggableShiftCard } from '@/components/scheduling/DraggableShiftCard';
import { DroppableDayCell } from '@/components/scheduling/DroppableDayCell';
import { ShiftDragOverlay } from '@/components/scheduling/ShiftDragOverlay';
import { AvailabilityConflictDialog } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';
```

- [ ] **Step 2: Initialize the hook in the Scheduling component**

Inside the `Scheduling` component (after the existing hooks around line 238-280), add:

```typescript
const {
  sensors,
  activeDragShift,
  highlightedCellId,
  conflictDialog,
  handleDragStart,
  handleDragEnd,
  handleDragCancel,
} = useShiftCopyDnd(restaurantTimezone);
```

- [ ] **Step 3: Wrap the schedule table in DndContext**

In the schedule `TabsContent` (around line 1035), wrap the `<table>` in `<DndContext>`:

Replace the `<div className="overflow-x-auto">` block containing the table with:

```typescript
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
>
  <div className="overflow-x-auto">
    <table className="w-full border-collapse min-w-[900px]">
      {/* ... existing thead ... */}
      {/* ... existing tbody ... */}
    </table>
  </div>
  <DragOverlay dropAnimation={null}>
    {activeDragShift && <ShiftDragOverlay shift={activeDragShift} />}
  </DragOverlay>
</DndContext>
```

- [ ] **Step 4: Replace day cell `<td>` with DroppableDayCell**

In the employee row mapping (around line 1123-1158), replace the `<td>` for each day cell with `DroppableDayCell`:

Replace:
```typescript
<td
  key={day.toISOString()}
  className={cn(
    "p-2 align-top transition-colors",
    dayIsToday && "bg-primary/5"
  )}
>
```

With:
```typescript
<DroppableDayCell
  key={day.toISOString()}
  employeeId={employee.id}
  day={format(day, 'yyyy-MM-dd')}
  isToday={dayIsToday}
  isHighlighted={highlightedCellId === `${employee.id}:${format(day, 'yyyy-MM-dd')}`}
>
```

And close with `</DroppableDayCell>` instead of `</td>`.

- [ ] **Step 5: Wrap each ShiftCard with DraggableShiftCard**

In the shift rendering loop (around line 1135-1141), wrap each `<ShiftCard>`:

Replace:
```typescript
{dayShifts.map((shift) => (
  <ShiftCard
    key={shift.id}
    shift={shift}
    onEdit={handleEditShift}
    onDelete={handleDeleteShift}
  />
))}
```

With:
```typescript
{dayShifts.map((shift) => (
  <DraggableShiftCard
    key={shift.id}
    shift={shift}
    employeeId={employee.id}
    day={format(day, 'yyyy-MM-dd')}
  >
    <ShiftCard
      shift={shift}
      onEdit={handleEditShift}
      onDelete={handleDeleteShift}
    />
  </DraggableShiftCard>
))}
```

- [ ] **Step 6: Add AvailabilityConflictDialog**

After the `DndContext` closing tag, add the conflict dialog:

```typescript
<AvailabilityConflictDialog
  open={conflictDialog.open}
  data={conflictDialog.data}
  timezone={restaurantTimezone}
  onConfirm={conflictDialog.onConfirm}
  onCancel={conflictDialog.onCancel}
/>
```

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds with no new type errors

- [ ] **Step 8: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat: wire drag-to-copy DnD into schedule grid view"
```

---

### Task 6: Manual smoke test + edge case verification

**Files:**
- Reference: `tests/unit/useShiftCopyDnd.test.ts` (run existing tests)

- [ ] **Step 1: Run all unit tests**

Run: `npm run test`
Expected: All tests pass including new useShiftCopyDnd tests

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors introduced

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build
