import { CalendarOff, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SchedulingTimeOffCellContentProps {
  isOff: boolean;
  hasShift: boolean;
  children: React.ReactNode;
}

/**
 * Time-off treatment for a desktop schedule grid day cell (inside
 * `DroppableDayCell`). Off cells move off the info-blue onto a neutral
 * `.timeoff-hatch` + dashed `muted-foreground` border, with a compact
 * "Time off" pill on *every* off day (no `isRunStart` gate — see design doc
 * §2). A shift scheduled during approved time off (`isOff && hasShift`) is
 * flagged as a conflict: `.conflict-hatch` + `border-destructive` + a
 * destructive "Conflict" tag above the shift, instead of the "Time off" pill.
 */
export function SchedulingTimeOffCellContent({
  isOff,
  hasShift,
  children,
}: Readonly<SchedulingTimeOffCellContentProps>) {
  const isConflict = isOff && hasShift;
  return (
    <div
      className={cn(
        'space-y-1 md:space-y-1.5 min-h-[48px] md:min-h-[60px]',
        isConflict && 'conflict-hatch -m-1 md:-m-1.5 p-1 md:p-1.5 rounded-md border border-destructive',
        isOff && !hasShift && 'timeoff-hatch -m-1 md:-m-1.5 p-1 md:p-1.5 rounded-md border border-dashed border-muted-foreground/50',
      )}
    >
      {isOff && (
        <span className="sr-only">
          {hasShift ? 'Scheduling conflict: shift scheduled during approved time off' : 'Approved time off'}
        </span>
      )}
      {isConflict && (
        <div className="flex items-center gap-1 text-[11px] text-destructive font-medium">
          <Flag className="h-3 w-3" aria-hidden="true" />
          Conflict
        </div>
      )}
      {isOff && !hasShift && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
          <CalendarOff className="h-3 w-3" aria-hidden="true" />
          Time off
        </div>
      )}
      {children}
    </div>
  );
}
