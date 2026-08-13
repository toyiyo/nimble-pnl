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
      // dnd-kit's `attributes` sets `role="button"` on this wrapper, with no
      // name of its own. With no aria-label, the browser builds the name
      // from content. That name then includes every nested button's
      // aria-label: Edit shift, Offer shift for trade, Delete shift.
      // Playwright's `getByRole('button', { name: /offer shift for trade/i })`
      // matched this wrapper too, and the wrapper comes first in DOM order.
      // `.first()` picked the wrapper, so the click landed on the card body
      // and opened Edit Shift, not the real Offer button. This aria-label
      // gives the wrapper its own name and stops that fallback.
      aria-label="Drag shift to copy"
    >
      {children}
    </div>
  );
}
