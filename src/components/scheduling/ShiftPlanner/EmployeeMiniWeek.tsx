import { memo, useMemo, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_START_HOUR, COVERAGE_BUCKETS } from '@/hooks/usePlannerShiftsIndex';
import { toLocalDateKey, toLocalEpoch } from '@/lib/shiftAllocation';
import type { EffectiveAvailability } from '@/lib/effectiveAvailability';
import { availabilityColorClasses, availabilityLabel } from '@/lib/effectiveAvailability';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Shift } from '@/types/scheduling';

interface EmployeeMiniWeekProps {
  weekDays: readonly string[];
  employeeShifts: readonly Shift[];
  availabilityByDow?: Map<number, EffectiveAvailability>;
  timezone?: string;
  dates?: readonly Date[]; // concrete Date per weekDays entry (DST anchor)
  size?: 'sm' | 'md';
}

const UNAVAILABLE_HATCH_STYLE: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, hsl(var(--destructive) / 0.12) 0 3px, transparent 3px 6px)',
};

const ROLE_BG: Record<string, string> = {
  server: 'bg-sky-500/70',
  cook: 'bg-amber-500/70',
  dish: 'bg-emerald-500/70',
  closer: 'bg-violet-500/70',
};

function barColor(position: string | null): string {
  if (!position) return 'bg-primary/60';
  return ROLE_BG[position.toLowerCase()] ?? 'bg-primary/60';
}

function hourOfDay(iso: string): number {
  const d = new Date(toLocalEpoch(iso));
  return d.getHours() + d.getMinutes() / 60;
}

function isToday(day: string): boolean {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}` === day;
}

export const EmployeeMiniWeek = memo(function EmployeeMiniWeek({
  weekDays,
  employeeShifts,
  availabilityByDow,
  timezone,
  dates,
  size = 'sm',
}: Readonly<EmployeeMiniWeekProps>) {
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of employeeShifts) {
      if (shift.status === 'cancelled') continue;
      const key = toLocalDateKey(shift.start_time);
      const bucket = map.get(key) ?? [];
      bucket.push(shift);
      map.set(key, bucket);
    }
    return map;
  }, [employeeShifts]);

  const trackHeight = size === 'md' ? 32 : 28;

  const weekSummary = useMemo(() => {
    if (!dates || !timezone || !availabilityByDow) return undefined;
    return weekDays
      .map((day, i) => {
        const eff = availabilityByDow.get(dates[i].getDay());
        const dow = dates[i].toLocaleDateString('en-US', { weekday: 'short' });
        return `${dow} ${eff ? availabilityLabel(eff, timezone, dates[i]) : 'No availability set'}`;
      })
      .join('; ');
  }, [weekDays, dates, timezone, availabilityByDow]);

  const grid = (
    <div
      className="grid grid-cols-7 gap-0.5 mt-1.5"
      role={weekSummary ? 'img' : undefined}
      aria-label={weekSummary ? `Availability — ${weekSummary}` : undefined}
    >
      {weekDays.map((day, i) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        const off = dayShifts.length === 0;
        const dow = dates?.[i]?.getDay();
        const eff = dow !== undefined ? availabilityByDow?.get(dow) : undefined;
        const tint = eff ? availabilityColorClasses(eff) : undefined;
        const isRecurringUnavailable =
          eff?.type === 'recurring' && !(eff.slots[0]?.isAvailable ?? false);
        let dayBgClass: string;
        if (tint) {
          dayBgClass = tint.bg;
        } else if (off) {
          dayBgClass = 'bg-muted/30 border-border/20';
        } else {
          dayBgClass = 'bg-muted/50 border-border/30';
        }
        return (
          <div
            key={day}
            data-mini-week-day={day}
            className={cn(
              'relative rounded-sm overflow-hidden border',
              dayBgClass,
              isToday(day) && 'ring-1 ring-primary/40',
            )}
            style={{
              height: trackHeight,
              ...(isRecurringUnavailable ? UNAVAILABLE_HATCH_STYLE : {}),
            }}
            aria-hidden="true"
          >
            {dayShifts.map((shift) => {
              const startHour = hourOfDay(shift.start_time);
              const endHour = hourOfDay(shift.end_time);
              const rawStart = (startHour - COVERAGE_START_HOUR) / COVERAGE_BUCKETS;
              const rawEnd = (endHour - COVERAGE_START_HOUR) / COVERAGE_BUCKETS;
              const startPct = Math.max(0, Math.min(1, rawStart)) * 100;
              const endPct = Math.max(0, Math.min(1, rawEnd)) * 100;
              if (endPct <= startPct) return null;
              const height = endPct - startPct;
              return (
                <div
                  key={shift.id}
                  data-mini-bar={shift.id}
                  className={cn('absolute left-0.5 right-0.5 rounded-[2px]', barColor(shift.position))}
                  style={{ top: `${startPct}%`, height: `${height}%`, minHeight: 4 }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );

  if (!weekSummary) return grid;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{grid}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-[12px]">{weekSummary}</TooltipContent>
    </Tooltip>
  );
});
