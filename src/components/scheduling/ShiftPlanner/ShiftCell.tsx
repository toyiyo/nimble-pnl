import { memo } from 'react';

import { useDroppable } from '@dnd-kit/core';

import type { Shift } from '@/types/scheduling';

import { cn } from '@/lib/utils';

import { EmployeeChip } from './EmployeeChip';

interface ShiftCellProps {
  templateId: string;
  day: string;
  isActiveDay: boolean;
  shifts: Shift[];
  onRemoveShift: (shiftId: string) => void;
  isHighlighted?: boolean;
}

export const ShiftCell = memo(
  function ShiftCell({
    templateId,
    day,
    isActiveDay,
    shifts,
    onRemoveShift,
    isHighlighted,
  }: ShiftCellProps) {
    const { isOver, setNodeRef } = useDroppable({
      id: `${templateId}:${day}`,
      data: { templateId, day },
      disabled: !isActiveDay,
    });

    if (!isActiveDay) {
      return (
        <div
          className="min-h-[64px] p-1.5 bg-muted/20 opacity-50"
          aria-label={`${day} inactive`}
        />
      );
    }

    return (
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-[64px] p-1.5 space-y-1 transition-colors duration-600',
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
  },
  (prev, next) =>
    prev.templateId === next.templateId &&
    prev.day === next.day &&
    prev.isActiveDay === next.isActiveDay &&
    prev.shifts === next.shifts &&
    prev.onRemoveShift === next.onRemoveShift &&
    prev.isHighlighted === next.isHighlighted,
);
