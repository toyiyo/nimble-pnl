import { memo } from 'react';

import { useDroppable } from '@dnd-kit/core';

import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EmptyCellProps {
  employeeId: string;
  employeeName?: string;
  day: string;
  onClickCreate: (employeeId: string, day: string) => void;
}

/** Format YYYY-MM-DD as a readable date like "Mon, Feb 28". */
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const EmptyCell = memo(function EmptyCell({
  employeeId,
  employeeName,
  day,
  onClickCreate,
}: EmptyCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${employeeId}:${day}`,
    data: { employeeId, day },
  });

  const label = employeeName
    ? `Add shift for ${employeeName} on ${formatDayLabel(day)}`
    : `Add shift on ${formatDayLabel(day)}`;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClickCreate(employeeId, day)}
      aria-label={label}
      className={cn(
        'group w-full h-full min-h-[48px] rounded-lg border border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'hover:border-border/40 hover:bg-muted/30',
        isOver && 'border-foreground/30 bg-foreground/5',
      )}
    >
      <Plus
        className={cn(
          'h-4 w-4 mx-auto text-muted-foreground/40 transition-opacity',
          'opacity-0 group-hover:opacity-100',
          isOver && 'opacity-100 text-foreground/40',
        )}
      />
    </button>
  );
});
