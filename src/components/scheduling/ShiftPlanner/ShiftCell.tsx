import { memo } from 'react';

import { useDroppable } from '@dnd-kit/core';

import { classifyCapacity } from '@/lib/openShiftHelpers';
import type { Shift } from '@/types/scheduling';
import type { AllocationStatus } from '@/lib/shiftAllocation';

import { cn } from '@/lib/utils';

import { EmployeeChip } from './EmployeeChip';

interface ShiftCellProps {
  templateId: string;
  day: string;
  isActiveDay: boolean;
  shifts: Shift[];
  capacity: number;
  onRemoveShift: (shiftId: string) => void;
  isHighlighted?: boolean;
  /** Mobile tap-to-assign: called when cell is tapped with an employee selected */
  onMobileTap?: (templateId: string, day: string) => void;
  /** Whether a mobile employee is selected (enables tap-to-assign visual) */
  hasMobileSelection?: boolean;
  allocationStatus?: AllocationStatus;
  pickedEmployeeName?: string;
}

export const ShiftCell = memo(
  function ShiftCell({
    templateId,
    day,
    isActiveDay,
    shifts,
    capacity,
    onRemoveShift,
    isHighlighted,
    onMobileTap,
    hasMobileSelection,
    allocationStatus,
    pickedEmployeeName,
  }: ShiftCellProps) {
    const { isOver, setNodeRef } = useDroppable({
      id: `${templateId}:${day}`,
      data: { templateId, day },
      disabled: !isActiveDay,
    });

    if (!isActiveDay) {
      return (
        <div
          className="min-h-[64px] p-1.5 opacity-60 bg-hatched-inactive"
          aria-label={`${day} inactive`}
        />
      );
    }

    const overlayClass = cn(
      allocationStatus === 'highlight' && 'outline outline-2 outline-primary bg-primary/5',
      allocationStatus === 'conflict' && 'outline outline-2 outline-destructive bg-destructive/10',
      allocationStatus === 'available' && 'bg-primary/5',
    );

    return (
      <div
        ref={setNodeRef}
        onClick={hasMobileSelection && onMobileTap ? () => onMobileTap(templateId, day) : undefined}
        data-allocation-status={allocationStatus ?? 'none'}
        className={cn(
          'min-h-[64px] p-1.5 space-y-1 transition-colors duration-200 relative',
          'border-l-2 border-primary/40',
          isOver && 'bg-foreground/5 ring-1 ring-foreground/20 rounded',
          isHighlighted && 'bg-green-500/10',
          hasMobileSelection && 'bg-primary/5 ring-1 ring-primary/30 rounded cursor-pointer',
          overlayClass,
        )}
      >
        {allocationStatus === 'highlight' && pickedEmployeeName && (
          <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground pointer-events-none">
            {pickedEmployeeName}
          </div>
        )}
        {allocationStatus === 'conflict' && (
          <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground pointer-events-none">
            Conflicts
          </div>
        )}
        {shifts.map((shift) => (
          <EmployeeChip
            key={shift.id}
            shiftId={shift.id}
            employeeName={shift.employee?.name ?? 'Unassigned'}
            position={shift.position}
            source={shift.source}
            onRemove={onRemoveShift}
          />
        ))}
        {capacity > 1 && (() => {
          const status = classifyCapacity(capacity, shifts.length);
          return (
            <div
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded text-center',
                status === 'full'
                  ? 'text-emerald-600 bg-emerald-500/10'
                  : status === 'partial'
                    ? 'text-amber-600 bg-amber-500/10'
                    : 'text-red-500 bg-red-500/10',
              )}
            >
              {shifts.length}/{capacity}
            </div>
          );
        })()}
      </div>
    );
  },
  (prev, next) =>
    prev.templateId === next.templateId &&
    prev.day === next.day &&
    prev.isActiveDay === next.isActiveDay &&
    prev.shifts === next.shifts &&
    prev.capacity === next.capacity &&
    prev.onRemoveShift === next.onRemoveShift &&
    prev.isHighlighted === next.isHighlighted &&
    prev.hasMobileSelection === next.hasMobileSelection &&
    prev.onMobileTap === next.onMobileTap &&
    prev.allocationStatus === next.allocationStatus &&
    prev.pickedEmployeeName === next.pickedEmployeeName,
);
