import { memo, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { posLabel } from '@/lib/posColors';
import type { DailySeriesRow } from '@/lib/salesTrends';

import { formatShortDate } from './salesTrendsFormat';
import { buildPosChartConfig } from './chartConfig';

interface SalesByDayChartProps {
  data: DailySeriesRow[];
  posSystems: string[];
  ariaLabel: string;
}

/**
 * Stacked bar chart of revenue by calendar day, one `<Bar>` per POS system
 * sharing `stackId="day"` (else Recharts groups instead of stacks — design
 * §4.2 FE major). Wrapped in `role="img"` with `ariaLabel` (reused from
 * `deriveInsights`) so the visual and the accessible name stay in sync.
 */
export const SalesByDayChart = memo(function SalesByDayChart({ data, posSystems, ariaLabel }: SalesByDayChartProps) {
  const config = useMemo(() => buildPosChartConfig(posSystems), [posSystems]);

  return (
    <div role="img" aria-label={ariaLabel}>
      <ChartContainer config={config} className="min-h-[220px] aspect-video w-full">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: string) => formatShortDate(value)}
          />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => formatShortDate(String(v))} />} />
          {posSystems.map((pos) => (
            <Bar key={pos} dataKey={pos} stackId="day" fill={`var(--color-${pos})`} name={posLabel(pos)} />
          ))}
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>
    </div>
  );
});
