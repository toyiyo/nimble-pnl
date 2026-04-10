# Schedule Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select to the schedule view so users can bulk delete and bulk edit shifts.

**Architecture:** Selection mode is a toggle in the toolbar. When active, shift clicks toggle selection (stored as `Set<string>`), DnD is disabled, and a floating action bar shows Edit/Delete actions. Row/column select via employee name and day header clicks. A new `useBulkShiftActions` hook wraps individual mutations with locked-shift filtering.

**Tech Stack:** React state (`useState`), existing `BulkActionBar` component, existing `useDeleteShift`/`useUpdateShift` hooks, `Promise.allSettled` for batch operations.

**Design doc:** `docs/plans/2026-04-07-schedule-multi-select-design.md`

---

### Task 1: useBulkShiftActions Hook

**Files:**
- Create: `src/hooks/useBulkShiftActions.ts`
- Create: `tests/unit/useBulkShiftActions.test.ts`

- [ ] **Step 1: Write failing tests for bulkDelete**

```typescript
// tests/unit/useBulkShiftActions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkShiftActions } from '@/hooks/useBulkShiftActions';

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
        in: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({ error: null })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => ({ data: {}, error: null })),
          })),
        })),
      })),
    })),
  },
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useBulkShiftActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out locked shifts from bulk delete', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const selectMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [
          { id: 's1', locked: false },
          { id: 's2', locked: true },
          { id: 's3', locked: false },
        ],
        error: null,
      }),
    });
    vi.mocked(supabase.from).mockReturnValue({
      select: selectMock,
      delete: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as any);

    const { result } = renderHook(
      () => useBulkShiftActions('restaurant-1'),
      { wrapper: createWrapper() },
    );

    let outcome: any;
    await act(async () => {
      outcome = await result.current.bulkDelete(['s1', 's2', 's3']);
    });

    expect(outcome.deletedCount).toBe(2);
    expect(outcome.lockedCount).toBe(1);
  });

  it('returns zero counts when all shifts are locked', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            { id: 's1', locked: true },
            { id: 's2', locked: true },
          ],
          error: null,
        }),
      }),
      delete: vi.fn(),
    } as any);

    const { result } = renderHook(
      () => useBulkShiftActions('restaurant-1'),
      { wrapper: createWrapper() },
    );

    let outcome: any;
    await act(async () => {
      outcome = await result.current.bulkDelete(['s1', 's2']);
    });

    expect(outcome.deletedCount).toBe(0);
    expect(outcome.lockedCount).toBe(2);
  });

  it('filters locked shifts from bulk edit and applies changes', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const updateInMock = vi.fn().mockResolvedValue({ data: [{}, {}], error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            { id: 's1', locked: false },
            { id: 's2', locked: true },
            { id: 's3', locked: false },
          ],
          error: null,
        }),
      }),
      update: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{}, {}], error: null }),
        }),
      }),
    } as any);

    const { result } = renderHook(
      () => useBulkShiftActions('restaurant-1'),
      { wrapper: createWrapper() },
    );

    let outcome: any;
    await act(async () => {
      outcome = await result.current.bulkEdit(['s1', 's2', 's3'], { position: 'Bartender' });
    });

    expect(outcome.updatedCount).toBe(2);
    expect(outcome.lockedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useBulkShiftActions.test.ts`
Expected: FAIL — module `@/hooks/useBulkShiftActions` not found

- [ ] **Step 3: Implement useBulkShiftActions hook**

