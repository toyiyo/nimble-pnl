import { useId, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Layer, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from 'recharts';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  bucketSeries,
  buildSankey,
  computeTotals,
  defaultInterval,
  topCategories,
  type CashFlowPeriod,
  type CashFlowRow,
  type Interval,
} from '@/lib/cashflowInsights';

interface CashFlowChartProps {
  rows: CashFlowRow[];
  period: CashFlowPeriod;
  className?: string;
}

type ChartMode = 'flow' | 'category' | 'inout';
type CashflowFilter = 'all' | 'exclude-transfers';

const MODE_LABELS: Record<ChartMode, string> = {
  flow: 'Flow',
  category: 'By category',
  inout: 'In vs out',
};

const CATEGORY_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--muted-foreground))',
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; payload?: { name: string } }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  return (
    <Layer>
      <rect x={x} y={y} width={width} height={height} fill="hsl(var(--chart-2))" rx={2} />
      <text x={x + width + 6} y={y + height / 2} dy={4} fontSize={12} fill="hsl(var(--foreground))">
        {payload?.name}
      </text>
    </Layer>
  );
}

/**
 * The Cash Flow chart panel: Flow (Sankey), By category (stacked bars),
 * and In vs out (paired bars). Each mode carries an accessible name and a
 * visible caption wired with `aria-describedby`.
 */
export function CashFlowChart({ rows, period, className }: CashFlowChartProps) {
  const captionId = useId();
  const [mode, setMode] = useState<ChartMode>('flow');
  const [filter, setFilter] = useState<CashflowFilter>('all');
  const [interval, setIntervalValue] = useState<Interval>(() => defaultInterval(period));

  const filteredRows = useMemo(
    () => (filter === 'exclude-transfers' ? rows.filter((row) => !row.is_transfer) : rows),
    [rows, filter],
  );

  const totals = useMemo(() => computeTotals(filteredRows), [filteredRows]);
  const sankeyData = useMemo(() => buildSankey(filteredRows), [filteredRows]);
  const series = useMemo(() => bucketSeries(filteredRows, period, interval), [filteredRows, period, interval]);
  const categories = useMemo(() => topCategories(filteredRows), [filteredRows]);

  const categoryChartData = useMemo(
    () => series.map((bucket) => ({ bucketStart: bucket.bucketStart, ...bucket.byCategory })),
    [series],
  );
  const inOutChartData = useMemo(
    () => series.map((bucket) => ({ bucketStart: bucket.bucketStart, moneyIn: bucket.moneyIn, moneyOut: bucket.moneyOut })),
    [series],
  );

  const modeLabel = MODE_LABELS[mode];
  const ariaLabel = `${modeLabel} view of cash flow, net ${formatCurrency(totals.net)}`;
  const caption = `${modeLabel} view: money in ${formatCurrency(totals.moneyIn)}, money out ${formatCurrency(
    Math.abs(totals.moneyOut),
  )}, net ${formatCurrency(totals.net)}.`;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select name="cashflow-filter" value={filter} onValueChange={(value) => setFilter(value as CashflowFilter)}>
          <SelectTrigger aria-label="Cashflow filter" className="h-9 w-[168px] text-[13px] bg-muted/30 border-border/40 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cashflow</SelectItem>
            <SelectItem value="exclude-transfers">Exclude transfers</SelectItem>
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => value && setMode(value as ChartMode)}
          aria-label="Chart mode"
        >
          <ToggleGroupItem value="flow" aria-label="Flow">
            Flow
          </ToggleGroupItem>
          <ToggleGroupItem value="category" aria-label="By category">
            By category
          </ToggleGroupItem>
          <ToggleGroupItem value="inout" aria-label="In vs out">
            In vs out
          </ToggleGroupItem>
        </ToggleGroup>

        {mode !== 'flow' && (
          <Select name="interval" value={interval} onValueChange={(value) => setIntervalValue(value as Interval)}>
            <SelectTrigger aria-label="Interval" className="h-9 w-[104px] text-[13px] bg-muted/30 border-border/40 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div role="img" aria-label={ariaLabel} aria-describedby={captionId} className="h-[280px]">
        {mode === 'flow' && (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankeyData}
              node={<SankeyNode />}
              link={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
              nodePadding={24}
              nodeWidth={10}
            />
          </ResponsiveContainer>
        )}

        {mode === 'category' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="bucketStart" tick={{ fill: 'hsl(var(--muted-foreground))' }} className="text-xs" />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              {categories.map((category, index) => (
                <Bar
                  key={category.name}
                  dataKey={category.name}
                  stackId="categories"
                  fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {mode === 'inout' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inOutChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="bucketStart" tick={{ fill: 'hsl(var(--muted-foreground))' }} className="text-xs" />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Bar dataKey="moneyIn" fill="hsl(var(--success))" />
              <Bar dataKey="moneyOut" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <p id={captionId} className="text-[13px] text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}
