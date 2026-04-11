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
  /** Mobile tap-to-assign: called when cell is tapped with an employee selected */
  onMobileTap?: (templateId: string, day: string) => void;
  /** Whether a mobile employee is selected (enables tap-to-assign visual) */
  hasMobileSelection?: boolean;
}

export const ShiftCell = memo(
  function ShiftCell({
    templateId,
    day,
    isActiveDay,
    shifts,
    onRemoveShift,
    isHighlighted,
    onMobileTap,
    hasMobileSelection,
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

    return (
      <div
        ref={setNodeRef}
        onClick={hasMobileSelection && onMobileTap ? () => onMobileTap(templateId, day) : undefined}
        className={cn(
          'min-h-[64px] p-1.5 space-y-1 transition-colors duration-500',
          'border-l-2 border-primary/40',
          isOver && 'bg-foreground/5 ring-1 ring-foreground/20 rounded',
          isHighlighted && 'bg-green-500/10',
          hasMobileSelection && 'bg-primary/5 ring-1 ring-primary/30 rounded cursor-pointer',
        )}
      >
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
      </div>
    );
  },
  (prev, next) =>
    prev.templateId === next.templateId &&
    prev.day === next.day &&
    prev.isActiveDay === next.isActiveDay &&
    prev.shifts === next.shifts &&
    prev.onRemoveShift === next.onRemoveShift &&
    prev.isHighlighted === next.isHighlighted &&
    prev.hasMobileSelection === next.hasMobileSelection &&
    prev.onMobileTap === next.onMobileTap,
);
