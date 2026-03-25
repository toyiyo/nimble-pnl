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
