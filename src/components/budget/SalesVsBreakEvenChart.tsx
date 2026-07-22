import { useId, useMemo, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { format } from 'date-fns';
import { BreakEvenData } from '@/types/operatingCosts';
import { parseLocalDate } from '@/lib/parseLocalDate';
import { deriveWeekdayPattern } from '@/lib/breakEvenInsights';

interface SalesVsBreakEvenChartProps {
  readonly data: BreakEvenData | null;
  readonly isLoading: boolean;
  readonly error?: Error | null;
  readonly actualCOGSPercentage?: number;
  readonly targetCOGSPercentage?: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSignedCurrency(amount: number): string {
  return amount > 0 ? `+${formatCurrency(amount)}` : formatCurrency(amount);
}

// Shared by the verdict strip (net delta) and the tooltip (per-day delta) —
// both color a signed dollar amount the same way: green above break-even,
// red below, neutral at exactly zero.
function signedDeltaColorClass(value: number): string {
  return value > 0 ? 'text-success' : value < 0 ? 'text-destructive' : 'text-foreground';
}

// Finding #5: rounding straight to whole thousands (`${(v/1000).toFixed(0)}k`)
// collapsed visually distinct bars — e.g. $2,512 and $3,350 both landed on a
// tick labeled "$3k". Below $10k this keeps one decimal of resolution so
// nearby ticks stay distinguishable; at/above $10k the extra decimal is noise
// and whole thousands read cleaner.
export function formatYAxisTick(value: number): string {
  const thousands = value / 1000;
  const decimals = Math.abs(value) < 10000 ? 1 : 0;
  return `$${thousands.toFixed(decimals)}k`;
}

interface COGSVariance {
  readonly label: string;
  readonly colorClass: string;
}

// Finding #6: the COGS row printed target and actual side by side and left
// the reader to do the subtraction. This turns that gap into an explicit
// points-vs-target claim — the sign and "over"/"under" wording carry the
// verdict, `text-destructive` only when actual runs over target, so hue
// isn't the only signal (same reasoning as the bar-fill colors in C).
export function formatCOGSVariance(actualPercentage?: number, targetPercentage?: number): COGSVariance | null {
  if (actualPercentage === undefined || targetPercentage === undefined) return null;

  const variance = actualPercentage - targetPercentage;
  if (variance === 0) {
    return { label: 'On target', colorClass: 'text-muted-foreground' };
  }

  const magnitude = Math.abs(variance).toFixed(1);
  return variance > 0
    ? { label: `+${magnitude} pts over target`, colorClass: 'text-destructive' }
    : { label: `${magnitude} pts under target`, colorClass: 'text-success' };
}

interface BarChartEntry {
  readonly date: string;
  readonly sales: number;
  readonly delta: number;
}

// Recharts' per-bar `onClick` hands back computed geometry (x/y/width/height)
// merged onto the original datum — `.payload` is the one guaranteed-untouched
// copy of what this component actually rendered from.
interface BarClickRect {
  readonly payload?: BarChartEntry;
}

// Bar shapes carry no visible text of their own, so this is the only thing a
// screen-reader / keyboard user has to decide whether to activate one.
function getBarAccessibleName(entry: BarChartEntry): string {
  const dateLabel = format(parseLocalDate(entry.date), 'MMM d');
  return `View POS sales for ${dateLabel}: ${formatCurrency(entry.sales)} in sales, ${formatSignedCurrency(entry.delta)} vs break-even`;
}

interface WeekdayAxisTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { value: string };
}

// Recharts' `tickFormatter` returns a single string and can't render two
// lines. The narrow `EEEEE` weekday token also collides Tue/Thu and Sat/Sun
// (both render as a lone "T" / "S"), which defeats the point of labeling the
// axis by weekday at all — so this uses the two-letter `EEEEEE` form and
// renders it as its own line above "MMM d" via stacked <tspan>s.
//
// Parses via the shared `parseLocalDate` (not `parseISO`, which reads bare
// date strings as UTC and can shift the weekday back a day in negative UTC
// offsets) — the same fix applied to `deriveWeekdayPattern`.
function WeekdayAxisTick({ x, y, payload }: WeekdayAxisTickProps) {
  if (!payload?.value) return null;

  const date = parseLocalDate(payload.value);
  const weekday = format(date, 'EEEEEE');
  const monthDay = format(date, 'MMM d');

  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
      <tspan x={x} dy="0.9em" fontWeight={600}>
        {weekday}
      </tspan>
      <tspan x={x} dy="1.1em">
        {monthDay}
      </tspan>
    </text>
  );
}