```typescript
// src/hooks/useBulkShiftActions.ts
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BulkDeleteResult {
  deletedCount: number;
  lockedCount: number;
}

interface BulkEditResult {
  updatedCount: number;
  lockedCount: number;
}

export function useBulkShiftActions(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  async function getLockedStatus(shiftIds: string[]): Promise<{ unlocked: string[]; lockedCount: number }> {
    const { data, error } = await supabase
      .from('shifts')
      .select('id, locked')
      .in('id', shiftIds);

    if (error) throw error;

    const locked = data.filter((s) => s.locked);
    const unlocked = data.filter((s) => !s.locked).map((s) => s.id);
    return { unlocked, lockedCount: locked.length };
  }

  async function bulkDelete(shiftIds: string[]): Promise<BulkDeleteResult> {
    const { unlocked, lockedCount } = await getLockedStatus(shiftIds);

    if (unlocked.length > 0) {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .in('id', unlocked);

      if (error) throw error;
    }

    if (unlocked.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
    }

    const deletedCount = unlocked.length;

    if (deletedCount > 0 && lockedCount > 0) {
      toast({
        title: `${deletedCount} shift${deletedCount !== 1 ? 's' : ''} deleted`,
        description: `${lockedCount} locked shift${lockedCount !== 1 ? 's' : ''} skipped.`,
      });
    } else if (deletedCount > 0) {
      toast({
        title: `${deletedCount} shift${deletedCount !== 1 ? 's' : ''} deleted`,
      });
    } else {
      toast({
        title: 'No shifts deleted',
        description: 'All selected shifts are locked (published).',
        variant: 'destructive',
      });
    }

    return { deletedCount, lockedCount };
  }

  async function bulkEdit(
    shiftIds: string[],
    changes: Record<string, unknown>,
  ): Promise<BulkEditResult> {
    const { unlocked, lockedCount } = await getLockedStatus(shiftIds);

    if (unlocked.length > 0) {
      const { error } = await supabase
        .from('shifts')
        .update(changes)
        .in('id', unlocked);

      if (error) throw error;
    }

    if (unlocked.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
    }

    const updatedCount = unlocked.length;

    if (updatedCount > 0 && lockedCount > 0) {
      toast({
        title: `${updatedCount} shift${updatedCount !== 1 ? 's' : ''} updated`,
        description: `${lockedCount} locked shift${lockedCount !== 1 ? 's' : ''} skipped.`,
      });
    } else if (updatedCount > 0) {
      toast({
        title: `${updatedCount} shift${updatedCount !== 1 ? 's' : ''} updated`,
      });
    } else {
      toast({
        title: 'No shifts updated',
        description: 'All selected shifts are locked (published).',
        variant: 'destructive',
      });
    }

    return { updatedCount, lockedCount };
  }

  return { bulkDelete, bulkEdit };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useBulkShiftActions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBulkShiftActions.ts tests/unit/useBulkShiftActions.test.ts
git commit -m "feat(schedule): add useBulkShiftActions hook for bulk delete/edit with locked-shift filtering"
```

---

### Task 2: BulkEditShiftsDialog Component

**Files:**
- Create: `src/components/scheduling/BulkEditShiftsDialog.tsx`
- Create: `tests/unit/BulkEditShiftsDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/BulkEditShiftsDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BulkEditShiftsDialog } from '@/components/scheduling/BulkEditShiftsDialog';

describe('BulkEditShiftsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    selectedCount: 3,
    onConfirm: vi.fn(),
    isUpdating: false,
    positions: ['Server', 'Bartender', 'Cook', 'Host'],
    areas: ['Main Floor', 'Patio', 'Bar'],
  };

  it('renders with selected count in title', () => {
    render(<BulkEditShiftsDialog {...defaultProps} />);
    expect(screen.getByText('Edit 3 Shifts')).toBeTruthy();
  });

  it('shows "No change" placeholder for all fields initially', () => {
    render(<BulkEditShiftsDialog {...defaultProps} />);
    // All selects should show placeholder state
    expect(screen.getByText('Only changed fields will be applied')).toBeTruthy();
  });

  it('calls onConfirm with only changed fields', async () => {
    render(<BulkEditShiftsDialog {...defaultProps} />);

    // Change position
    const positionSelect = screen.getByLabelText('Position');
    fireEvent.click(positionSelect);
    const bartenderOption = await screen.findByText('Bartender');
    fireEvent.click(bartenderOption);

    // Submit
    fireEvent.click(screen.getByText('Apply to 3 Shifts'));

    expect(defaultProps.onConfirm).toHaveBeenCalledWith({ position: 'Bartender' });
  });

  it('disables submit when no changes made', () => {
    render(<BulkEditShiftsDialog {...defaultProps} />);
    const submitButton = screen.getByText('Apply to 3 Shifts');
    expect(submitButton).toBeDisabled();
  });

  it('shows loading state when isUpdating', () => {
    render(<BulkEditShiftsDialog {...defaultProps} isUpdating={true} />);
    expect(screen.getByText('Updating...')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/BulkEditShiftsDialog.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement BulkEditShiftsDialog**

```typescript
// src/components/scheduling/BulkEditShiftsDialog.tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pencil } from 'lucide-react';
import { useState, useCallback } from 'react';

