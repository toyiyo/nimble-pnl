import { memo } from 'react';

import { cn } from '@/lib/utils';

import { COVERAGE_BUCKETS, COVERAGE_START_HOUR } from '@/hooks/usePlannerShiftsIndex';

interface CoverageStripProps {
  weekDays: readonly string[];
  coverageByDay: Map<string, number[]>;
}

function densityFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

const DENSITY_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-muted/30',
  1: 'bg-primary/20',
  2: 'bg-primary/40',
  3: 'bg-primary/60',
  4: 'bg-primary/80',
};

function hourLabel(bucket: number): string {
  const hour = COVERAGE_START_HOUR + bucket;
  const suffix = hour >= 12 ? 'p' : 'a';
  const display = ((hour + 11) % 12) + 1;
  return `${display}${suffix}`;
}

export const CoverageStrip = memo(function CoverageStrip({
  weekDays,
  coverageByDay,
}: Readonly<CoverageStripProps>) {
  return (
    <>
      {weekDays.map((day) => {
        const buckets = coverageByDay.get(day) ?? new Array(COVERAGE_BUCKETS).fill(0);
        return (
          <div
            key={day}
            data-coverage-day={day}
            className="border-t border-l border-border/40 flex items-stretch h-6"
          >
            {buckets.map((count, idx) => {
              const density = densityFor(count);
              return (
                <div
                  key={idx}
                  data-density={density}
                  aria-hidden="true"
                  title={`${hourLabel(idx)} · ${count} on shift`}
                  className={cn('flex-1 border-r border-border/20 last:border-r-0', DENSITY_CLASS[density])}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
});
