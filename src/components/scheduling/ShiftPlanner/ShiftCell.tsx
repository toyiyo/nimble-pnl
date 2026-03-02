import { memo } from 'react';

import { useDroppable } from '@dnd-kit/core';

import type { Shift } from '@/types/scheduling';

import { cn } from '@/lib/utils';

import { EmployeeChip } from './EmployeeChip';

const INACTIVE_STRIPE_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent, transparent 4px, hsl(var(--border) / 0.3) 4px, hsl(var(--border) / 0.3) 5px)',
} as const;

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
          className="min-h-[64px] p-1.5 opacity-60"
          style={INACTIVE_STRIPE_STYLE}
          aria-label={`${day} inactive`}
        />
      );
    }

    return (
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-[64px] p-1.5 space-y-1 transition-colors duration-500',
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
  },
  (prev, next) =>
    prev.templateId === next.templateId &&
    prev.day === next.day &&
    prev.isActiveDay === next.isActiveDay &&
    prev.shifts === next.shifts &&
    prev.onRemoveShift === next.onRemoveShift &&
    prev.isHighlighted === next.isHighlighted,
);
