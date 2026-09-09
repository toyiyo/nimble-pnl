import { memo } from 'react';

import { Button } from '@/components/ui/button';

import { AlertTriangle, ChevronLeft, ChevronRight, Calendar, Printer, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlannerHeaderProps {
  weekStart: Date;
  weekEnd: Date;
  totalHours: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onExport?: () => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  /** Number of shifts this week with at least one conflict. Zero hides the pill. */
  conflictCount?: number;
  /** True when the time-off query errored — the pill would be a false
   *  all-clear, so a muted note renders instead. */
  conflictsUnavailable?: boolean;
}

/**
 * Formats a date range as "Mar 2 - Mar 8" (or "Feb 28 - Mar 6" across months).
 */
function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', opts);
  return `${startStr} \u2013 ${endStr}`;
}

export const PlannerHeader = memo(function PlannerHeader({
  weekStart,
  weekEnd,
  totalHours,
  onPrevWeek,
  onNextWeek,
  onToday,
  onExport,
  onGenerate,
  isGenerating,
  conflictCount = 0,
  conflictsUnavailable,
}: PlannerHeaderProps) {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      {/* Left: week navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={onPrevWeek}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="text-[15px] font-semibold text-foreground min-w-[160px] text-center select-none">
          {formatDateRange(weekStart, weekEnd)}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={onNextWeek}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground ml-1"
          onClick={onToday}
        >
          <Calendar className="h-3.5 w-3.5 mr-1" />
          Today
        </Button>
      </div>

      {/* Right: summary stat + export */}
      <div className="flex items-center gap-2">
        {conflictsUnavailable ? (
          <span className="text-[13px] text-muted-foreground">Conflicts unavailable</span>
        ) : (
          conflictCount > 0 && (
            {/* The visible text is the accessible name — aria-label on a
                generic span is exposed inconsistently by screen readers. */}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {conflictCount === 1 ? '1 conflict' : `${conflictCount} conflicts`}
            </span>
          )
        )}
        <span className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{totalHours}h</span> scheduled
        </span>
        {onGenerate && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={onGenerate}
            disabled={isGenerating}
            aria-label="Generate schedule with AI"
          >
            <Sparkles className={cn('h-3.5 w-3.5 mr-1', isGenerating && 'animate-pulse')} />
            <span aria-live="polite" aria-atomic="true">
              {isGenerating ? 'Generating...' : 'Generate with AI'}
            </span>
          </Button>
        )}
        {onExport && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={onExport}
            aria-label="Export planner"
          >
            <Printer className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        )}
      </div>
    </div>
  );
});
