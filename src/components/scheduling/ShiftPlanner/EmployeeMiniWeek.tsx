import { memo, useMemo } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_START_HOUR, COVERAGE_BUCKETS } from '@/hooks/usePlannerShiftsIndex';
import { toLocalDateKey, toLocalEpoch } from '@/lib/shiftAllocation';
import type { Shift } from '@/types/scheduling';

interface EmployeeMiniWeekProps {
  weekDays: readonly string[];
  employeeShifts: readonly Shift[];
  size?: 'sm' | 'md';
}

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

  return (
    <div className="grid grid-cols-7 gap-0.5 mt-1.5">
      {weekDays.map((day) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        const off = dayShifts.length === 0;
        return (
          <div
            key={day}
            data-mini-week-day={day}
            className={cn(
              'relative rounded-sm overflow-hidden border',
              off ? 'bg-muted/30 border-border/20' : 'bg-muted/50 border-border/30',
              isToday(day) && 'ring-1 ring-primary/40',
            )}
            style={{ height: trackHeight }}
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
              const height = Math.max(4, endPct - startPct);
              return (
                <div
                  key={shift.id}
                  data-mini-bar={shift.id}
                  className={cn('absolute left-0.5 right-0.5 rounded-[2px]', barColor(shift.position))}
                  style={{ top: `${startPct}%`, height: `${height}%` }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
