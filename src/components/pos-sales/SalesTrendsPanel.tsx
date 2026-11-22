import { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSalesDailySeries } from '@/hooks/useSalesDailySeries';
import { useSalesTrends } from '@/hooks/useSalesTrends';
import { describeComparison, getComparisonRange, type ComparisonKind } from '@/lib/comparisonRange';
import {
  attachPriorSeries,
  buildDailySeries,
  buildHourlySeries,
  buildTopProducts,
  buildWeekdaySeries,
  computeKpiDelta,
  computeKpis,
  deriveInsights,
  filterByPos,
  formatShortDate,
  hourCoverage,
  toTrendsData,
  type PosFilter,
} from '@/lib/salesTrends';

import { PosFilterControl } from './PosFilterControl';
import { SalesByDayChart } from './SalesByDayChart';
import { TimeOfDayChart } from './TimeOfDayChart';
import { TopProductsList } from './TopProductsList';
import { TrendKpiRow, type TrendKpiDeltas } from './TrendKpiRow';
import { WeekdayChart } from './WeekdayChart';

interface SalesTrendsPanelProps {
  restaurantId: string | null;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  /**
   * Initial expand state. The page wiring (Task 7) resolves this from
   * `matchMedia('(min-width: 1024px)')` — expanded on `lg`+, collapsed on
   * mobile (design §4.2) — so it never depends on `matchMedia` inside the
   * panel itself.
   */
  defaultExpanded?: boolean;
  /**
   * Comparison hint for a preset range, for example 'shift' for a rolling "last N days" range.
   * Leave it out for a custom range. The dashboard uses the same hints, so both pages give the same prior range.
   */
  comparisonHint?: ComparisonKind;
}

/**
 * Full-width collapsible panel: KPI strip + four filterable charts (sales by
 * day, time of day, day of week, top products), all re-scoped by a single
 * POS segmented control.
 *
 * Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.2
 *
 * Collapse is a plain conditional render, NOT Radix animated height —
 * `ResponsiveContainer` measures its parent via `ResizeObserver` at mount,
 * and an animated `height:0` container never re-measures once opened
 * (design §4.2 FE critical).
 */
