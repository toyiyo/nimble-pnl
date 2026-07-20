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
        'relative p-2 align-top transition-colors',
        // Raised tint + inset side hairlines bracket the today column into one
        // continuous vertical band from header to last row (paired with the
        // header cap rule in Scheduling.tsx).
        dayIsToday && 'bg-primary/[0.06] shadow-[inset_1px_0_0_hsl(var(--primary)/0.28),inset_-1px_0_0_hsl(var(--primary)/0.28)]',
        isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/30 rounded-lg',
        isHighlighted && 'bg-success/10 transition-colors duration-500',
      )}
    >
      {children}
    </td>
  );
}
