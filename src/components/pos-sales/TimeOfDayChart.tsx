import { memo, useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { HourlySeriesRowWithPrior } from '@/lib/salesTrends';

import { formatHour } from './salesTrendsFormat';
import { buildPosChartConfig } from './chartConfig';
import { DashedSwatch, PRIOR_LABEL } from './SalesByDayChart';

interface TimeOfDayChartProps {
  data: HourlySeriesRowWithPrior[];
  /** Show the prior series. */
  showPrior?: boolean;
  /** The factor that scales the prior hour totals to the days of this period. 1 means no scale. */
  priorScale?: number;
  posSystems: string[];
  ariaLabel: string;
}

export function buildHourlyPriorAriaLabel(base: string, hasPrior: boolean, priorScale: number): string {
  if (!hasPrior) return base;
  const scaled = priorScale === 1 ? '' : ' The previous period is scaled to the days of this period.';
  return `${base} ${PRIOR_LABEL} shown dashed.${scaled}`;
}

/**
 * Revenue by hour-of-day (stacked bars, one per POS) with a cumulative-%
 * overlay line on a second right-hand axis. Two `yAxisId`s are required —
 * omitting the split axes/`domain` collapses both series onto one scale
 * (design §4.2 FE major). The optional prior series is a dashed line on the
 * revenue axis.
 */
export const TimeOfDayChart = memo(function TimeOfDayChart({
  data,
  showPrior,
  priorScale = 1,
  posSystems,
  ariaLabel,
}: TimeOfDayChartProps) {
  const hasPrior = !!showPrior && data.some((row) => row.prior != null);
  const config = useMemo(() => {
    const base = buildPosChartConfig(posSystems);
    base.cumulativePct = { label: 'Cumulative %', color: 'hsl(var(--foreground))' };
    if (!hasPrior) return base;
    const label = priorScale === 1 ? PRIOR_LABEL : `${PRIOR_LABEL} (scaled)`;
    return { ...base, prior: { label, color: 'hsl(var(--muted-foreground))', icon: DashedSwatch } };
  }, [posSystems, hasPrior, priorScale]);
  const label = useMemo(() => buildHourlyPriorAriaLabel(ariaLabel, hasPrior, priorScale), [ariaLabel, hasPrior, priorScale]);

  return (
    <div role="img" aria-label={label}>
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
          {hasPrior && (
            <Line
              yAxisId="rev"
              dataKey="prior"
              name="prior"
              type="monotone"
              stroke="var(--color-prior)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
            />
          )}
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="cumulativePct"
            stroke="var(--color-cumulativePct)"
            strokeWidth={2}
            dot={false}
          />
          {hasPrior && <ChartLegend content={<ChartLegendContent />} />}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
});
