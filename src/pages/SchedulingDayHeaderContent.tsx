import { format } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * 3px `primary` cap rule for the today column's header `<th>`, paired with
 * DroppableDayCell's inset side hairlines so the today column reads as one
 * continuous vertical band from header to last row. See design doc §1
 * "Today" highlight (desktop grid).
 */
export const TODAY_HEADER_CAP_RULE_CLASS = 'shadow-[inset_0_3px_0_hsl(var(--primary))]';

interface ScheduleDayHeaderContentProps {
  day: Date;
  isToday: boolean;
  /** True in `selectionMode`, where the whole cell is already an emphasized button. */
  emphasize?: boolean;
}

/**
 * Weekday label + date for a schedule grid day-column header. On the today
 * column, the day number renders in a filled `primary` circle and a small
 * "Today" badge appears below — two of the three redundant "today" cues
 * (the third, the header cap rule, is applied by the caller via
 * `TODAY_HEADER_CAP_RULE_CLASS`). Shared between the plain header and the
 * `selectionMode` button variant so both stay in sync.
 */
export function ScheduleDayHeaderContent({ day, isToday: dayIsToday, emphasize = false }: Readonly<ScheduleDayHeaderContentProps>) {
  return (
    <>
      <div
        className={cn(
          'text-xs uppercase tracking-wider',
          (emphasize || dayIsToday) && 'font-semibold',
          dayIsToday ? 'text-primary' : !emphasize && 'text-muted-foreground'
        )}
      >
        {format(day, 'EEE')}
      </div>
      <div
        className={cn(
          'text-sm mt-0.5 flex items-center justify-center gap-1',
          (emphasize || dayIsToday) && 'font-semibold',
          dayIsToday ? 'text-primary' : !emphasize && 'text-foreground'
        )}
      >
        <span>{format(day, 'MMM')}</span>
        <span
          className={cn(
            'inline-flex items-center justify-center h-5 w-5 rounded-full',
            dayIsToday && 'bg-primary text-primary-foreground dark:text-foreground'
          )}
        >
          {format(day, 'd')}
        </span>
      </div>
      {dayIsToday && (
        <span className="inline-flex items-center justify-center mt-1.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground dark:text-foreground text-[12px] font-semibold uppercase tracking-wide">
          Today
        </span>
      )}
    </>
  );
}
