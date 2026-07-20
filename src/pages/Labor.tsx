import { useState } from 'react';

import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useLaborPnlAnalytics } from '@/hooks/useLaborPnlAnalytics';
import { balanceStateClassName, type FinancialPoint, type LaborBalanceWindow, type LaborGranularity } from '@/lib/laborPnlAnalytics';
import { cn } from '@/lib/utils';

import { DemandVsStaffingChart } from '@/components/labor/DemandVsStaffingChart';
import { SalesVolumeHeatmap } from '@/components/labor/SalesVolumeHeatmap';
import { LaborVerdict } from '@/components/labor/LaborVerdict';
import { EditableLaborTarget } from '@/components/labor/EditableLaborTarget';

/**
 * "{startLabel}" for a single-bucket window, "{startLabel} – {endLabel}" for
 * a multi-bucket one (design §2.2 staffing callouts).
 */
export function windowRangeLabel(window: LaborBalanceWindow): string {
  if (window.bucketCount <= 1 || window.startLabel === window.endLabel) return window.startLabel;
  return `${window.startLabel} – ${window.endLabel}`;
}

/**
 * Pure: slices the contiguous run of `points` a `LaborBalanceWindow`
 * describes back out of the full series it was extracted from
 * (`summarizeLaborPnl`'s `extractBalanceWindows`, `src/lib/laborPnlAnalytics.ts`,
 * scans `points` in the same order and derives `startLabel`/`bucketCount`
 * from it) — so a window and its underlying buckets can be re-joined
 * without duplicating that scan here. Returns `[]` if `startLabel` has no
 * match (defensive — shouldn't happen for a window `summarizeLaborPnl`
 * itself produced from this same `points` array).
 */
export function findWindowPoints(
  points: readonly FinancialPoint[],
  window: LaborBalanceWindow,
): FinancialPoint[] {
  const startIdx = points.findIndex((p) => p.label === window.startLabel);
  if (startIdx === -1) return [];
  return points.slice(startIdx, startIdx + window.bucketCount);
}

/**
 * Pure: the staffing callout's "$ estimate" (design §2.2) — `summarizeLaborPnl`
 * (Phase A) intentionally scopes `LaborBalanceWindow` to just labels/bucket
 * count (see `src/lib/laborPnlAnalytics.ts`), so this page computes the
 * dollar magnitude itself from the same `laborCost`/`sales`/`targetPct`
 * figures already on each `FinancialPoint` in the window: the sum of
 * `laborCost - sales*targetPct/100` (how far actual labor $ ran from what
 * the target-% would imply), rounded and reported as a magnitude — the
 * caller labels it "over" or "under" from which window list (`overWindows`
 * vs. `underWindows`) it came from, matching `classifyBalance`'s own
 * over/under split so this never re-derives balance state independently.
 */
export function estimateWindowDollars(
  points: readonly FinancialPoint[],
  window: LaborBalanceWindow,
  targetPct: number,
): number {
  const windowPoints = findWindowPoints(points, window);
  const delta = windowPoints.reduce((sum, p) => sum + (p.laborCost - (p.sales * targetPct) / 100), 0);
  return Math.round(Math.abs(delta));
}

