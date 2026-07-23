import { memo, useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { HourlySeriesRow } from '@/lib/salesTrends';

import { formatHour } from './salesTrendsFormat';
import { buildPosChartConfig } from './chartConfig';

interface TimeOfDayChartProps {
  data: HourlySeriesRow[];
  posSystems: string[];
  ariaLabel: string;
}

/**
 * Revenue by hour-of-day (stacked bars, one per POS) with a cumulative-%
 * overlay line on a second right-hand axis. Two `yAxisId`s are required —
 * omitting the split axes/`domain` collapses both series onto one scale
 * (design §4.2 FE major).
 */
export const TimeOfDayChart = memo(function TimeOfDayChart({ data, posSystems, ariaLabel }: TimeOfDayChartProps) {
  const config = useMemo(() => {
    const base = buildPosChartConfig(posSystems);
    base.cumulativePct = { label: 'Cumulative %', color: 'hsl(var(--foreground))' };
    return base;
  }, [posSystems]);

  return (
    <div role="img" aria-label={ariaLabel}>
      <ChartContainer config={config} className="min-h-[220px] aspect-video w-full">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={formatHour} />
          <YAxis yAxisId="rev" tickLine={false} axisLine={false} width={48} />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                // Read the hour off the data row, not the tooltip's resolved
                // `label`: shadcn only passes the x value through when it is a
                // string, and our `hour` axis is numeric, so `label` falls back
                // to the first series' config label ("Focus") — `Number("Focus")`
                // is NaN, which rendered as "NaNPM".
                labelFormatter={(_label, payload) => {
                  const hour = payload?.[0]?.payload?.hour;
                  return typeof hour === 'number' ? formatHour(hour) : '';
                }}
              />
            }
          />
          {posSystems.map((pos) => (
            <Bar key={pos} yAxisId="rev" dataKey={pos} stackId="hour" fill={`var(--color-${pos})`} />
          ))}
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="cumulativePct"
            stroke="var(--color-cumulativePct)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
});
