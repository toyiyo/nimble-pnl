import { useState, useCallback } from 'react';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';

import { useCreateShift } from '@/hooks/useShifts';
import { checkConflictsImperative } from '@/hooks/useConflictDetection';
import type { Shift } from '@/types/scheduling';
import type { ConflictDialogData } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Return the local-timezone HH:MM of the given Date.
 * Uses getHours()/getMinutes() so the result is independent of any UTC offset.
 */
export function extractLocalTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface ShouldAllowDropParams {
  sourceEmployeeId: string;
  sourceDay: string;
  targetEmployeeId: string;
  targetDay: string;
}

/**
 * A drop is valid only when dragging to the SAME employee on a DIFFERENT day.
 */
export function shouldAllowDrop({
  sourceEmployeeId,
  sourceDay,
  targetEmployeeId,
  targetDay,
}: ShouldAllowDropParams): boolean {
  return sourceEmployeeId === targetEmployeeId && sourceDay !== targetDay;
}

type ShiftInput = Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>;

/**
 * Build the ShiftInput payload for a copy operation.
 *
 * Strategy (duration-based, handles overnight shifts correctly):
 *   1. Compute shift duration in ms from the source times.
 *   2. Build a new start by combining targetDay + source local start time.
 *   3. Derive new end = new start + duration.
 *
 * Always strips recurrence, resets status/locked/published.
 */
export function buildCopyPayload(shift: Shift, targetDay: string): ShiftInput {
  const srcStart = new Date(shift.start_time);
  const srcEnd = new Date(shift.end_time);
  const durationMs = srcEnd.getTime() - srcStart.getTime();

  // Parse targetDay parts (YYYY-MM-DD) — use local date parsing to avoid UTC shift
  const [year, month, day] = targetDay.split('-').map(Number);

  // New start: target date + original local time
  const newStart = new Date(
    year,
    month - 1,
    day,
    srcStart.getHours(),
    srcStart.getMinutes(),
    srcStart.getSeconds(),
    srcStart.getMilliseconds(),
  );

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
    published_at: null,
    published_by: null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseShiftCopyDndOptions {
  restaurantId: string;
  restaurantTimezone: string;
}

interface ConflictDialogState {
  open: boolean;
  data: ConflictDialogData | null;
}

export interface UseShiftCopyDndReturn {
  activeDragShift: Shift | null;
  conflictDialog: ConflictDialogState & {
    onConfirm: () => void;
    onCancel: () => void;
  };
  highlightedCellId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
  sensors: ReturnType<typeof useSensors>;
}

export function useShiftCopyDnd({
  restaurantTimezone,
}: UseShiftCopyDndOptions): UseShiftCopyDndReturn {
  const { mutate: executeCreate } = useCreateShift();

  const [activeDragShift, setActiveDragShift] = useState<Shift | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    open: false,
    data: null,
  });
  const [pendingPayload, setPendingPayload] = useState<ShiftInput | null>(null);
  const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const flashCell = useCallback((cellId: string) => {
    setHighlightedCellId(cellId);
    setTimeout(() => setHighlightedCellId(null), 600);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const shift = event.active.data.current?.shift as Shift | undefined;
    if (shift) setActiveDragShift(shift);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragShift(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragShift(null);

      const shift = event.active.data.current?.shift as Shift | undefined;
      if (!shift || !event.over) return;

      // Drop target ID format: "employeeId:YYYY-MM-DD"
      // Split on last colon to handle UUID employee IDs (which contain hyphens, not colons)
      const overId = String(event.over.id);
      const lastColon = overId.lastIndexOf(':');
      if (lastColon === -1) return;

      const targetEmployeeId = overId.slice(0, lastColon);
      const targetDay = overId.slice(lastColon + 1);

      // Derive sourceDay from the shift's start_time in local timezone
      const srcStart = new Date(shift.start_time);
      const sourceDay = `${srcStart.getFullYear()}-${String(srcStart.getMonth() + 1).padStart(2, '0')}-${String(srcStart.getDate()).padStart(2, '0')}`;

      if (
        !shouldAllowDrop({
          sourceEmployeeId: shift.employee_id,
          sourceDay,
          targetEmployeeId,
          targetDay,
        })
      ) {
        return;
      }

      const payload = buildCopyPayload(shift, targetDay);
      const cellId = `${targetEmployeeId}:${targetDay}`;

      // Check for conflicts before creating
      const { conflicts, hasConflicts } = await checkConflictsImperative({
        employeeId: shift.employee_id,
        restaurantId: shift.restaurant_id,
        startTime: payload.start_time,
        endTime: payload.end_time,
      });

      if (hasConflicts) {
        setPendingPayload(payload);
        setConflictDialog({
          open: true,
          data: {
            employeeName: shift.employee?.name ?? shift.employee_id,
            conflicts,
            warnings: [],
          },
        });
        return;
      }

      executeCreate(payload, {
        onSuccess: () => flashCell(cellId),
      });
    },
    [executeCreate, flashCell],
  );

  const handleConflictConfirm = useCallback(() => {
    if (!pendingPayload) return;
    const targetDay = pendingPayload.start_time.slice(0, 10); // YYYY-MM-DD from ISO
    const cellId = `${pendingPayload.employee_id}:${targetDay}`;
    setConflictDialog({ open: false, data: null });
    executeCreate(pendingPayload, {
      onSuccess: () => flashCell(cellId),
    });
    setPendingPayload(null);
  }, [pendingPayload, executeCreate, flashCell]);

  const handleConflictCancel = useCallback(() => {
    setConflictDialog({ open: false, data: null });
    setPendingPayload(null);
  }, []);

  return {
    activeDragShift,
    conflictDialog: {
      ...conflictDialog,
      onConfirm: handleConflictConfirm,
      onCancel: handleConflictCancel,
    },
    highlightedCellId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    sensors,
  };
}
