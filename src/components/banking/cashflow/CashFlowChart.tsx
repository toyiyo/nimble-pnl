import { useEffect, useId, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Layer, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from 'recharts';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  bucketSeries,
  buildSankey,
  computeTotals,
  defaultInterval,
  formatCompactCurrency,
  formatCurrency,
  isInternalTransfer,
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

const MONEY_IN_COLOR = 'hsl(var(--success))';
const MONEY_OUT_COLOR = 'hsl(var(--destructive))';
const SANKEY_NODE_LABEL_MAX = 22;

const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Split a 'yyyy-MM-dd' bucket key. The key names a calendar day, not an
 * instant, so no Date object and no timezone is involved.
 */
function splitBucketKey(bucketStart: string): { year: number; month: number; day: number } {
  const [year, month, day] = bucketStart.split('-').map(Number);
  return { year, month, day };
}

/** Short axis label for a bucket: 'Aug 4' for day and week, 'Aug' for month. */
function formatBucketTick(bucketStart: string, interval: Interval): string {
  const { month, day } = splitBucketKey(bucketStart);
  if (interval === 'month') return MONTH_SHORT[month - 1];
  return `${MONTH_SHORT[month - 1]} ${day}`;
}

/** Full tooltip label for a bucket: the day, the week start, or the month. */
function formatBucketLabel(bucketStart: string, interval: Interval): string {
  const { year, month, day } = splitBucketKey(bucketStart);
  if (interval === 'month') return `${MONTH_LONG[month - 1]} ${year}`;
  const dayLabel = `${MONTH_SHORT[month - 1]} ${day}, ${year}`;
  return interval === 'week' ? `Week of ${dayLabel}` : dayLabel;
}

interface LegendItem {
  name: string;
  color: string;
}

/** A row of color chips that names each series in the active chart. */
function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

interface SankeyNodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { name: string; value?: number; targetLinks?: number[] };
}

/**
 * One Sankey node with its label. A sink node (no outgoing links) sits in
 * the last column. Its label anchors to the left of the bar, so long payee
 * names stay inside the chart.
 */
function SankeyNode(props: SankeyNodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  // Recharts fills `targetLinks` with the outgoing link indices. A sink
  // node has none, so it sits in the last column.
  const isRightSide = (payload?.targetLinks?.length ?? 0) === 0;
  const textX = isRightSide ? x - 6 : x + width + 6;
  const anchor = isRightSide ? 'end' : 'start';

  const name = payload?.name ?? '';
  const label = name.length > SANKEY_NODE_LABEL_MAX ? `${name.slice(0, SANKEY_NODE_LABEL_MAX - 1)}…` : name;

  return (
    <Layer>
      <rect x={x} y={y} width={width} height={height} fill="hsl(var(--chart-2))" rx={2} />
      <text x={textX} y={y + height / 2} dy={-1} fontSize={12} textAnchor={anchor} fill="hsl(var(--foreground))">
        {label}
      </text>
      {payload?.value !== undefined && (
        <text x={textX} y={y + height / 2} dy={12} fontSize={11} textAnchor={anchor} fill="hsl(var(--muted-foreground))">
          {formatCurrency(payload.value)}
        </text>
      )}
    </Layer>
  );
}

/**
 * The Cash Flow chart panel: Flow (Sankey), By category (stacked bars),
 * and In vs out (paired bars). Each mode carries an accessible name and a
 * visible caption wired with `aria-describedby`. Internal transfers stay
 * hidden until the user picks "All cashflow".
 */
