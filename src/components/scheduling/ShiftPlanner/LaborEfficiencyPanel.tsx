import { useMemo, useState } from 'react';

import { Link } from 'react-router-dom';

import { AlertCircle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { useSplhAnalytics } from '@/hooks/useSplhAnalytics';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { MON_FIRST_DOWS, DOW_LABELS_BY_DOW, verdictToneColor } from '@/lib/splhAnalytics';

import { SplhHeatmap } from './SplhHeatmap';
import { SplhTimelineChart } from './SplhTimelineChart';

// Re-exported for this module's own tests — the implementation lives in
// `@/lib/splhAnalytics` so the Dashboard card and this panel share one
// tone->color mapping (see `LaborEfficiencyCard`'s equivalent re-export).
export { verdictToneColor };

interface LaborEfficiencyPanelProps {
  readonly restaurantId: string;
}

interface HourRange {
  dow: number;
  startHour: number;
  /** Exclusive — the range covers [startHour, endHour). */
  endHour: number;
}

/**
 * Pure: collapse a flat `{dow,hour}[]` list (one entry per active hour
 * bucket) into contiguous per-day ranges, sorted Mon-first then by start
 * hour. Consecutive hour buckets on the same day merge into a single range
 * — e.g. hours 18, 19, 20 on Friday become one range covering 6pm–9pm
 * (bucket 20 itself spans 8-9pm, so the display end is hour 21).
 */
export function groupHoursIntoRanges(
  hours: readonly { dow: number; hour: number }[],
): HourRange[] {
  const byDow = new Map<number, number[]>();
  for (const h of hours) {
    const list = byDow.get(h.dow);
    if (list) list.push(h.hour);
    else byDow.set(h.dow, [h.hour]);
  }

  const ranges: HourRange[] = [];
  for (const [dow, dowHours] of byDow) {
    const sorted = Array.from(new Set(dowHours)).sort((a, b) => a - b);
    let rangeStart = sorted[0];
    let prevHour = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const hour: number | undefined = sorted[i];
      if (hour === prevHour + 1) {
        prevHour = hour;
        continue;
      }
      ranges.push({ dow, startHour: rangeStart, endHour: prevHour + 1 });
      if (hour !== undefined) {
        rangeStart = hour;
        prevHour = hour;
      }
    }
  }

  ranges.sort((a, b) => {
    const dowDiff = MON_FIRST_DOWS.indexOf(a.dow) - MON_FIRST_DOWS.indexOf(b.dow);
    return dowDiff !== 0 ? dowDiff : a.startHour - b.startHour;
  });
  return ranges;
}

/**
 * Pure: "Fri 6 PM–9 PM". Reuses `formatCoverageHour` (shared with
 * `SplhHeatmap`/`CoverageChart`) so the hour label style matches the heatmap
 * rendered directly above this callout.
 */
export function formatHourRange(range: HourRange): string {
  return `${DOW_LABELS_BY_DOW[range.dow]} ${formatCoverageHour(range.startHour)}–${formatCoverageHour(range.endHour)}`;
}

/**
 * Scheduling planner "Labor efficiency" panel: heatmap + hire/trim callout +
 * day/week SPLH timeline. Composes `useSplhAnalytics` — this component owns
 * no data fetching itself, only the three loading/error/empty states and
 * layout (design §2 "Scheduling", plan Task 12).
 */
export function LaborEfficiencyPanel({ restaurantId }: LaborEfficiencyPanelProps) {
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const {
    grid,
    daily,
    weekly,
    summary,
    target,
    hasHourlyBreakdown,
    capped,
    hasData,
    isLoading,
    isError,
    refetch,
  } = useSplhAnalytics(restaurantId);

  const hireRanges = useMemo(() => groupHoursIntoRanges(summary.hireHours), [summary.hireHours]);
  const trimRanges = useMemo(() => groupHoursIntoRanges(summary.trimHours), [summary.trimHours]);
  const points = granularity === 'day' ? daily : weekly;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        <span>Failed to load labor efficiency data. Try again later.</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-2 text-[13px] font-medium text-foreground underline"
          aria-label="Retry loading labor efficiency data"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="px-1 py-6 text-center space-y-2">
        <p className="text-[13px] text-muted-foreground">
          Labor efficiency needs sales and clocked-hours history. Connect your POS and make sure staff
          are clocking in to see this view.
        </p>
        <Link
          to="/integrations"
          className="text-[13px] font-medium text-primary hover:underline"
        >
          Connect your POS
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-1">
        <h3 className="text-[15px] font-semibold text-foreground">Labor efficiency</h3>
        <p className="text-[13px] text-muted-foreground">
          {summary.actualSplh !== null ? `$${summary.actualSplh}/labor-hr` : '—'} vs ${target} target
          {summary.laborPct !== null && ` · Labor ${summary.laborPct}% of sales`}
        </p>
        <p
          className="text-[13px] font-medium text-muted-foreground"
          style={{ color: verdictToneColor(summary.verdictTone) }}
        >
          {summary.verdict}
        </p>
      </div>

      {capped && (
        <p className="text-[12px] text-muted-foreground px-1">
          Showing a partial window — narrow your date range for full accuracy.
        </p>
      )}

      {/* Day-of-week x hour-of-day heatmap */}
      <SplhHeatmap cells={grid} target={target} estimated={!hasHourlyBreakdown} />

      {/* Hire/trim callout — neutral, read-only (no apply affordance) */}
      {(hireRanges.length > 0 || trimRanges.length > 0) && (
        <div className="bg-muted/30 border border-border/40 rounded-lg p-3 space-y-1.5">
          {hireRanges.length > 0 && (
            <p className="text-[13px] text-foreground">
              <span className="font-medium">Consider hiring:</span> {hireRanges.map(formatHourRange).join(', ')}
            </p>
          )}
          {trimRanges.length > 0 && (
            <p className="text-[13px] text-foreground">
              <span className="font-medium">Consider trimming:</span> {trimRanges.map(formatHourRange).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* SPLH-vs-target timeline with day/week toggle */}
      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-foreground">SPLH over time</h4>
          <ToggleGroup
            type="single"
            value={granularity}
            onValueChange={(v) => {
              if (v === 'day' || v === 'week') setGranularity(v);
            }}
            className="h-8"
            aria-label="Timeline granularity"
          >
            <ToggleGroupItem value="day" className="h-8 px-3 text-[12px]">
              Day
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="h-8 px-3 text-[12px]">
              Week
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <SplhTimelineChart points={points} target={target} granularity={granularity} />
      </div>
    </div>
  );
}
