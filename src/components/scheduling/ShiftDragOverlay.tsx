import { format, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Shift } from '@/types/scheduling';

interface ShiftDragOverlayProps {
  shift: Shift;
}

/**
 * Floating ghost card rendered inside DragOverlay during shift drag-to-copy.
 * Shows time range + position for clear visual feedback.
 */
export function ShiftDragOverlay({ shift }: Readonly<ShiftDragOverlayProps>) {
  const start = parseISO(shift.start_time);
  const end = parseISO(shift.end_time);
  const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 px-3 py-2 cursor-grabbing min-w-[120px]',
        'bg-background shadow-lg ring-2 ring-foreground/20',
      )}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <span>
          {format(start, 'h:mm')}
          <span className="text-muted-foreground font-normal">{format(start, 'a').toLowerCase()}</span>
        </span>
        <span className="text-muted-foreground">–</span>
        <span>
          {format(end, 'h:mm')}
          <span className="text-muted-foreground font-normal">{format(end, 'a').toLowerCase()}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
        <Clock className="h-2.5 w-2.5" />
        <span>{durationHours.toFixed(1)}h</span>
        <span className="mx-0.5">·</span>
        <span>{shift.position}</span>
      </div>
    </div>
  );
}