function formatDollars(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

const GRANULARITIES: { value: LaborGranularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** One tile of the 4-tile KPI row — pulled out of the page body since all four differ only in label/value. */
function KpiTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 space-y-1">
      <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-[20px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

/** Tone label for a staffing-callout window ("Over target:" / "Under target:"). */
const CALLOUT_LABEL: Record<'over' | 'under', string> = {
  over: 'Over target:',
  under: 'Under target:',
};

/**
 * `/labor` page (design §2.2): the financial counterpart to the scheduling
 * "Labor efficiency" panel (PR #611) — Day/Week/Month toggle, one-line
 * verdict, a 4-tile KPI row, the signature demand-vs-staffing chart (D3, with
 * the D1 balance ribbon sandwiched inside it), the busy-hours sales-volume
 * heatmap (D2), auto-generated over/under staffing callouts with a $
 * estimate, and the editable target-% control (D4). Composes
 * `useLaborPnlAnalytics` (C3) — this page owns no data fetching itself, only
 * the three loading/error/empty states and layout, mirroring
 * `LaborEfficiencyPanel`'s structure for the scheduling surface.
 *
 * The Day/Week/Month toggle *is* this page's period control: it selects
 * today / this week / this month, and the KPI row, verdict, chart, and callouts
 * all reflect the chosen period (see `useLaborPnlAnalytics`). There is no
 * separate prior-period navigator or delta-vs-previous-window — "vs. prior
 * period" (design §2.1) is expressed as delta-vs-*target* via the tone-colored
 * verdict, not a fetched comparison window.
 */
export default function Labor() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const [granularity, setGranularity] = useState<LaborGranularity>('day');

  const {
    series,
    seriesIsShapeEstimate,
    grid,
    summary,
    overWindows,
    underWindows,
    targetPct,
    capped,
    hasData,
    isLoading,
    isError,
    refetch,
    updateTarget,
    isSavingTarget,
  } = useLaborPnlAnalytics(restaurantId, granularity);

  if (!restaurantId) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-muted-foreground">Please select a restaurant to view labor cost.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" role="status" aria-label="Loading labor data">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <span>Failed to load labor data.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-1 text-[13px] font-medium text-foreground underline"
            aria-label="Retry loading labor data"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="p-6 text-center space-y-2">
        <p className="text-[13px] text-muted-foreground">
          Labor cost needs sales and clocked-hours history. Connect your POS and make sure staff are
          clocking in to see this view.
        </p>
        <Link to="/integrations" className="text-[13px] font-medium text-primary hover:underline">
          Connect your POS
        </Link>
      </div>
    );
  }

  const estimated = grid.length > 0 && grid[0].estimated;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">Labor cost</h1>
          <p className="text-[13px] text-muted-foreground">What your team costs against sales.</p>
        </div>
        <ToggleGroup
          type="single"
          value={granularity}
          onValueChange={(v) => {
            if (v === 'day' || v === 'week' || v === 'month') setGranularity(v);
          }}
          className="h-9"
          aria-label="Labor timeline granularity"
        >
          {GRANULARITIES.map((g) => (
            <ToggleGroupItem key={g.value} value={g.value} className="h-9 px-3 text-[12px]">
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <LaborVerdict summary={summary} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Labor % of sales"
          value={summary.laborPct !== null ? `${summary.laborPct}%` : '—'}
        />
        <KpiTile
          label="Revenue per labor hour"
          value={summary.revPerLaborHr !== null ? formatDollars(summary.revPerLaborHr) : '—'}
        />
        <KpiTile label="Net sales" value={formatDollars(summary.sales)} />
        <KpiTile label="Labor $" value={formatDollars(summary.laborCost)} />
      </div>

      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">Sales vs. labor</h2>
        <DemandVsStaffingChart points={series} targetPct={targetPct} granularity={granularity} />
        {seriesIsShapeEstimate && (
          <p className="text-[12px] text-muted-foreground">
            Hourly labor is estimated from an average wage; the totals above are payroll-grade.
          </p>
        )}
      </div>

      {(overWindows.length > 0 || underWindows.length > 0) && (
        <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-1.5">
          <h2 className="text-[13px] font-semibold text-foreground">Staffing callouts</h2>
          {(
            [
              ['over', overWindows],
              ['under', underWindows],
            ] as const
          ).flatMap(([tone, windows]) =>
            windows.map((window) => (
              <p key={`${tone}-${window.startLabel}`} className="text-[13px] text-foreground">
                <span className={cn('font-medium', balanceStateClassName(tone))}>{CALLOUT_LABEL[tone]}</span>{' '}
                {formatDollars(estimateWindowDollars(series, window, targetPct))} {tone} target labor spend,{' '}
                {windowRangeLabel(window)}.
              </p>
            )),
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">Busy hours</h2>
        <SalesVolumeHeatmap cells={grid} estimated={estimated} capped={capped} />
      </div>

      <div className="rounded-xl border border-border/40 bg-background p-4">
        <EditableLaborTarget targetPct={targetPct} onCommit={updateTarget} disabled={isSavingTarget} />
      </div>
    </div>
  );
}
