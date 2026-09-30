import { memo, useMemo } from 'react';

import { Link } from 'react-router-dom';

import { AlertCircle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';

import { cn } from '@/lib/utils';
import { useLaborPnlSummary } from '@/hooks/useLaborPnlSummary';
import { balanceStateClassName, type FinancialPoint } from '@/lib/laborPnlAnalytics';

interface LaborPnlCardProps {
  readonly restaurantId: string | null;
}

export interface LaborSparklineDatum {
  date: string;
  laborPct: number | null;
}

/**
 * Pure: `FinancialPoint[]` -> minimal Recharts-ready sparkline data.
 * Preserves `null` `laborPct` entries (rather than filtering them out) so
 * `connectNulls={false}` shows a visual gap for no-sales days instead of
 * interpolating across them — the daily labor-% trend already *is* the
 * sales-vs-labor read (design §2.1: `laborPct = laborCost ÷ sales`), same
 * rule as `LaborEfficiencyCard.buildSparklineData`.
 */
export function buildLaborSparklineData(points: readonly FinancialPoint[]): LaborSparklineDatum[] {
  return points.map((point) => ({ date: point.bucketStart, laborPct: point.laborPct }));
}

/**
 * Pure: the screen reader text for the sparkline. A chart with no values in
 * its name tells a screen reader user nothing, so name the first and the
 * last day with a value.
 */
export function buildSparklineLabel(data: readonly LaborSparklineDatum[]): string {
  const withValues = data.filter((point) => point.laborPct !== null);
  if (withValues.length === 0) return 'Daily labor % of sales trend. No days with sales.';
  const first = withValues[0];
  const last = withValues[withValues.length - 1];
  return `Daily labor % of sales trend for ${data.length} days: ${first.laborPct}% on the first day with sales, ${last.laborPct}% on the last.`;
}

/**
 * Dashboard "Labor cost" card: hero labor-% of sales vs. target, revenue per
 * labor hour, a tone-colored verdict, a compact daily labor-% sparkline, and
 * an "Open labor detail" link to `/labor`. Composes `useLaborPnlSummary` —
 * this component owns no data fetching itself, only the three loading/error/
 * empty states and layout (design §2.1, plan Task E1), mirroring
 * `LaborEfficiencyCard`'s structure for the scheduling surface. Distinct
 * financial `--labor-*` tone tokens (never `--splh-lean/slack`) per design §7.
 */
function LaborPnlCardBase({ restaurantId }: LaborPnlCardProps) {
  const { summary, sparkline, targetPct, isLoading, isError, hasData, refetch } = useLaborPnlSummary(restaurantId);
  const sparklineData = useMemo(() => buildLaborSparklineData(sparkline), [sparkline]);
  const toneClass = balanceStateClassName(summary.verdictTone);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-destructive-strong shrink-0" />
          <span>Failed to load labor cost data.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-1 text-[13px] font-medium text-foreground underline"
            aria-label="Retry loading labor cost data"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4 text-center space-y-2">
        <p className="text-[13px] text-muted-foreground">
          Connect your POS and make sure staff are clocking in to see labor cost against sales.
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
    <div className="rounded-xl border border-border/40 bg-background p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-[28px] font-semibold', toneClass || 'text-foreground')}>
          {summary.laborPct !== null ? `${summary.laborPct}%` : '—'}
        </span>
        <span className="text-[13px] text-muted-foreground shrink-0">vs {targetPct}% target</span>
      </div>
      {summary.revPerLaborHr !== null && (
        <p className="text-[13px] text-muted-foreground">${summary.revPerLaborHr}/labor-hour</p>
      )}
      <p className={cn('text-[13px] font-medium text-muted-foreground', toneClass)}>{summary.verdict}</p>
      {sparklineData.length > 0 && (
        <div className="h-12" role="img" aria-label={buildSparklineLabel(sparklineData)}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <Line
                type="monotone"
                dataKey="laborPct"
                stroke="hsl(var(--foreground))"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <Link
        to="/labor"
        className="inline-flex min-h-6 items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open labor detail →
      </Link>
    </div>
  );
}

export const LaborPnlCard = memo(LaborPnlCardBase);