export function SalesTrendsPanel({
  restaurantId,
  startDate,
  endDate,
  timeZone,
  defaultExpanded = true,
  comparisonHint,
}: Readonly<SalesTrendsPanelProps>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Only fetch when the panel is open — the RPC is heavy and the panel defaults
  // collapsed on mobile. React Query serves cached data instantly on re-expand.
  const { data, isLoading, error } = useSalesTrends(restaurantId, {
    startDate,
    endDate,
    timeZone,
    enabled: expanded,
  });
  const [posFilter, setPosFilter] = useState<PosFilter>('all');
  const contentId = useId();
  const compareId = useId();
  const [compareOn, setCompareOn] = useState(true);
  const comparison = useMemo(
    () => (startDate && endDate ? getComparisonRange(startDate, endDate, comparisonHint) : null),
    [startDate, endDate, comparisonHint],
  );
  const {
    data: priorData,
    isLoading: priorLoading,
    error: priorError,
  } = useSalesDailySeries(restaurantId, {
    // The prior period needs only the daily totals, so it uses the narrow RPC.
    startDate: comparison?.start,
    endDate: comparison?.end,
    // The hook retries one time, so the skeleton does not stay for 7 seconds.
    enabled: expanded && compareOn && comparison !== null,
  });
  useEffect(() => {
    if (priorError) console.error('Could not load the previous-period sales trends', priorError);
  }, [priorError]);

  // Guard against a stale `posFilter`: if the page's date range (or
  // restaurant) changes and the previously-selected POS system is no longer
  // present in the new payload, `filterByPos` would otherwise silently
  // return empty arrays for every chart while `isEmpty` (computed from the
  // *unfiltered* `data.pos_systems`) stays false — a bogus all-zero
  // dashboard with no UI path back to "All POS" if only one system remains
  // (the segmented control hides itself below `pos_systems.length <= 1`).
  // Derive the effective filter instead of resetting state outright, so a
  // system that later reappears in range re-applies the user's selection.
  const effectivePosFilter: PosFilter =
    !data || posFilter === 'all' || data.pos_systems.includes(posFilter) ? posFilter : 'all';

  const filtered = useMemo(
    () => (data ? filterByPos(data, effectivePosFilter) : null),
    [data, effectivePosFilter],
  );
  const priorFiltered = useMemo(
    () => (compareOn && comparison !== null && priorData ? filterByPos(toTrendsData(priorData), effectivePosFilter) : null),
    [compareOn, comparison, priorData, effectivePosFilter],
  );
  const priorKpis = useMemo(() => (priorFiltered ? computeKpis(priorFiltered) : null), [priorFiltered]);
  const priorDaily = useMemo(() => {
    if (!priorFiltered || !comparison) return undefined;
    return buildDailySeries(priorFiltered.by_day, priorFiltered.pos_systems, {
      start: comparison.start,
      end: comparison.end,
    });
  }, [priorFiltered, comparison]);
  const kpis = useMemo(() => (filtered ? computeKpis(filtered) : null), [filtered]);
  const insights = useMemo(() => (filtered ? deriveInsights(filtered) : null), [filtered]);
  const daily = useMemo(() => {
    if (!filtered) return [];
    const range = startDate && endDate ? { start: startDate, end: endDate } : undefined;
    return buildDailySeries(filtered.by_day, filtered.pos_systems, range);
  }, [filtered, startDate, endDate]);
  const dailyWithPrior = useMemo(() => attachPriorSeries(daily, priorDaily), [daily, priorDaily]);
  const priorFailed = compareOn && comparison !== null && !!priorError;
  const deltas = useMemo<TrendKpiDeltas | undefined>(() => {
    if (!kpis || !priorKpis || priorFailed) return undefined;
    return {
      netSales: computeKpiDelta(kpis.netSales, priorKpis.netSales),
      orders: computeKpiDelta(kpis.orders, priorKpis.orders),
      avgOrder: computeKpiDelta(kpis.avgOrder, priorKpis.avgOrder),
    };
  }, [kpis, priorKpis, priorFailed]);
  const deltasLoading = compareOn && comparison !== null && priorLoading;
  const showPrior = !!priorDaily && !priorFailed;
  // Net sales of the full prior period. The chart rows pair by index, so they can drop prior days.
  const priorTotal = priorKpis?.netSales;
  const hourly = useMemo(
    () => (filtered ? buildHourlySeries(filtered.by_hour, filtered.pos_systems) : []),
    [filtered],
  );
  const weekday = useMemo(() => (filtered ? buildWeekdaySeries(filtered.by_weekday) : []), [filtered]);
  const products = useMemo(
    () => (filtered ? buildTopProducts(filtered.by_product, filtered.by_day) : []),
    [filtered],
  );
  const coverage = useMemo(() => (filtered ? hourCoverage(filtered) : 1), [filtered]);

  const isEmpty = !isLoading && !error && !!data && data.pos_systems.length === 0;

  const showComparisonNote =
    expanded && !isLoading && !error && !isEmpty && comparison !== null && compareOn &&
    (priorFailed || (priorData && !priorLoading));

  return (
    <div className="rounded-xl border border-border/40 bg-background">
      <div className="flex items-center justify-between gap-2 px-4 py-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={expanded ? 'Collapse sales trends' : 'Expand sales trends'}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
          </button>
          <h2 className="text-[17px] font-semibold text-foreground truncate">Sales Trends</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {expanded && comparison !== null && (
            <div className="flex items-center gap-2 min-h-[44px] sm:min-h-0">
              <Switch
                id={compareId}
                checked={compareOn}
                onCheckedChange={setCompareOn}
                className="data-[state=checked]:bg-foreground"
              />
              <Label htmlFor={compareId} className="text-[13px] text-muted-foreground">
                Compare to previous period
              </Label>
            </div>
          )}
          {data && data.pos_systems.length > 1 && (
            <PosFilterControl posSystems={data.pos_systems} value={effectivePosFilter} onChange={setPosFilter} />
          )}
        </div>
      </div>
      {showComparisonNote && (
        <div className="px-4 pb-2">
          {priorFailed ? (
            <output className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
              <span>Could not load the previous period.</span>
            </output>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {`vs ${formatShortDate(comparison.start)} – ${formatShortDate(comparison.end)} · ${describeComparison(comparison)}`}
            </p>
          )}
        </div>
      )}

      {expanded ? (
        <div id={contentId} className="px-4 pb-4 space-y-4">
          {isLoading && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[220px] w-full rounded-lg" />
                ))}
              </div>
            </div>
          )}

          {!isLoading && error && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-6 justify-center">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
              <span>Failed to load sales trends.</span>
            </div>
          )}

          {!isLoading && !error && isEmpty && (
            <p className="text-[13px] text-muted-foreground text-center py-6">No sales in this range.</p>
          )}

          {!isLoading && !error && !isEmpty && filtered && kpis && insights && (
            <>
              <TrendKpiRow kpis={kpis} deltas={deltas} deltasLoading={deltasLoading} />
              {coverage < 1 && (
                <p className="text-[12px] text-muted-foreground">
                  Hour-of-day data is partial for this range — some sales lack a recorded time.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartSection title="Sales by day" caption={insights.daily}>
                  <SalesByDayChart data={dailyWithPrior} showPrior={showPrior} priorTotal={priorTotal} posSystems={filtered.pos_systems} ariaLabel={insights.daily} />
                </ChartSection>
                <ChartSection title="Time of day" caption={insights.hourly}>
                  <TimeOfDayChart data={hourly} posSystems={filtered.pos_systems} ariaLabel={insights.hourly} />
                </ChartSection>
                <ChartSection title="Day of week" caption={insights.weekday}>
                  <WeekdayChart data={weekday} ariaLabel={insights.weekday} />
                </ChartSection>
                <ChartSection title="Top products" caption={insights.product}>
                  <TopProductsList products={products} activePos={effectivePosFilter} ariaLabel={insights.product} />
                </ChartSection>
              </div>
            </>
          )}
        </div>
      ) : (
        <div id={contentId} hidden />
      )}
    </div>
  );
}

function ChartSection({
  title,
  caption,
  children,
}: Readonly<{ title: string; caption?: string; children: React.ReactNode }>) {
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
      {caption && (
        // aria-hidden: the identical text is already the chart's role="img"
        // aria-label, so screen readers get it once — this is the visible copy.
        <p className="text-[12.5px] leading-snug text-muted-foreground" aria-hidden="true">
          {caption}
        </p>
      )}
    </div>
  );
}
