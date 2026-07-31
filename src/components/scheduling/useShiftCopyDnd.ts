import { useState, useCallback } from 'react';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';

import { useCreateShift } from '@/hooks/useShifts';
import { checkConflictsImperative } from '@/hooks/useConflictDetection';
import { ShiftInterval, formatLocalDateInTz, formatLocalHHMMInTz, localDayOffsetInTz } from '@/lib/shiftInterval';
import type { Shift } from '@/types/scheduling';
import type { ConflictDialogData } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export interface ShouldAllowDropParams {
  sourceEmployeeId: string;
  sourceDay: string;
  targetEmployeeId: string;
  targetDay: string;
}

/**
 * A drop is valid when dragging to a different day (same employee) or
 * to any cell of a different employee (same or different day).
 * Only rejected: same employee + same day (no-op).
 */
export function shouldAllowDrop({
  sourceEmployeeId,
  sourceDay,
  targetEmployeeId,
  targetDay,
}: ShouldAllowDropParams): boolean {
  if (sourceEmployeeId !== targetEmployeeId) return true;
  return sourceDay !== targetDay;
}

type ShiftInput = Omit<Shift, 'id' | 'created_at' | 'updated_at' | 'employee'>;

/**
 * Build the ShiftInput payload for a copy operation.
 *
 * Strategy (resolves start and end independently, handles overnight shifts
 * correctly, mirrors `copyWeekShifts.ts::reprojectOntoTargetWeek`):
 *   1. Read the source shift's RESTAURANT-LOCAL wall-clock start and end
 *      times.
 *   2. Read the source's restaurant-local end-day OFFSET — the number of
 *      calendar days its end falls past its start. The two wall clocks alone
 *      cannot express this: `ShiftInterval.create` would re-infer it from
 *      `endTime < startTime`, which only ever yields 0 or 1 and reads a
 *      Mon 09:00 -> Tue 17:00 shift as a same-day 8h one.
 *   3. Resolve the new start/end from targetDay + those wall clocks + that
 *      offset via `ShiftInterval.createSpanning`, which applies the same
 *      Postgres-parity DST logic the server uses, so this call site doesn't
 *      re-derive that logic independently.
 *
 * An earlier version derived the new end as `newStart + durationMs`, reusing
 * the source shift's raw elapsed-instant duration. That is wrong whenever
 * the *source* shift's own start–end interval crosses a DST transition: its
 * elapsed instant duration then differs from its wall-clock duration, and
 * the copy — even dropped on a day that itself doesn't cross a transition —
 * would inherit that skew. Resolving the end wall clock independently avoids
 * it, the same fix applied to `useShifts.tsx`'s recurring-shift generation.
 *
 * The version before that read `srcStart.getHours()`/`getMinutes()` — the
 * HOST's local wall clock — and rebuilt the target instant with the
 * host-local `Date` constructor. That self-corrects only when the host's
 * and restaurant's UTC offset happen to agree on both the source and target
 * days; it drifts by the offset gap otherwise, and specifically drifts
 * across a DST transition that the restaurant's zone crosses but the
 * host's doesn't (see design doc surface 6, mirrors Task 7's Copy Week fix).
 *
 * Always strips recurrence, resets status/locked/published.
 */
export function buildCopyPayload(shift: Shift, targetDay: string, tz: string, targetEmployeeId?: string): ShiftInput {
  const wallClockStart = formatLocalHHMMInTz(shift.start_time, tz);
  const wallClockEnd = formatLocalHHMMInTz(shift.end_time, tz);
  const endDayOffset = localDayOffsetInTz(shift.start_time, shift.end_time, tz);

  const interval = ShiftInterval.createSpanning(targetDay, wallClockStart, wallClockEnd, endDayOffset, tz);

  return {
    restaurant_id: shift.restaurant_id,
    employee_id: targetEmployeeId ?? shift.employee_id,
    start_time: interval.startAt.toISOString(),
    end_time: interval.endAt.toISOString(),
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
  } as any;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface ConflictDialogState {
  open: boolean;
  data: ConflictDialogData | null;
}

export interface UseShiftCopyDndOptions {
  /** Restaurant's IANA timezone — required so a copy anchors to the restaurant's wall clock, not the device's. */
  tz: string;
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

export function useShiftCopyDnd({ tz }: UseShiftCopyDndOptions): UseShiftCopyDndReturn {
  const { mutate: executeCreate } = useCreateShift();

  const [activeDragShift, setActiveDragShift] = useState<Shift | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    open: false,
    data: null,
  });
  const [pendingPayload, setPendingPayload] = useState<ShiftInput | null>(null);
  const [pendingCellId, setPendingCellId] = useState<string | null>(null);
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

      // Derive sourceDay from the shift's start_time in the RESTAURANT's timezone —
      // a host-local getter here would disagree with the restaurant-local `targetDay`
      // whenever the two zones' offsets differ, letting a same-day drag slip past
      // `shouldAllowDrop`'s no-op guard.
      const sourceDay = formatLocalDateInTz(new Date(shift.start_time), tz);

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

      const payload = buildCopyPayload(shift, targetDay, tz, targetEmployeeId);
      const cellId = `${targetEmployeeId}:${targetDay}`;

      // Check for conflicts before creating — validate against the TARGET employee
      try {
        const { conflicts, hasConflicts } = await checkConflictsImperative({
          employeeId: targetEmployeeId,
          restaurantId: shift.restaurant_id,
          startTime: payload.start_time,
          endTime: payload.end_time,
        });

        if (hasConflicts) {
          setPendingPayload(payload);
          setPendingCellId(cellId);
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
      } catch (err) {
        // If conflict check fails, proceed with creation (server will validate)
        console.warn('Conflict check failed, proceeding with shift copy:', err);
      }

      executeCreate(payload, {
        onSuccess: () => flashCell(cellId),
      });
    },
    [executeCreate, flashCell, tz],
  );

  const handleConflictConfirm = useCallback(() => {
    if (!pendingPayload) return;
    const cellId = pendingCellId;
    setConflictDialog({ open: false, data: null });
    executeCreate(pendingPayload, {
      onSuccess: () => { if (cellId) flashCell(cellId); },
    });
    setPendingPayload(null);
    setPendingCellId(null);
  }, [pendingPayload, pendingCellId, executeCreate, flashCell]);

  const handleConflictCancel = useCallback(() => {
    setConflictDialog({ open: false, data: null });
    setPendingPayload(null);
    setPendingCellId(null);
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
