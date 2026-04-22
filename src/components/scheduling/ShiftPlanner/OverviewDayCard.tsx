import { memo, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_START_HOUR, COVERAGE_BUCKETS } from '@/hooks/usePlannerShiftsIndex';
import type { OverviewDay, OverviewPill } from '@/hooks/usePlannerShiftsIndex';

interface OverviewDayCardProps {
  data: OverviewDay;
  dayLabel?: string;
  variant?: 'desktop' | 'mobile';
  coverage?: number[];
}

const ROLE_BG: Record<string, string> = {
  server: 'bg-sky-500/70',
  cook: 'bg-amber-500/70',
  dish: 'bg-emerald-500/70',
  closer: 'bg-violet-500/70',
};

function pillColor(position: string | null): string {
  if (!position) return 'bg-primary/60';
  const key = position.toLowerCase();
  return ROLE_BG[key] ?? 'bg-primary/60';
}

function pillStyle(pill: OverviewPill): CSSProperties {
  const rawStart = pill.startHour - COVERAGE_START_HOUR;
  const rawEnd = pill.endHour - COVERAGE_START_HOUR;
  const start = Math.max(0, Math.min(COVERAGE_BUCKETS, rawStart));
  const end = Math.max(0, Math.min(COVERAGE_BUCKETS, rawEnd));
  if (end <= start) {
    return { display: 'none' };
  }
  const left = (start / COVERAGE_BUCKETS) * 100;
  const width = Math.max(2, ((end - start) / COVERAGE_BUCKETS) * 100);
  return { left: `${left}%`, width: `${width}%` };
}

export const OverviewDayCard = memo(function OverviewDayCard({
  data,
  dayLabel,
  variant = 'desktop',
  coverage,
}: Readonly<OverviewDayCardProps>) {
  const { pills, collapsedCount, hasGap, gapLabel, unstaffed } = data;
  const laneHeight = variant === 'mobile' ? 10 : 8;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-background p-3 flex flex-col gap-2',
        variant === 'mobile' ? 'w-full' : 'min-w-[120px]',
      )}
      data-overview-day={data.day}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">
          {dayLabel ?? data.day}
        </span>
        <div className="flex gap-1">
          {unstaffed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive">
              Unstaffed
            </span>
          )}
          {!unstaffed && hasGap && gapLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600">
              {gapLabel}
            </span>
          )}
          {collapsedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              +{collapsedCount} more
            </span>
          )}
        </div>
      </div>

      {!unstaffed && (
        <div
          className="relative w-full overflow-hidden rounded-md bg-muted/40"
          style={{ height: laneHeight * 3 + 6 }}
          aria-hidden="true"
        >
          {pills.map((pill) => (
            <div
              key={pill.shiftId}
              data-shift-pill={pill.shiftId}
              title={`${pill.employeeName} · ${pill.position ?? ''}`}
              className={cn('absolute rounded-sm', pillColor(pill.position))}
              style={{
                ...pillStyle(pill),
                top: pill.lane * laneHeight + 3,
                height: laneHeight - 2,
              }}
            />
          ))}
        </div>
      )}

      {variant === 'mobile' && coverage && (
        <div className="flex h-3 rounded-sm overflow-hidden">
          {coverage.map((count, idx) => {
            const density = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
            const classMap = ['bg-muted/40', 'bg-primary/20', 'bg-primary/40', 'bg-primary/60', 'bg-primary/80'] as const;
            return <div key={idx} className={cn('flex-1', classMap[density])} />;
          })}
        </div>
      )}
    </div>
  );
});