const NO_CHANGE = '__no_change__';

interface BulkEditShiftsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectedCount: number;
  readonly onConfirm: (changes: Record<string, unknown>) => void;
  readonly isUpdating: boolean;
  readonly positions: string[];
  readonly areas: string[];
}

export function BulkEditShiftsDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isUpdating,
  positions,
  areas,
}: BulkEditShiftsDialogProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [position, setPosition] = useState(NO_CHANGE);
  const [area, setArea] = useState(NO_CHANGE);

  const hasChanges = startTime !== '' || endTime !== '' || position !== NO_CHANGE || area !== NO_CHANGE;

  const handleSubmit = useCallback(() => {
    const changes: Record<string, unknown> = {};
    if (startTime !== '') changes.start_time = startTime;
    if (endTime !== '') changes.end_time = endTime;
    if (position !== NO_CHANGE) changes.position = position;
    if (area !== NO_CHANGE) changes.area_id = area;
    onConfirm(changes);
  }, [startTime, endTime, position, area, onConfirm]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setStartTime('');
        setEndTime('');
        setPosition(NO_CHANGE);
        setArea(NO_CHANGE);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Pencil className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Edit {selectedCount} Shift{selectedCount !== 1 ? 's' : ''}
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Only changed fields will be applied
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Start Time */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Start Time
            </Label>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="— No change —"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
            />
          </div>

          {/* End Time */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              End Time
            </Label>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="— No change —"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
            />
          </div>

          {/* Position */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Position
            </Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger
                aria-label="Position"
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              >
                <SelectValue placeholder="— No change —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANGE}>— No change —</SelectItem>
                {positions.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Area */}
          {areas.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Area
              </Label>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger
                  aria-label="Area"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                >
                  <SelectValue placeholder="— No change —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>— No change —</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!hasChanges || isUpdating}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {isUpdating ? 'Updating...' : `Apply to ${selectedCount} Shift${selectedCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/BulkEditShiftsDialog.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/BulkEditShiftsDialog.tsx tests/unit/BulkEditShiftsDialog.test.tsx
git commit -m "feat(schedule): add BulkEditShiftsDialog with optional-field editing"
```

---

### Task 3: Selection Mode State & Toolbar Toggle

**Files:**
- Modify: `src/pages/Scheduling.tsx`

This task adds the selection state management and the "Select" toggle button to the toolbar. No visual changes to the grid yet.

- [ ] **Step 1: Add selection mode state variables**

Add after line 301 (after `recurringActionDialog` state) in `Scheduling.tsx`:

```typescript
// Multi-select state
const [selectionMode, setSelectionMode] = useState(false);
const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
const [isBulkOperating, setIsBulkOperating] = useState(false);
```

- [ ] **Step 2: Add selection helper functions**

Add after the new state variables:

```typescript
// Selection helpers
const toggleShiftSelection = useCallback((shiftId: string) => {
  setSelectedShiftIds((prev) => {
    const next = new Set(prev);
    if (next.has(shiftId)) {
      next.delete(shiftId);
    } else {
      next.add(shiftId);
    }
    return next;
  });
}, []);

const selectShiftsForEmployee = useCallback((employeeId: string) => {
  const employeeShifts = shifts.filter((s) => s.employee_id === employeeId);
  setSelectedShiftIds((prev) => {
    const allSelected = employeeShifts.every((s) => prev.has(s.id));
    const next = new Set(prev);
    if (allSelected) {
      employeeShifts.forEach((s) => next.delete(s.id));
    } else {
      employeeShifts.forEach((s) => next.add(s.id));
    }
    return next;
  });
}, [shifts]);

const selectShiftsForDay = useCallback((dayStr: string) => {
  const dayShifts = shifts.filter((s) => {
    const shiftDate = new Date(s.start_time);
    const d = `${shiftDate.getFullYear()}-${String(shiftDate.getMonth() + 1).padStart(2, '0')}-${String(shiftDate.getDate()).padStart(2, '0')}`;
    return d === dayStr;
  });
  setSelectedShiftIds((prev) => {
    const allSelected = dayShifts.every((s) => prev.has(s.id));
    const next = new Set(prev);
    if (allSelected) {
      dayShifts.forEach((s) => next.delete(s.id));
    } else {
      dayShifts.forEach((s) => next.add(s.id));
    }
    return next;
  });
}, [shifts]);

const clearSelection = useCallback(() => {
  setSelectedShiftIds(new Set());
}, []);

const exitSelectionMode = useCallback(() => {
  setSelectionMode(false);
  setSelectedShiftIds(new Set());
}, []);
```

- [ ] **Step 3: Add "Select" toggle button to toolbar**

In the toolbar actions div (around line 947), add the Select toggle button before the position filter. Insert before line 948 (`{/* Position filter */}`):

```typescript
{/* Select mode toggle */}
<Button
  variant={selectionMode ? 'default' : 'outline'}
  size="sm"
  onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
  className={cn(
    'h-9 text-xs',
    selectionMode && 'bg-foreground text-background hover:bg-foreground/90',
  )}
  aria-label={selectionMode ? 'Exit selection mode' : 'Enter selection mode'}
  aria-pressed={selectionMode}
>
  <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
  {selectionMode ? 'Done' : 'Select'}
</Button>

<div className="h-6 w-px bg-border hidden sm:block" />
```

- [ ] **Step 4: Add CheckSquare import**

Add `CheckSquare` to the lucide-react import at the top of the file (find the existing `import { ... } from 'lucide-react'` line).

- [ ] **Step 5: Clear selection on week change**

In `handlePreviousWeek` and `handleNextWeek` (around lines 436-446), add `clearSelection()` at the end of each handler. Also clear on `handleToday`.

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors in Scheduling.tsx

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(schedule): add selection mode state and toolbar toggle"
```

---

### Task 4: Wire Selection Into Grid (ShiftCard, Row, Column)

**Files:**
- Modify: `src/pages/Scheduling.tsx` (ShiftCard component + grid rendering)

- [ ] **Step 1: Update ShiftCard props and rendering**

Update the `ShiftCardProps` type (line 132-136) to accept selection props:

```typescript
type ShiftCardProps = {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (shiftId: string) => void;
};
```

In the ShiftCard component body, update the click handler on the main card div (around line 173). Replace the existing `onClick` that opens edit with:

```typescript
onClick={(e) => {
  if (selectionMode && onToggleSelect) {
    e.stopPropagation();
    onToggleSelect(shift.id);
  } else {
    onEdit(shift);
  }
}}
```

Add selected visual state to the card's className (around line 173-180). Add to the existing `cn(...)`:

```typescript
isSelected && 'ring-2 ring-primary bg-primary/10',
selectionMode && 'cursor-pointer',
```

Add a checkbox indicator inside the card when in selection mode. At the beginning of the card content (line ~182), add:

```typescript
{selectionMode && (
  <div className={cn(
    'absolute top-1 right-1 h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors',
    isSelected
      ? 'bg-primary border-primary text-primary-foreground'
      : 'border-muted-foreground/40 bg-background',
  )}>
    {isSelected && <Check className="h-2.5 w-2.5" />}
  </div>
)}
```

Add `relative` to the main card div className so the absolute checkbox positions correctly. Add `Check` to the lucide-react imports.

- [ ] **Step 2: Pass selection props to ShiftCard in the grid**

Find where `<ShiftCard>` is rendered inside `<DraggableShiftCard>` (around lines 1309-1320). Update to:

```typescript
{dayShifts.map((shift) => {
  const shiftCard = (
    <ShiftCard
      shift={shift}
      onEdit={handleEditShift}
      onDelete={handleDeleteShift}
      isSelected={selectedShiftIds.has(shift.id)}
      selectionMode={selectionMode}
      onToggleSelect={toggleShiftSelection}
    />
  );

  if (selectionMode) {
    // In selection mode, no DnD wrapper — just the card
    return <div key={shift.id}>{shiftCard}</div>;
  }

  return (
    <DraggableShiftCard
      key={shift.id}
      shift={shift}
      employeeId={employee.id}
      day={format(day, 'yyyy-MM-dd')}
    >
      {shiftCard}
    </DraggableShiftCard>
  );
})}
```

- [ ] **Step 3: Add row select to employee name cells**

In the employee name cell (around line 1220), add a click handler to the employee name text. Wrap the employee name in a clickable element when in selection mode:

```typescript
{selectionMode ? (
  <button
    type="button"
    onClick={() => selectShiftsForEmployee(employee.id)}
    className="font-medium text-sm flex items-center gap-2 text-primary hover:underline cursor-pointer"
    aria-label={`Select all shifts for ${employee.name}`}
  >
    {employee.name}
    {!employee.is_active && (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
    )}
  </button>
) : (
  <div className="font-medium text-sm flex items-center gap-2">
    {employee.name}
    {!employee.is_active && (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
    )}
  </div>
)}
```

- [ ] **Step 4: Add column select to day headers**

In the table header (around lines 1132-1166), update the day header `<th>` content to be clickable when in selection mode. Inside the `weekDays.map((day) => ...)`:

```typescript
{selectionMode ? (
  <button
    type="button"
    onClick={() => selectShiftsForDay(format(day, 'yyyy-MM-dd'))}
    className="w-full text-center text-primary hover:underline cursor-pointer"
    aria-label={`Select all shifts for ${format(day, 'EEEE')}`}
  >
    <span className="text-[11px] md:text-xs font-medium block">
      {format(day, 'EEE')}
    </span>
    <span className={cn('text-sm md:text-base font-semibold', dayIsToday && 'text-primary')}>
      {format(day, 'd')}
    </span>
  </button>
) : (
  // existing day header content
)}
```

- [ ] **Step 5: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(schedule): wire selection mode into shift cards, row headers, and column headers"
```

---

### Task 5: Bulk Action Bar & Delete Confirmation

**Files:**
- Modify: `src/pages/Scheduling.tsx`

- [ ] **Step 1: Import components and hook**

Add imports at the top of `Scheduling.tsx`:

```typescript
import { BulkActionBar } from '@/components/bulk-edit/BulkActionBar';
import { BulkEditShiftsDialog } from '@/components/scheduling/BulkEditShiftsDialog';
import { useBulkShiftActions } from '@/hooks/useBulkShiftActions';
import { Trash2 } from 'lucide-react';
```

- [ ] **Step 2: Initialize the bulk actions hook**

Add after the existing hook calls (near line 310, after `const deleteShift = useDeleteShift();`):

```typescript
const { bulkDelete, bulkEdit } = useBulkShiftActions(restaurantId);
```

- [ ] **Step 3: Add bulk action handlers**

Add after the selection helpers:

```typescript
const handleBulkDelete = useCallback(async () => {
  setIsBulkOperating(true);
  try {
    await bulkDelete(Array.from(selectedShiftIds));
    clearSelection();
    setBulkDeleteDialogOpen(false);
  } finally {
    setIsBulkOperating(false);
  }
}, [selectedShiftIds, bulkDelete, clearSelection]);

const handleBulkEdit = useCallback(async (changes: Record<string, unknown>) => {
  setIsBulkOperating(true);
  try {
    await bulkEdit(Array.from(selectedShiftIds), changes);
    clearSelection();
    setBulkEditDialogOpen(false);
  } finally {
    setIsBulkOperating(false);
  }
}, [selectedShiftIds, bulkEdit, clearSelection]);
```

- [ ] **Step 4: Add BulkActionBar to JSX**

Add after the DndContext closing tag (after the table and DragOverlay), inside the CardContent:

```typescript
{/* Bulk Action Bar */}
{selectionMode && selectedShiftIds.size > 0 && (
  <BulkActionBar
    selectedCount={selectedShiftIds.size}
    onClose={clearSelection}
    actions={[
      {
        label: 'Edit',
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => setBulkEditDialogOpen(true),
      },
      {
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => setBulkDeleteDialogOpen(true),
        variant: 'destructive' as const,
      },
    ]}
  />
)}
```

- [ ] **Step 5: Add Bulk Delete Confirmation Dialog**

Add near the other dialogs at the bottom of the component JSX (before the final closing tags):

```typescript
{/* Bulk Delete Confirmation */}
<AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>
        Delete {selectedShiftIds.size} shift{selectedShiftIds.size !== 1 ? 's' : ''}?
      </AlertDialogTitle>
      <AlertDialogDescription className="space-y-2">
        <p>This action cannot be undone.</p>
        {Array.from(selectedShiftIds).some((id) => shifts.find((s) => s.id === id)?.locked) && (
          <p className="text-amber-500 font-medium">
            Locked shifts (published) will be skipped.
          </p>
        )}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={isBulkOperating}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={handleBulkDelete}
        disabled={isBulkOperating}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {isBulkOperating ? 'Deleting...' : 'Delete'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 6: Add Bulk Edit Dialog**

Add near the other dialogs:

```typescript
{/* Bulk Edit Dialog */}
<BulkEditShiftsDialog
  open={bulkEditDialogOpen}
  onOpenChange={setBulkEditDialogOpen}
  selectedCount={selectedShiftIds.size}
  onConfirm={handleBulkEdit}
  isUpdating={isBulkOperating}
  positions={positions}
  areas={areas?.map((a: { id: string; name: string }) => a.name) || []}
/>
```

- [ ] **Step 7: Add AlertDialog imports if not already present**

Ensure `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle` are imported from `@/components/ui/alert-dialog`. Also add `Pencil` to lucide-react imports if not already there.

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 9: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(schedule): wire bulk action bar, delete confirmation, and edit dialog into schedule view"
```

---

### Task 6: E2E Test — Multi-Select Flow

**Files:**
- Create: `tests/e2e/schedule-multi-select.spec.ts`

- [ ] **Step 1: Write E2E test for selection mode and bulk delete**

```typescript
// tests/e2e/schedule-multi-select.spec.ts
import { test, expect } from '@playwright/test';
import {
  signUpAndOnboard,
  generateTestUser,
  createEmployee,
  createShift,
} from '../helpers/e2e-supabase';
import { addDays, startOfWeek, format } from 'date-fns';

test.describe('Schedule Multi-Select', () => {
  let page: any;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    const testUser = generateTestUser();
    const { restaurantId } = await signUpAndOnboard(page, testUser);

    // Create 2 employees with shifts
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });

    const emp1 = await createEmployee(restaurantId, {
      name: 'Alice Test',
      position: 'Server',
    });
    const emp2 = await createEmployee(restaurantId, {
      name: 'Bob Test',
      position: 'Cook',
    });

    // Create shifts for Mon and Tue
    for (const emp of [emp1, emp2]) {
      for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
        const day = addDays(monday, dayOffset);
        await createShift(restaurantId, {
          employee_id: emp.id,
          start_time: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8, 0, 0).toISOString(),
          end_time: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 16, 0, 0).toISOString(),
          position: emp.position,
        });
      }
    }

    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
  });

  test('can enter selection mode and select shifts', async () => {
    // Enter selection mode
    await page.getByRole('button', { name: 'Enter selection mode' }).click();

    // Verify toolbar shows "Done" button
    await expect(page.getByRole('button', { name: 'Exit selection mode' })).toBeVisible();

    // Click a shift card to select it
    const shiftCards = page.locator('[data-testid="shift-card"]');
    await shiftCards.first().click();

    // Bulk action bar should appear
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible();
    await expect(page.getByText('1 selected')).toBeVisible();
  });

  test('can bulk delete selected shifts', async () => {
    await page.getByRole('button', { name: 'Enter selection mode' }).click();

    // Select two shifts
    const shiftCards = page.locator('[data-testid="shift-card"]');
    await shiftCards.nth(0).click();
    await shiftCards.nth(1).click();

    await expect(page.getByText('2 selected')).toBeVisible();

    // Click delete
    await page.getByRole('button', { name: 'Delete' }).click();

    // Confirm
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // Should show success toast
    await expect(page.getByText(/shift.*deleted/i)).toBeVisible({ timeout: 5000 });
  });

  test('can exit selection mode with Done button', async () => {
    await page.getByRole('button', { name: 'Enter selection mode' }).click();

    // Select a shift
    const shiftCards = page.locator('[data-testid="shift-card"]');
    await shiftCards.first().click();

    // Exit selection mode
    await page.getByRole('button', { name: 'Exit selection mode' }).click();

    // Action bar should be gone
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Add `data-testid="shift-card"` to ShiftCard**

In `Scheduling.tsx`, add `data-testid="shift-card"` to the main div of the ShiftCard component (the outermost div around line 173).

- [ ] **Step 3: Run E2E tests**

Run: `npx playwright test tests/e2e/schedule-multi-select.spec.ts`
Expected: Tests should pass if the full feature is wired up correctly

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/schedule-multi-select.spec.ts src/pages/Scheduling.tsx
git commit -m "test(schedule): add E2E tests for multi-select flow"
```

---

### Task 7: Handle Edge Cases & Polish

**Files:**
- Modify: `src/pages/Scheduling.tsx`
- Modify: `src/hooks/useBulkShiftActions.ts`

- [ ] **Step 1: Disable add-shift buttons in selection mode**

Find the "+" Add Shift button in each grid cell (the small add button inside `DroppableDayCell`). Hide it when `selectionMode` is true:

```typescript
{!selectionMode && (
  <button
    onClick={() => handleAddShift(employee, day)}
    className="..."
  >
    <Plus className="h-3 w-3" />
  </button>
)}
```

- [ ] **Step 2: Clear selection when week changes**

Verify that `clearSelection()` is called in `handlePreviousWeek`, `handleNextWeek`, and `handleToday`. If not already done in Task 3, add it now.

- [ ] **Step 3: Clear selection after successful publish/unpublish**

In the publish/unpublish success callbacks, add `clearSelection()` since locked status changes.

- [ ] **Step 4: Verify build and lint**

Run: `npm run build && npm run lint 2>&1 | tail -20`
Expected: Build succeeds, no new lint errors in changed files

- [ ] **Step 5: Commit**

```bash
git add src/pages/Scheduling.tsx src/hooks/useBulkShiftActions.ts
git commit -m "fix(schedule): handle edge cases — disable add-shift in selection mode, clear selection on week/publish changes"
```
