import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { Shift } from '@/types/scheduling';

interface DraggableShiftCardProps {
  shift: Shift;
  employeeId: string;
  day: string; // 'YYYY-MM-DD'
  children: React.ReactNode;
}

/**
 * Wraps a ShiftCard to make it draggable for copy-to-day.
 * Passes shift data to DnD context and applies drag styles.
 */
export function DraggableShiftCard({
  shift,
  employeeId,
  day,
  children,
}: Readonly<DraggableShiftCardProps>) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    data: { shift, employeeId, day },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      aria-roledescription="draggable shift"
    >
      {children}
    </div>
  );
}
