import { memo, useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { posLabel } from '@/lib/posColors';
import type { DailySeriesRowWithPrior } from '@/lib/salesTrends';

import { formatCurrency, formatShortDate } from './salesTrendsFormat';
import { buildPosChartConfig } from './chartConfig';

interface SalesByDayChartProps {
  data: DailySeriesRowWithPrior[];
  /** Show the prior series. */
  showPrior?: boolean;
  posSystems: string[];
  ariaLabel: string;
}

/** Up to this many days the prior series is a bar. Above it, a dashed line. */
export const PRIOR_BAR_MAX_DAYS = 14;

export function buildPriorAriaLabel(base: string, data: DailySeriesRowWithPrior[], showPrior: boolean): string {
  if (!showPrior || !data.some((row) => row.prior != null)) return base;
  const current = data.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const prior = data.reduce((sum, row) => sum + (row.prior ?? 0), 0);
  return `${base} Current period total ${formatCurrency(current)}. Prior period total ${formatCurrency(prior)}.`;
}

export function formatPriorTooltip(value: number, row?: DailySeriesRowWithPrior): string {
  const amount = formatCurrency(value);
  return row?.priorDate ? `${amount} (${formatShortDate(row.priorDate)})` : amount;
}

/**
 * Stacked bar chart of revenue by calendar day, one `<Bar>` per POS system
 * sharing `stackId="day"` (else Recharts groups instead of stacks — design
 * §4.2 FE major). Wrapped in `role="img"` with `ariaLabel` (reused from
 * `deriveInsights`) so the visual and the accessible name stay in sync.
 */
export const SalesByDayChart = memo(function SalesByDayChart({ data, showPrior, posSystems, ariaLabel }: SalesByDayChartProps) {
  const hasPrior = !!showPrior && data.some((row) => row.prior != null);
  const priorAsBar = data.length <= PRIOR_BAR_MAX_DAYS;
  const config = useMemo(() => {
    const base = buildPosChartConfig(posSystems);
    if (hasPrior) {
      base.prior = {
        label: 'Prior period',
        color: 'hsl(var(--muted-foreground))',
        icon: () => (
          <svg width="14" height="2" aria-hidden="true">
            <line x1="0" y1="1" x2="14" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
          </svg>
        ),
      };
    }
    return base;
  }, [posSystems, hasPrior]);
  const label = useMemo(() => buildPriorAriaLabel(ariaLabel, data, hasPrior), [ariaLabel, data, hasPrior]);

  return (
    <div role="img" aria-label={label}>
      <ChartContainer config={config} className="min-h-[220px] aspect-video w-full">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: string) => formatShortDate(value)}
          />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => formatShortDate(String(v))}
                formatter={(value, name, item) =>
                  name === 'prior' ? (
                    <span className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">Prior period</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatPriorTooltip(Number(value), item?.payload as DailySeriesRowWithPrior)}
                      </span>
                    </span>
                  ) : (
                    <span className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">{posLabel(String(name))}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">{formatCurrency(Number(value))}</span>
                    </span>
                  )
                }
              />
            }
          />
          {posSystems.map((pos) => (
            <Bar key={pos} dataKey={pos} stackId="day" fill={`var(--color-${pos})`} name={posLabel(pos)} />
          ))}
          {hasPrior && priorAsBar && (
            <Bar dataKey="prior" name="prior" fill="var(--color-prior)" fillOpacity={0.35} />
          )}
          {hasPrior && !priorAsBar && (
            <Line
              dataKey="prior"
              name="prior"
              type="monotone"
              stroke="var(--color-prior)"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
            />
          )}
          <ChartLegend content={<ChartLegendContent />} />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
});
