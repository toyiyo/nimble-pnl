import { useState } from 'react';

import { Link } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, Star, Check, TriangleAlert, type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useLaborPnlAnalytics } from '@/hooks/useLaborPnlAnalytics';
import {
  addDaysStr,
  balanceStateClassName,
  balanceStateBgClassName,
  type BalanceState,
  type FinancialPoint,
  type LaborBalanceWindow,
  type LaborRangePreset,
  type LaborRangeSelection,
} from '@/lib/laborPnlAnalytics';
import { cn } from '@/lib/utils';

import { DemandVsStaffingChart } from '@/components/labor/DemandVsStaffingChart';
import { SalesVolumeHeatmap } from '@/components/labor/SalesVolumeHeatmap';
import { LaborVerdict } from '@/components/labor/LaborVerdict';
import { EditableLaborTarget } from '@/components/labor/EditableLaborTarget';
import { Sparkline } from '@/components/labor/Sparkline';

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

const RANGE_PRESETS: { value: LaborRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom…' },
];

interface KpiTileProps {
  readonly label: string;
  readonly value: string;
  /** Tailwind bg class for the metric's accent dot (revenue = balanced, cost = over). */
  readonly accentClass: string;
  /** Optional tone class applied to the big value (e.g. labor-% verdict tone). */
  readonly toneClass?: string;
  /** Tone class for the sparkline (defaults to the value tone, then muted). */
  readonly sparkClass?: string;
  readonly sub?: string;
  /** Sparkline series (nulls = gaps). */
  readonly spark?: readonly (number | null)[];
}

/** One tile of the KPI row: accent dot, big value (optionally tone-colored), a
 * sub caption, and an accent-toned sparkline of the metric across the range. */
function KpiTile({ label, value, accentClass, toneClass, sparkClass, sub, spark }: KpiTileProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 flex flex-col gap-1">
      <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-[3px] shrink-0', accentClass)} />
        {label}
      </p>
      <p className={cn('text-[20px] font-semibold text-foreground', toneClass)}>{value}</p>
      <div className="flex items-end justify-between gap-2 mt-0.5 min-h-[20px]">
        {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : <span />}
        {spark && <Sparkline values={spark} className={sparkClass ?? toneClass ?? 'text-muted-foreground'} />}
      </div>
    </div>
  );
}

/** A single "What to do about it" recommendation (design prototype). */
interface LaborFinding {
  icon: LucideIcon;
  tone: BalanceState | 'none';
  title: string;
  detail: string;
  /** Tone-colored magnitude phrase (e.g. "save ~$180"); omitted for neutral notes. */
  impact?: string;
}

/** One recommendation card: tone-colored icon badge + title + detail with a
 * tone-colored impact phrase — the prototype's "what to do about it" hint. */
