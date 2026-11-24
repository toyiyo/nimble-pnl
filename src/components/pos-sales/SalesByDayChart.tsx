import { memo, useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { posLabel } from '@/lib/posColors';
import type { DailySeriesRowWithPrior } from '@/lib/salesTrends';

import { formatCurrency, formatShortDate } from './salesTrendsFormat';
import { buildPosChartConfig } from './chartConfig';
import { DashedSwatch, PRIOR_LABEL } from './priorSeries';

interface SalesByDayChartProps {
  data: DailySeriesRowWithPrior[];
  /** Show the prior series. */
  showPrior?: boolean;
  /** Net sales of the full prior period. The panel computes it. Rows pair by index, so they can drop prior days. */
  priorTotal?: number;
  posSystems: string[];
  ariaLabel: string;
}

/** Up to this many days the prior series is a bar. Above it, a dashed line. */
export const PRIOR_BAR_MAX_DAYS = 14;

const CURRENT_LABEL = 'This period';

// One tooltip row. It fills the row width, so the swatch, the label, and the value stay on one line.
function TooltipRow({ label, value, color, strong }: Readonly<{ label: string; value: string; color?: string; strong?: boolean }>) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="flex flex-1 justify-between gap-4">
        <span className={strong ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
      </span>
    </div>
  );
}

// The prior row comes with the day total of this period, so the user can compare the two totals.
function PriorTooltipRows({ value, row, color }: Readonly<{ value: number; row?: DailySeriesRowWithPrior; color?: string }>) {
  return (
    <div className="grid w-full gap-1.5 border-t border-border/50 pt-1.5">
      <TooltipRow label={CURRENT_LABEL} value={formatCurrency(row?.total ?? 0)} strong />
      <TooltipRow label={PRIOR_LABEL} value={formatPriorTooltip(value, row)} color={color} strong />
    </div>
  );
}

// Tooltip formatter. Show the prior row with its date and the current total. Show the other rows as currency.
export function renderTooltipRow(value: ValueType, name: NameType, item?: { color?: string; payload?: unknown }) {
  if (name === 'prior') {
    return (
      <PriorTooltipRows
        value={Number(value)}
        row={item?.payload as DailySeriesRowWithPrior | undefined}
        color={item?.color}
      />
    );
  }
  return <TooltipRow label={String(name)} value={formatCurrency(Number(value))} color={item?.color} />;
}

// Put the prior row last, under the POS rows.
export function priorLastSorter(item: { name?: unknown }): number {
  return item.name === 'prior' ? 1 : 0;
}

export function buildPriorAriaLabel(
  base: string,
  data: DailySeriesRowWithPrior[],
  showPrior: boolean,
  priorTotal: number | undefined,
): string {
  if (!showPrior || priorTotal === undefined || !data.some((row) => row.prior != null)) return base;
  const current = data.reduce((sum, row) => sum + (row.total ?? 0), 0);
  return `${base} This period ${formatCurrency(current)} total. ${PRIOR_LABEL} ${formatCurrency(priorTotal)} total, shown dashed.`;
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
export const SalesByDayChart = memo(function SalesByDayChart({ data, showPrior, priorTotal, posSystems, ariaLabel }: SalesByDayChartProps) {
  const hasPrior = !!showPrior && data.some((row) => row.prior != null);
  const priorAsBar = data.length <= PRIOR_BAR_MAX_DAYS;
  const config = useMemo(() => {
    const base = buildPosChartConfig(posSystems);
    if (!hasPrior) return base;
    return { ...base, prior: { label: PRIOR_LABEL, color: 'hsl(var(--muted-foreground))', icon: DashedSwatch } };
  }, [posSystems, hasPrior]);
  const label = useMemo(() => buildPriorAriaLabel(ariaLabel, data, hasPrior, priorTotal), [ariaLabel, data, hasPrior, priorTotal]);

  return (
    <div role="img" aria-label={label}>
      <ChartContainer config={config} className="min-h-[220px] aspect-video w-full">
        <ComposedChart data={data} barGap={2} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            itemSorter={priorLastSorter}
            content={
              <ChartTooltipContent
                labelFormatter={(v) => formatShortDate(String(v))}
                formatter={renderTooltipRow}
              />
            }
          />
          {/* The prior bar comes first, so it sits to the left of the current stack. */}
          {hasPrior && priorAsBar && (
            <Bar
              dataKey="prior"
              name="prior"
              fill="var(--color-prior)"
              fillOpacity={0.15}
              stroke="var(--color-prior)"
              strokeOpacity={1}
              strokeDasharray="3 3"
              radius={[2, 2, 0, 0]}
            />
          )}
          {posSystems.map((pos) => (
            <Bar key={pos} dataKey={pos} stackId="day" fill={`var(--color-${pos})`} name={posLabel(pos)} />
          ))}
          {hasPrior && !priorAsBar && (
            <Line
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
          <ChartLegend content={<ChartLegendContent />} />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
});
