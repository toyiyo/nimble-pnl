import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, parseISO } from 'date-fns';
import { SplhPoint } from '@/lib/splhAnalytics';

interface SplhTimelineChartProps {
  readonly points: SplhPoint[];
  readonly target: number;
  readonly granularity: 'day' | 'week';
}

export interface SplhChartDatum {
  date: string;
  dateLabel: string;
  splh: number | null;
  totalSales: number;
  totalHours: number;
}

/** Pure transform: SplhPoint[] -> Recharts-ready data. Preserves null `splh`
 * entries (rather than filtering them out) so the x-axis stays aligned to
 * every bucket in the window; the <Line connectNulls={false}> is what turns
 * those nulls into a visual gap instead of a lie (no interpolated segment). */
export function buildSplhChartData(points: SplhPoint[], granularity: 'day' | 'week'): SplhChartDatum[] {
  return points.map((point) => ({
    date: point.bucketStart,
    dateLabel: format(parseISO(point.bucketStart), granularity === 'week' ? 'MMM d' : 'MMM d'),
    splh: point.splh,
    totalSales: point.totalSales,
    totalHours: point.totalHours,
  }));
}

/** Pure formatter for the tooltip value row. */
export function formatSplhTooltipValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value}/labor-hr`;
}

export function SplhTimelineChart({ points, target, granularity }: SplhTimelineChartProps) {
  const chartData = useMemo(() => buildSplhChartData(points, granularity), [points, granularity]);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            // Extend the auto domain to always include `target` — otherwise
            // Recharts' default ReferenceLine `ifOverflow="discard"` silently
            // drops the target line whenever every actual SPLH point falls
            // on one side of it (the common case).
            domain={[(min: number) => Math.min(min, target), (max: number) => Math.max(max, target)]}
            tickFormatter={(v: number) => `$${v}`}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value: number | null) => [formatSplhTooltipValue(value), 'SPLH']}
            labelFormatter={(label) => label}
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '13px',
            }}
          />
          <ReferenceLine
            y={target}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{
              value: `Target $${target}`,
              position: 'insideTopRight',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 11,
            }}
          />
          <Line
            type="monotone"
            dataKey="splh"
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
