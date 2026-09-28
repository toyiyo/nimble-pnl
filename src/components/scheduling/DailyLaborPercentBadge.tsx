import { memo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import type { DailyLaborPercent } from '@/lib/dailyLaborPercent';

import { cn } from '@/lib/utils';

interface DailyLaborPercentBadgeProps {
  value: DailyLaborPercent | undefined;
  isLoading: boolean;
  targetLaborPct: number;
  lookbackWeeks: number;
  /** Day name for the screen reader label, for example "Monday, Sep 28". */
  dayLabel: string;
  /**
   * `tooltip` (default) is a focusable label with a detail tooltip.
   * `plain` is text only, for use inside a parent button.
   */
  variant?: 'tooltip' | 'plain';
  /** True on a `bg-foreground` parent (a selected day button). */
  inverse?: boolean;
  className?: string;
}

function formatDollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function buildAriaLabel(
  value: DailyLaborPercent | undefined,
  dayLabel: string,
  targetLaborPct: number,
  lookbackWeeks: number,
): string {
  if (!value || value.percent === null) {
    return `${dayLabel} labor cost: no projected sales. No sales history for this weekday in the last ${lookbackWeeks} weeks.`;
  }
  const target = value.overTarget
    ? `over the ${targetLaborPct}% target`
    : `target ${targetLaborPct}%`;
  return `${dayLabel} labor cost: ${Math.round(value.percent)}% of projected sales. ${formatDollars(value.laborCost)} scheduled, ${formatDollars(value.projectedSales)} projected sales, ${target}.`;
}

/**
 * Daily labor cost % for a schedule day header: scheduled labor cost divided
 * by the projected sales for the day. Red when the percent is over the target.
 */
export const DailyLaborPercentBadge = memo(function DailyLaborPercentBadge({
  value,
  isLoading,
  targetLaborPct,
  lookbackWeeks,
  dayLabel,
  variant = 'tooltip',
  inverse = false,
  className,
}: Readonly<DailyLaborPercentBadgeProps>) {
  if (isLoading) {
    return (
      <Skeleton
        data-testid="daily-labor-percent-loading"
        className={cn('h-3 w-12 mx-auto mt-1 rounded', className)}
      />
    );
  }

  const percent = value?.percent ?? null;
  const text = percent === null ? 'Labor —' : `Labor ${Math.round(percent)}%`;
  const textClass = cn(
    'block text-[11px] font-medium tabular-nums whitespace-nowrap',
    value?.overTarget ? 'text-destructive' : inverse ? 'text-background/80' : 'text-muted-foreground',
    className,
  );

  if (variant === 'plain') {
    return <span className={textClass}>{text}</span>;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={buildAriaLabel(value, dayLabel, targetLaborPct, lookbackWeeks)}
            className={cn(
              textClass,
              'mt-1 cursor-default rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
            )}
          >
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[12px] space-y-0.5">
          {percent === null ? (
            <p>No sales history for this weekday in the last {lookbackWeeks} weeks.</p>
          ) : (
            <>
              <p>Scheduled labor: {formatDollars(value?.laborCost ?? 0)}</p>
              <p>Projected sales: {formatDollars(value?.projectedSales ?? 0)}</p>
              <p className="text-muted-foreground">
                Target {targetLaborPct}% · sales average of the last {lookbackWeeks} weeks
              </p>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