function LaborFindingCard({ finding }: { readonly finding: LaborFinding }) {
  const Icon = finding.icon;
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-muted/20">
      <div
        className={cn(
          'h-8 w-8 rounded-lg grid place-items-center shrink-0 text-background',
          balanceStateBgClassName(finding.tone, 'bg-foreground'),
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{finding.title}</p>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {finding.detail}
          {finding.impact && (
            <>
              {' '}
              <span className={cn('font-medium', balanceStateClassName(finding.tone))}>{finding.impact}</span>.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Short range caption, e.g. "Jul 1 – Jul 7" (or a single date). */
function formatRangeCaption(startStr: string, endStr: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return startStr === endStr ? fmt(startStr) : `${fmt(startStr)} – ${fmt(endStr)}`;
}

/**
 * `/labor` page: the financial counterpart to the scheduling "Labor efficiency"
 * panel (PR #611) — a date-range selector (Today / This week / Last week / This
 * month / Last month / Custom), a one-line verdict, a 4-tile KPI row, the
 * signature demand-vs-staffing chart (with the balance ribbon), the busy-hours
 * sales-volume heatmap, auto-generated over/under staffing callouts, and the
 * editable target-% control. Composes `useLaborPnlAnalytics` — this page owns no
 * data fetching, only the three loading/error/empty states and layout.
 *
 * The range selector *is* the period control: the KPI row, verdict, chart, and
 * callouts all reflect the chosen range, and the chart auto-buckets (hour-of-day
 * for a single day, by day for a short range, by week for a long one).
 */
export default function Labor() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const [selection, setSelection] = useState<LaborRangeSelection>({ preset: 'today' });

  const {
    series,
    granularity,
    seriesIsShapeEstimate,
    range,
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
    todayStr,
  } = useLaborPnlAnalytics(restaurantId, selection);

  // Custom-range picker bounds from the restaurant-tz "today" (not host-local),
  // so an evening user west of UTC can't pick "tomorrow". Floor at the ~18-week
  // fetch window (126 days).
  const today = todayStr;
  const minCustom = addDaysStr(todayStr, -126);

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
  const rangeCaption = formatRangeCaption(range.startStr, range.endStr);
  const laborTone = balanceStateClassName(summary.verdictTone);
  const overBudget = summary.laborPct !== null ? summary.laborCost - (summary.sales * targetPct) / 100 : null;
  const targetDelta = summary.laborPct !== null ? summary.laborPct - targetPct : null;

  // "What to do about it" — the prototype's recommendation cards, derived from
  // the same over/under windows, the peak bucket, and the overall vs-target gap.
  const findings: LaborFinding[] = [];
  for (const w of overWindows.slice(0, 1)) {
    findings.push({
      icon: ArrowDown,
      tone: 'over',
      title: `Overstaffed ${windowRangeLabel(w)}`,
      detail: 'Labor outran sales here — trimming to demand could',
      impact: `save ~${formatDollars(estimateWindowDollars(series, w, targetPct))}`,
    });
  }
  for (const w of underWindows.slice(0, 1)) {
    findings.push({
      icon: ArrowUp,
      tone: 'under',
      title: `Stretched thin ${windowRangeLabel(w)}`,
      detail: 'Sales outran the floor — an extra hand protects speed, with about',
      impact: `${formatDollars(estimateWindowDollars(series, w, targetPct))} of headroom`,
    });
  }
  const peak = series.reduce<FinancialPoint | null>((best, p) => (best && best.sales >= p.sales ? best : p), null);
  if (peak && peak.sales > 0) {
    findings.push({
      icon: Star,
      tone: 'none',
      title: `Peak: ${peak.label}`,
      detail: `${formatDollars(peak.sales)} in sales${peak.laborPct !== null ? ` at ${peak.laborPct}% labor` : ''} — protect this window; staff it first.`,
    });
  }
  if (summary.laborPct !== null && overBudget !== null && targetDelta !== null) {
    findings.push(
      overBudget > 0
        ? {
            icon: TriangleAlert,
            tone: 'over',
            title: `${summary.laborPct}% labor — ${targetDelta.toFixed(1)}pt over target`,
            detail: 'Across this range you spent more on labor than plan. Closing the gap is worth',
            impact: `~${formatDollars(overBudget)}`,
          }
        : {
            icon: Check,
            tone: 'balanced',
            title: `${summary.laborPct}% labor — on target`,
            detail: 'Labor held the line against sales this range. Keep the pattern.',
          },
    );
  }
  const topFindings = findings.slice(0, 4);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">Labor cost</h1>
          <p className="text-[13px] text-muted-foreground">
            What your team costs against sales · <span className="text-foreground/70">{rangeCaption}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={selection.preset}
            onValueChange={(v) => setSelection((prev) => ({ ...prev, preset: v as LaborRangePreset }))}
          >
            <SelectTrigger className="h-9 w-[150px] text-[13px]" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((r) => (
                <SelectItem key={r.value} value={r.value} className="text-[13px]">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selection.preset === 'custom' && (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="labor-range-start" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  From
                </Label>
                <Input
                  id="labor-range-start"
                  type="date"
                  min={minCustom}
                  max={today}
                  value={selection.customStart ?? ''}
                  onChange={(e) => setSelection((prev) => ({ ...prev, customStart: e.target.value }))}
                  className="h-9 w-[150px] text-[13px]"
                  aria-label="Custom range start date"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="labor-range-end" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  To
                </Label>
                <Input
                  id="labor-range-end"
                  type="date"
                  min={minCustom}
                  max={today}
                  value={selection.customEnd ?? ''}
                  onChange={(e) => setSelection((prev) => ({ ...prev, customEnd: e.target.value }))}
                  className="h-9 w-[150px] text-[13px]"
                  aria-label="Custom range end date"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <LaborVerdict summary={summary} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Labor % of sales"
          value={summary.laborPct !== null ? `${summary.laborPct}%` : '—'}
          accentClass="bg-[hsl(var(--labor-over))]"
          toneClass={laborTone}
          sparkClass={laborTone || 'text-[hsl(var(--labor-over))]'}
          sub={targetDelta !== null ? `${targetDelta > 0 ? '+' : ''}${targetDelta.toFixed(1)}pt vs ${targetPct}% target` : undefined}
          spark={series.map((p) => p.laborPct)}
        />
        <KpiTile
          label="Revenue per labor hour"
          value={summary.revPerLaborHr !== null ? formatDollars(summary.revPerLaborHr) : '—'}
          accentClass="bg-[hsl(var(--labor-balanced))]"
          sparkClass="text-[hsl(var(--labor-balanced))]"
          sub="per hour worked"
          spark={series.map((p) => (p.laborHours > 0 ? p.sales / p.laborHours : null))}
        />
        <KpiTile
          label="Net sales"
          value={formatDollars(summary.sales)}
          accentClass="bg-[hsl(var(--labor-balanced))]"
          sparkClass="text-[hsl(var(--labor-balanced))]"
          sub={rangeCaption}
          spark={series.map((p) => p.sales)}
        />
        <KpiTile
          label="Labor $"
          value={formatDollars(summary.laborCost)}
          accentClass="bg-[hsl(var(--labor-over))]"
          sparkClass="text-[hsl(var(--labor-over))]"
          sub={overBudget !== null ? (overBudget > 0 ? `${formatDollars(overBudget)} over budget` : 'on budget') : undefined}
          spark={series.map((p) => p.laborCost)}
        />
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

      {topFindings.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
          <div>
            <h2 className="text-[13px] font-semibold text-foreground">What to do about it</h2>
            <p className="text-[12px] text-muted-foreground">Auto-flagged from your clock-ins vs. sales.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {topFindings.map((finding) => (
              <LaborFindingCard key={finding.title} finding={finding} />
            ))}
          </div>
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
