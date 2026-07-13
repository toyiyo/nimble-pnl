import { useMemo } from 'react';

import { Link, useNavigate } from 'react-router-dom';

import { AlertCircle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';

import { useSplhSummary } from '@/hooks/useSplhSummary';
import { verdictToneColor, type SplhPoint } from '@/lib/splhAnalytics';

// Re-exported for this module's own tests — the implementation lives in
// `@/lib/splhAnalytics` so this card and the Scheduling panel's
// `LaborEfficiencyPanel` share one tone->color mapping.
export { verdictToneColor };

interface LaborEfficiencyCardProps {
  readonly restaurantId: string | null;
}

export interface SparklineDatum {
  date: string;
  splh: number | null;
}

/**
 * Pure: `SplhPoint[]` -> minimal Recharts-ready sparkline data. Preserves
 * null `splh` entries (rather than filtering them out) so `connectNulls=false`
 * shows a visual gap for hours with no labor logged instead of interpolating
 * across them — same rule as `SplhTimelineChart.buildSplhChartData`.
 */
export function buildSparklineData(points: SplhPoint[]): SparklineDatum[] {
  return points.map((point) => ({ date: point.bucketStart, splh: point.splh }));
}

/**
 * Dashboard "Labor efficiency" card: hero actual-vs-target SPLH, labor % of
 * sales, a tone-colored verdict, a compact daily SPLH sparkline, and a "View
 * in Scheduling" link. Composes `useSplhSummary` — this component owns no
 * data fetching itself, only the three loading/error/empty states and
 * layout (design §7.3, plan Task 13). The outer "Labor efficiency" section
 * heading + collapsible trigger live in the page that mounts this card
 * (`Index.tsx`, plan Task 15), matching the Cashflow-block convention.
 */
export function LaborEfficiencyCard({ restaurantId }: LaborEfficiencyCardProps) {
  const navigate = useNavigate();
  const { summary, sparkline, target, isLoading, isError, hasData, refetch } = useSplhSummary(restaurantId);
  const sparklineData = useMemo(() => buildSparklineData(sparkline), [sparkline]);

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
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <span>Failed to load labor efficiency data.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-1 text-[13px] font-medium text-foreground underline"
            aria-label="Retry loading labor efficiency data"
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
          Connect your POS and make sure staff are clocking in to see labor efficiency.
        </p>
        <Link
          to="/integrations"
          className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Connect your POS
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[28px] font-semibold text-foreground">
          {summary.actualSplh !== null ? `$${summary.actualSplh}` : '—'}
        </span>
        <span className="text-[13px] text-muted-foreground shrink-0">vs ${target} target</span>
      </div>
      {summary.laborPct !== null && (
        <p className="text-[13px] text-muted-foreground">Labor {summary.laborPct}% of sales</p>
      )}
      <p
        className="text-[13px] font-medium text-muted-foreground"
        style={{ color: verdictToneColor(summary.verdictTone) }}
      >
        {summary.verdict}
      </p>
      {sparklineData.length > 0 && (
        <div className="h-12" role="img" aria-label="Daily SPLH trend sparkline">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <Line
                type="monotone"
                dataKey="splh"
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
      <button
        type="button"
        onClick={() => navigate('/scheduling')}
        className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        View in Scheduling →
      </button>
    </div>
  );
}
