import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { FinancialPoint, LaborGranularity } from '@/lib/laborPnlAnalytics';
import { LaborBalanceRibbon } from './LaborBalanceRibbon';

interface DemandVsStaffingChartProps {
  readonly points: readonly FinancialPoint[];
  /** `staffing_settings.target_labor_pct` — the `ReferenceLine` on the bottom chart. */
  readonly targetPct: number;
  readonly granularity: LaborGranularity;
}

export interface DemandVsStaffingChartDatum {
  bucketStart: string;
  label: string;
  sales: number;
  laborPct: number | null;
}

/**
 * Describes the bucket unit shown along the shared x-axis, keyed by the
 * page's Day/Week/Month toggle — design §5: "hour-of-day (Day), day (Week),
 * week (Month)". Used only for the chart's accessible name.
 */
const GRANULARITY_VIEW_LABEL: Record<LaborGranularity, string> = {
  day: 'hourly',
  week: 'daily',
  month: 'weekly',
};

/** Pure transform: FinancialPoint[] -> Recharts-ready data shared by both
 * stacked charts. Preserves null `laborPct` entries (rather than filtering
 * them out) so the x-axis stays aligned across the sales area, the ribbon,
 * and the labor-% line — the `<Line connectNulls={false}>` on the bottom
 * chart is what turns those nulls into a visual gap instead of a lie (no
 * interpolated segment), mirroring `SplhTimelineChart.buildSplhChartData`. */
export function buildDemandVsStaffingChartData(
  points: readonly FinancialPoint[],
): DemandVsStaffingChartDatum[] {
  return points.map((point) => ({
    bucketStart: point.bucketStart,
    label: point.label,
    sales: point.sales,
    laborPct: point.laborPct,
  }));
}

/** Pure formatter for the labor-% tooltip value row. */
export function formatLaborPctTooltipValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

const tooltipContentStyle = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '13px',
};

/**
 * The signature demand-vs-staffing chart (design §2.2/§7): two stacked
 * Recharts sharing one x-axis — net-sales area on top, labor-% line +
 * target `ReferenceLine` below — with the `LaborBalanceRibbon` sandwiched
 * between them. Deliberately **not** a dual-axis single chart: the
 * codebase's own target-vs-actual precedent (`SplhTimelineChart`) uses
 * single-axis + `ReferenceLine`, and a dual axis whose scales can be tuned
 * to imply correlation is exactly the #611-lesson failure mode this design
 * calls out (§7) — highest-risk here because the whole point is to
 * correlate sales and labor. Single y-axis per chart.
 *
 * Renders nothing for an empty `points` array (mirrors
 * `LaborBalanceRibbon`'s own empty guard) — the `/labor` page (E2) owns the
 * full loading/error/empty states (design §6) and only mounts this once
 * there's a non-empty series to show.
 */
export function DemandVsStaffingChart({ points, targetPct, granularity }: DemandVsStaffingChartProps) {
  const chartData = useMemo(() => buildDemandVsStaffingChartData(points), [points]);

  if (chartData.length === 0) return null;

  return (
    <div
      role="img"
      aria-label={`Net sales versus labor percent against a ${targetPct}% target, ${GRANULARITY_VIEW_LABEL[granularity]} view`}
      className="space-y-2"
    >
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 0 }}>
            <XAxis dataKey="label" hide />
            <YAxis
              tickFormatter={(v: number) => `$${v}`}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Net sales']}
              labelFormatter={(label) => label}
              contentStyle={tooltipContentStyle}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="hsl(var(--foreground))"
              fill="hsl(var(--foreground))"
              fillOpacity={0.12}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <LaborBalanceRibbon points={points} />

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 12, bottom: 4 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              // Extend the auto domain to always include `targetPct` —
              // otherwise Recharts' default ReferenceLine
              // `ifOverflow="discard"` silently drops the target line
              // whenever every actual labor-% point falls on one side of it
              // (the common case), mirroring SplhTimelineChart's YAxis.
              domain={[
                (min: number) => Math.min(min, targetPct),
                (max: number) => Math.max(max, targetPct),
              ]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(value: number | null) => [formatLaborPctTooltipValue(value), 'Labor %']}
              labelFormatter={(label) => label}
              contentStyle={tooltipContentStyle}
            />
            <ReferenceLine
              y={targetPct}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: `Target ${targetPct}%`,
                position: 'insideTopRight',
                fill: 'hsl(var(--muted-foreground))',
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey="laborPct"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
