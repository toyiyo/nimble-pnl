import { memo, useId, useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { OverviewDayCard } from './OverviewDayCard';
import type { OverviewDay } from '@/hooks/usePlannerShiftsIndex';

interface ScheduleOverviewPanelProps {
  overviewDays: OverviewDay[];
  coverageByDay: Map<string, number[]>;
  isMobile: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAY_LABELS[date.getDay()]} ${d}`;
}

export const ScheduleOverviewPanel = memo(function ScheduleOverviewPanel({
  overviewDays,
  coverageByDay,
  isMobile,
}: Readonly<ScheduleOverviewPanelProps>) {
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();

  return (
    <section
      aria-label="Weekly schedule overview"
      className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold text-foreground">Schedule overview</span>
        </span>
        <span className="text-[12px] text-muted-foreground">
          {overviewDays.filter((d) => !d.unstaffed).length}/{overviewDays.length} days staffed
        </span>
      </button>

      <div
        id={bodyId}
        aria-hidden={!expanded}
        className={cn(
          'p-3',
          expanded
            ? isMobile
              ? 'flex flex-col gap-2'
              : 'grid grid-cols-7 gap-2'
            : 'hidden',
        )}
      >
        {overviewDays.map((d) => (
          <OverviewDayCard
            key={d.day}
            data={d}
            dayLabel={shortLabel(d.day)}
            variant={isMobile ? 'mobile' : 'desktop'}
            coverage={isMobile ? coverageByDay.get(d.day) : undefined}
          />
        ))}
      </div>
    </section>
  );
});
