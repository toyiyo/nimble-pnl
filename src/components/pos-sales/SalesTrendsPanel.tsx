import { useId, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useSalesTrends } from '@/hooks/useSalesTrends';
import {
  buildDailySeries,
  buildHourlySeries,
  buildTopProducts,
  buildWeekdaySeries,
  computeKpis,
  deriveInsights,
  filterByPos,
  hourCoverage,
  type PosFilter,
} from '@/lib/salesTrends';

import { PosFilterControl } from './PosFilterControl';
import { SalesByDayChart } from './SalesByDayChart';
import { TimeOfDayChart } from './TimeOfDayChart';
import { TopProductsList } from './TopProductsList';
import { TrendKpiRow } from './TrendKpiRow';
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
}: SalesTrendsPanelProps) {
  const { data, isLoading, error } = useSalesTrends(restaurantId, { startDate, endDate, timeZone });
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [posFilter, setPosFilter] = useState<PosFilter>('all');
  const contentId = useId();

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
  const kpis = useMemo(() => (filtered ? computeKpis(filtered) : null), [filtered]);
  const insights = useMemo(() => (filtered ? deriveInsights(filtered) : null), [filtered]);
  const daily = useMemo(
    () =>
      filtered
        ? buildDailySeries(
            filtered.by_day,
            filtered.pos_systems,
            startDate && endDate ? { start: startDate, end: endDate } : undefined,
          )
        : [],
    [filtered, startDate, endDate],
  );
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

  return (
    <div className="rounded-xl border border-border/40 bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
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
        {data && data.pos_systems.length > 1 && (
          <PosFilterControl posSystems={data.pos_systems} value={effectivePosFilter} onChange={setPosFilter} />
        )}
      </div>

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
              <TrendKpiRow kpis={kpis} />
              {coverage < 1 && (
                <p className="text-[12px] text-muted-foreground">
                  Hour-of-day data is partial for this range — some sales lack a recorded time.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartSection title="Sales by day">
                  <SalesByDayChart data={daily} posSystems={filtered.pos_systems} ariaLabel={insights.daily} />
                </ChartSection>
                <ChartSection title="Time of day">
                  <TimeOfDayChart data={hourly} posSystems={filtered.pos_systems} ariaLabel={insights.hourly} />
                </ChartSection>
                <ChartSection title="Day of week">
                  <WeekdayChart data={weekday} ariaLabel={insights.weekday} />
                </ChartSection>
                <ChartSection title="Top products">
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

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
