import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { WeekdaySeriesRow } from '@/lib/salesTrends';

import { formatCurrency } from './salesTrendsFormat';

interface WeekdayChartProps {
  data: WeekdaySeriesRow[];
  ariaLabel: string;
}

const CONFIG = { total: { label: 'Revenue', color: 'hsl(var(--chart-1))' } };

/**
 * Horizontal bar chart of revenue by day-of-week, Monday-first. The peak day
 * carries a text "Peak" badge next to its bar (not color-only — design §4.2
 * FE minor, WCAG 1.4.1).
 */
export const WeekdayChart = memo(function WeekdayChart({ data, ariaLabel }: WeekdayChartProps) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <ChartContainer config={CONFIG} className="min-h-[220px] aspect-video w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" tickLine={false} axisLine={false} hide />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />} />
          <Bar dataKey="total" radius={4} label={<PeakLabel data={data} />}>
            {data.map((entry) => (
              <Cell
                key={entry.dow}
                fill={entry.isPeak ? 'hsl(var(--chart-1))' : 'hsl(var(--muted-foreground) / 0.4)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
});

interface RechartsLabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
}

/** Recharts label render-prop: draws a small "Peak" text badge past the bar's end, peak row only. */
function PeakLabel({
  data,
  ...labelProps
}: RechartsLabelProps & { data: WeekdaySeriesRow[] }) {
  const { x = 0, y = 0, width = 0, height = 0, index } = labelProps;
  const entry = index !== undefined ? data[index] : undefined;
  if (!entry?.isPeak) return null;
  return (
    <text x={x + width + 6} y={y + height / 2} dy={4} className="fill-foreground text-[11px] font-medium">
      Peak
    </text>
  );
}