interface BreakEvenTooltipPayloadEntry {
  readonly payload: {
    date: string;
    sales: number;
    breakEven: number;
    delta: number;
    isPartial: boolean;
  };
}

interface BreakEvenTooltipContentProps {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<BreakEvenTooltipPayloadEntry>;
  readonly label?: string;
}

// Recharts drops `contentStyle` the moment a custom `content` renderer is
// set, so this hand-reproduces the bg-background / border-border/40 /
// rounded-lg card styling used everywhere else in this widget — otherwise
// the tooltip regresses to Recharts' unstyled default box.
export function BreakEvenTooltipContent({ active, payload }: BreakEvenTooltipContentProps) {
  if (!active || !payload?.length) return null;

  const entry = payload[0].payload;
  const deltaColorClass = signedDeltaColorClass(entry.delta);
  const verdictLabel = entry.delta > 0 ? 'Surplus' : entry.delta < 0 ? 'Shortfall' : 'Break-even';

  return (
    <div className="bg-background border border-border/40 rounded-lg px-3 py-2 shadow-sm">
      <p className="text-[12px] font-medium text-foreground mb-1.5">
        {format(parseLocalDate(entry.date), 'MMM d')}
      </p>
      <div className="space-y-0.5">
        <p className="text-[12px] text-muted-foreground">
          Sales <span className="text-foreground font-medium">{formatCurrency(entry.sales)}</span>
        </p>
        <p className="text-[12px] text-muted-foreground">
          Break-even <span className="text-foreground font-medium">{formatCurrency(entry.breakEven)}</span>
        </p>
        {entry.isPartial ? (
          // Today's row is a running partial total, not a graded outcome —
          // the same reasoning that keeps the bar itself off the
          // above/below fill (finding #2). The tooltip must not surface a
          // signed verdict for a day that hasn't finished yet.
          <p className="text-[12px] font-medium text-warning">In progress</p>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {verdictLabel}{' '}
            <span className={`font-medium ${deltaColorClass}`}>{formatSignedCurrency(entry.delta)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function SalesVsBreakEvenChart({ data, isLoading, error, actualCOGSPercentage, targetCOGSPercentage }: SalesVsBreakEvenChartProps) {
  const navigate = useNavigate();
  // Scopes the partial-bar hatch <pattern> id to this instance — the widget
  // mounts on two pages, and a fixed id risks url(#id) collisions between
  // instances.
  const hatchId = useId();

  const chartData = useMemo(() => {
    if (!data?.history) return [];

    return data.history.map((h) => ({
      date: h.date,
      sales: h.sales,
      breakEven: h.breakEven,
      delta: h.delta,
      status: h.status,
      isPartial: h.isPartial,
    }));
  }, [data]);

  // Drives both the click target and the per-bar accessible name — the bar
  // shapes carry no visible text of their own, so this is the only thing a
  // screen-reader user hears before deciding whether to activate one.
  const handleBarClick = (entry: BarChartEntry | undefined) => {
    if (entry?.date) {
      navigate(`/pos-sales?startDate=${entry.date}&endDate=${entry.date}`);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="p-5">
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  // useBreakEvenAnalysis already surfaces `error`; before this branch a
  // fetch/RLS failure fell through to the empty state below and told the
  // owner "Set up your budget" — wrong and alarming. A stale query error can
  // coexist with cached `data`, so this must be checked ahead of the empty
  // and success branches, not only when `data` is missing.
  if (error) {
    return (
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="flex items-center justify-center gap-2 px-5 py-12 text-center">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-[13px] text-muted-foreground">Couldn't load break-even data. Try refreshing the page.</p>
        </div>
      </div>
    );
  }

  if (!data || chartData.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="flex flex-col items-center justify-center py-12 text-center px-5">
          <p className="text-[14px] font-medium text-foreground">No break-even data yet</p>
          <p className="text-[13px] text-muted-foreground mt-1">Set up your budget to see daily sales vs break-even.</p>
        </div>
      </div>
    );
  }

  const breakEvenValue = data.dailyBreakEven;

  const netColorClass = signedDeltaColorClass(data.netDelta);
  const verdictClause =
    data.netDelta > 0
      ? "You're ahead of break-even"
      : data.netDelta < 0
      ? "You're behind break-even"
      : "You're exactly at break-even";
  const periodLabel = `${data.completeDays} complete day${data.completeDays === 1 ? '' : 's'}`;
  const cogsVariance = formatCOGSVariance(actualCOGSPercentage, targetCOGSPercentage);
  const cogsPeriodLabel = `over the last ${chartData.length} day${chartData.length === 1 ? '' : 's'}`;
  const weekdayInsight = deriveWeekdayPattern(data.history);

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div>
          <h3 className="text-[14px] font-medium text-foreground">
            Sales vs Break-Even
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">Last {chartData.length} days</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-success" />
              <span className="text-[11px] text-muted-foreground">Above</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-destructive" />
              <span className="text-[11px] text-muted-foreground">Below</span>
            </div>
          </div>
        </div>
      </div>

      {/* Verdict strip */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-5 py-4 border-b border-border/40">
        <span className={`text-[17px] font-semibold ${netColorClass}`}>
          {formatSignedCurrency(data.netDelta)}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {verdictClause} over the last {periodLabel}
        </span>
      </div>

      {/* Chart */}
      <div className="px-5 pt-4 pb-2">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 12, left: 12, bottom: 4 }}
            >
              <defs>
                {/* Today's bar is a running partial total, not a graded
                    outcome — it gets its own fill, never the above/below
                    status color. `userSpaceOnUse` keeps the hatch density
                    fixed instead of stretching with each bar's width. */}
                <pattern
                  id={hatchId}
                  patternUnits="userSpaceOnUse"
                  width={6}
                  height={6}
                  patternTransform="rotate(45)"
                >
                  <rect width={6} height={6} fill="hsl(var(--warning))" />
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={6}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                    strokeOpacity={0.6}
                  />
                </pattern>
              </defs>
              <XAxis
                dataKey="date"
                tick={<WeekdayAxisTick />}
                tickLine={false}
                axisLine={false}
                height={36}
                interval={0}
              />
              <YAxis
                tickFormatter={formatYAxisTick}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip content={<BreakEvenTooltipContent />} />
              <ReferenceLine
                y={breakEvenValue}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                label={{
                  value: `Break-even: ${formatCurrency(breakEvenValue)}`,
                  position: 'insideTopRight',
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 11,
                }}
              />
              <Bar
                dataKey="sales"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                isAnimationActive={false}
                // `data` here is Recharts' computed rect (x/y/width/height
                // merged onto the datum) — `.payload` is the untouched
                // original row, same reasoning as the tooltip/Cell above.
                onClick={(barEntry: BarClickRect) => handleBarClick(barEntry?.payload)}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      // isPartial branches BEFORE status: today's row keeps
                      // whatever status classifyDelta computed for it (other
                      // consumers read that field), but the bar itself must
                      // never render the above/below fill for a day that
                      // hasn't finished yet — regardless of how deep the
                      // running delta currently reads.
                      entry.isPartial
                        ? `url(#${hatchId})`
                        : entry.status === 'above'
                        ? 'hsl(var(--success))'
                        : entry.status === 'below'
                        ? 'hsl(var(--destructive))'
                        : 'hsl(var(--warning))'
                    }
                    fillOpacity={0.85}
                    // `<Bar onClick>` alone is mouse/touch-only — Recharts
                    // emits plain SVG shapes with no tabIndex/role/key
                    // handling. These props flow through Cell onto the same
                    // <path> Recharts renders for the bar (Cell is a props
                    // carrier, not a DOM node of its own), making each bar an
                    // independently focusable, activatable control.
                    tabIndex={0}
                    role="button"
                    aria-label={getBarAccessibleName(entry)}
                    className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onKeyDown={(event: KeyboardEvent<SVGElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleBarClick(entry);
                      }
                    }}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Finding #3 / memory/lessons.md 2026-07-22: a derived sentence
            good enough to be an aria-label is good enough to be on screen —
            rendered as visible copy, never sr-only. Hidden entirely (not
            just visually) when there isn't enough data to support a claim. */}
        {weekdayInsight && (
          <p className="text-[12.5px] leading-snug text-muted-foreground mt-3">{weekdayInsight}</p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-px bg-border/40 border-t border-border/40">
        <div className="bg-background p-3 text-center">
          <p className="text-[16px] font-semibold text-success">{data.daysAbove}</p>
          <p className="text-[11px] text-muted-foreground">Days above</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[16px] font-semibold text-destructive">{data.daysBelow}</p>
          <p className="text-[11px] text-muted-foreground">Days below</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[14px] font-semibold text-success">
            {data.avgSurplus > 0 ? `+${formatCurrency(data.avgSurplus)}` : '-'}
          </p>
          <p className="text-[11px] text-muted-foreground">Avg surplus</p>
        </div>
        <div className="bg-background p-3 text-center">
          <p className="text-[14px] font-semibold text-destructive">
            {data.avgShortfall < 0 ? formatCurrency(data.avgShortfall) : '-'}
          </p>
          <p className="text-[11px] text-muted-foreground">Avg shortfall</p>
        </div>
      </div>

      {/* COGS target vs actual comparison */}
      {(actualCOGSPercentage !== undefined || targetCOGSPercentage !== undefined) && (
        <div className="grid grid-cols-2 gap-px bg-border/40 border-t border-border/40">
          <div className="bg-background p-3 text-center">
            <p className="text-[14px] font-semibold text-foreground">
              {targetCOGSPercentage === undefined ? '-' : `${targetCOGSPercentage.toFixed(1)}%`}
            </p>
            <p className="text-[11px] text-muted-foreground">Target COGS %</p>
          </div>
          <div className="bg-background p-3 text-center">
            <p className={`text-[14px] font-semibold ${
              actualCOGSPercentage !== undefined && targetCOGSPercentage !== undefined && actualCOGSPercentage > targetCOGSPercentage
                ? 'text-destructive' : 'text-success'
            }`}>
              {actualCOGSPercentage === undefined ? '-' : `${actualCOGSPercentage.toFixed(1)}%`}
            </p>
            <p className="text-[11px] text-muted-foreground">Actual COGS %</p>
          </div>
          <div className="col-span-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-background px-3 py-2 border-t border-border/40">
            {cogsVariance && (
              <span className={`text-[12px] font-medium ${cogsVariance.colorClass}`}>{cogsVariance.label}</span>
            )}
            <span className="text-[11px] text-muted-foreground">{cogsPeriodLabel}</span>
          </div>
        </div>
      )}

      <div className="px-5 py-2 border-t border-border/40">
        <p className="text-[11px] text-muted-foreground text-center">
          Click any bar (or focus it and press Enter) to view POS sales for that day
        </p>
      </div>
    </div>
  );
}
