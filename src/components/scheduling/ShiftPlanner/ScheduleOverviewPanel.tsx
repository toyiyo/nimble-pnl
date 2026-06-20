import { memo, useState } from 'react';

import { CalendarRange, ChevronDown } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  const [isExpanded, setIsExpanded] = useState(false);

  const staffedCount = overviewDays.filter((d) => !d.unstaffed).length;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <section
        aria-label="Weekly schedule overview"
        className="rounded-xl border border-border/40 bg-background overflow-hidden"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center">
                <CalendarRange className="h-3.5 w-3.5 text-foreground" />
              </span>
              <span className="text-[14px] font-medium text-foreground">Schedule overview</span>
              {!isExpanded && overviewDays.length > 0 && (
                <span className="text-[12px] text-muted-foreground ml-2">
                  {staffedCount}/{overviewDays.length} days staffed
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                isExpanded && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className={cn(
              'p-3',
              isMobile ? 'flex flex-col gap-2' : 'grid grid-cols-7 gap-2',
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
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
});
