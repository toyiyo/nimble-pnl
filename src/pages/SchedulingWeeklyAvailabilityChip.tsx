import { cn } from '@/lib/utils';
import { weekAvailabilityChipClasses, type WeekAvailabilitySummary } from '@/lib/effectiveAvailability';

interface WeeklyAvailabilityChipProps {
  availability: WeekAvailabilitySummary | undefined;
}

/**
 * Weekly availability chip beside an employee's name (desktop grid and the
 * mobile day-focused card header). Callers only render this when the
 * employee isn't out on approved time off for the week — the "Time off"
 * pill takes that slot instead. Renders nothing for `unset` status or when
 * no availability data is available, so it's always safe to render
 * unconditionally.
 */
export function WeeklyAvailabilityChip({ availability }: Readonly<WeeklyAvailabilityChipProps>) {
  if (!availability) return null;
  const classes = weekAvailabilityChipClasses(availability.status);
  if (!classes) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0',
        classes.bg,
        classes.text,
      )}
    >
      {availability.label}
    </span>
  );
}