export function CashFlowChart({ rows, period, className }: CashFlowChartProps) {
  const captionId = useId();
  const [mode, setMode] = useState<ChartMode>('flow');
  const [filter, setFilter] = useState<CashflowFilter>('exclude-transfers');
  const [interval, setIntervalValue] = useState<Interval>(() => defaultInterval(period));

  // The default interval depends on the period length. Re-derive it whenever
  // the period changes, so a longer or shorter range gets the right bucket
  // size even after the user has manually picked one for a prior period.
  useEffect(() => {
    setIntervalValue(defaultInterval(period));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.from.getTime(), period.to.getTime()]);

  const filteredRows = useMemo(
    () => (filter === 'exclude-transfers' ? rows.filter((row) => !isInternalTransfer(row)) : rows),
    [rows, filter],
  );

  const totals = useMemo(() => computeTotals(filteredRows), [filteredRows]);
  const sankeyData = useMemo(() => buildSankey(filteredRows), [filteredRows]);
  const series = useMemo(() => bucketSeries(filteredRows, period, interval), [filteredRows, period, interval]);
  const categories = useMemo(() => topCategories(filteredRows), [filteredRows]);
  // The top-5-plus-Other category set, computed once across the whole
  // period. Buckets must fold into this same set, or a category outside
  // the top 5 renders no Bar and silently drops from the stacked chart.
  const topCategoryNames = useMemo(
    () => new Set(categories.filter((category) => category.name !== 'Other').map((category) => category.name)),
    [categories],
  );

  const categoryChartData = useMemo(
    () =>
      series.map((bucket) => {
        // Every category gets an explicit 0. The sign stack offset turns a
        // missing key into NaN and then draws no bar at all.
        const point: Record<string, string | number> = { bucketStart: bucket.bucketStart, Other: 0 };
        for (const name of topCategoryNames) point[name] = 0;
        for (const [name, amount] of Object.entries(bucket.byCategory)) {
          if (topCategoryNames.has(name)) {
            point[name] = amount;
          } else {
            point['Other'] = (point['Other'] as number) + amount;
          }
        }
        return point;
      }),
    [series, topCategoryNames],
  );
  const inOutChartData = useMemo(
    () => series.map((bucket) => ({ bucketStart: bucket.bucketStart, moneyIn: bucket.moneyIn, moneyOut: bucket.moneyOut })),
    [series],
  );

  const categoryLegend = useMemo<LegendItem[]>(
    () => categories.map((category, index) => ({ name: category.name, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] })),
    [categories],
  );
  const inOutLegend: LegendItem[] = [
    { name: 'Money in', color: MONEY_IN_COLOR },
    { name: 'Money out', color: MONEY_OUT_COLOR },
  ];

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
            <SelectItem value="exclude-transfers">Excludes transfers</SelectItem>
            <SelectItem value="all">All cashflow</SelectItem>
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

      <div role="img" aria-label={ariaLabel} aria-describedby={captionId} className="h-[300px]">
        {mode === 'flow' && (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankeyData}
              node={<SankeyNode />}
              link={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.25 }}
              nodePadding={28}
              nodeWidth={8}
              margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
            >
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => formatCurrency(value)} />
            </Sankey>
          </ResponsiveContainer>
        )}

        {mode === 'category' && (
          <ResponsiveContainer width="100%" height="100%">
            {/* stackOffset="sign" stacks the inflows up and the outflows down.
                The default offset overlaps mixed-sign segments. */}
            <BarChart data={categoryChartData} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="bucketStart"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(value: string) => formatBucketTick(value, interval)}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={['auto', 'auto']}
                tickFormatter={(value: number) => formatCompactCurrency(value)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(value: string) => formatBucketLabel(value, interval)}
                formatter={(value: number) => formatCurrency(value)}
              />
              {categories.map((category, index) => (
                <Bar
                  key={category.name}
                  dataKey={category.name}
                  stackId="categories"
                  maxBarSize={28}
                  fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {mode === 'inout' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inOutChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="bucketStart"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(value: string) => formatBucketTick(value, interval)}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(value: number) => formatCompactCurrency(value)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(value: string) => formatBucketLabel(value, interval)}
                formatter={(value: number) => formatCurrency(value)}
              />
              {/* The mount animation can complete with zero geometry and leave
                  the chart blank. Render the bars without animation. */}
              <Bar name="Money in" dataKey="moneyIn" fill={MONEY_IN_COLOR} maxBarSize={20} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar name="Money out" dataKey="moneyOut" fill={MONEY_OUT_COLOR} maxBarSize={20} radius={[0, 0, 3, 3]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {mode === 'category' && <ChartLegend items={categoryLegend} />}
      {mode === 'inout' && <ChartLegend items={inOutLegend} />}

      <p id={captionId} className="text-[13px] text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}
