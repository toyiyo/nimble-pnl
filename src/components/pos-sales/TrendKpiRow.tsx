import { memo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import type { KpiDelta, SalesTrendsKpis } from '@/lib/salesTrends';
import { cn } from '@/lib/utils';

import { formatCurrency, formatHour, formatShortDate } from './salesTrendsFormat';

export interface TrendKpiDeltas {
  netSales?: KpiDelta;
  orders?: KpiDelta;
  avgOrder?: KpiDelta;
}

interface TrendKpiRowProps {
  kpis: SalesTrendsKpis;
  /** Prior-period deltas. Busiest day and Peak hour get none. */
  deltas?: TrendKpiDeltas;
  deltasLoading?: boolean;
}

/** KPI strip above the four charts — net sales, orders, avg order, busiest day, peak hour. */
export const TrendKpiRow = memo(function TrendKpiRow({ kpis, deltas, deltasLoading }: TrendKpiRowProps) {
  return (
    <dl aria-label="Sales trend summary" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <KpiTile label="Net sales" value={formatCurrency(kpis.netSales)} delta={deltas?.netSales} loading={deltasLoading} />
      <KpiTile
        label="Orders"
        value={kpis.orders.toLocaleString()}
        delta={deltas?.orders}
        loading={deltasLoading}
        countUnit="orders"
      />
      <KpiTile label="Avg order" value={formatCurrency(kpis.avgOrder)} delta={deltas?.avgOrder} loading={deltasLoading} />
      <KpiTile label="Busiest day" value={kpis.busiestDay ? formatShortDate(kpis.busiestDay.date) : '—'} />
      <KpiTile label="Peak hour" value={kpis.peakHour ? formatHour(kpis.peakHour.hour) : '—'} />
    </dl>
  );
});

interface KpiTileProps {
  label: string;
  value: string;
  delta?: KpiDelta;
  loading?: boolean;
  /** When set, the delta shows as a count change, for example "+5 orders". */
  countUnit?: string;
}

function KpiTile({ label, value, delta, loading, countUnit }: Readonly<KpiTileProps>) {
  const hasDeltaSlot = delta !== undefined || loading === true;
  return (
    <div className="space-y-0.5">
      <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{label}</dt>
      <dd className="text-[22px] font-semibold text-foreground tabular-nums">{value}</dd>
      {hasDeltaSlot && (
        <dd className="min-h-[16px] text-[12px] tabular-nums">
          {loading && <Skeleton className="h-3 w-16" />}
          {!loading && delta && <DeltaLine delta={delta} countUnit={countUnit} />}
        </dd>
      )}
    </div>
  );
}

type DeltaDirection = 'up' | 'down' | 'flat';

const DELTA_STYLE: Record<DeltaDirection, { Icon: typeof Minus; tone: string; sign: string; word: string }> = {
  up: { Icon: ArrowUpRight, tone: 'text-success-strong', sign: '+', word: 'up' },
  down: { Icon: ArrowDownRight, tone: 'text-destructive-strong', sign: '-', word: 'down' },
  flat: { Icon: Minus, tone: 'text-muted-foreground', sign: '', word: 'unchanged' },
};

/** A percent change under this value rounds to 0.0 and shows as flat. */
const FLAT_PERCENT_THRESHOLD = 0.05;

/** A count tile shows flat only when the count does not change. */
function deltaDirection(change: number, percent: number, isCount: boolean): DeltaDirection {
  const isFlat = isCount ? change === 0 : Math.abs(percent) < FLAT_PERCENT_THRESHOLD;
  if (isFlat) return 'flat';
  return change > 0 ? 'up' : 'down';
}

function DeltaLine({ delta, countUnit }: Readonly<{ delta: KpiDelta; countUnit?: string }>) {
  if (delta.percent === null) {
    return <span className="text-muted-foreground">No prior sales</span>;
  }
  const direction = deltaDirection(delta.change, delta.percent, countUnit !== undefined);
  const { Icon, tone, sign, word } = DELTA_STYLE[direction];
  const percent = Math.abs(delta.percent).toFixed(1);
  const percentText = `${sign}${percent}%`;
  const count = Math.abs(delta.change).toLocaleString();
  const showCount = countUnit !== undefined && direction !== 'flat';
  const visible = showCount ? `${sign}${count} ${countUnit}` : percentText;
  const srText = showCount
    ? `${word} ${count} ${countUnit}, ${percent} percent, versus previous period`
    : `${word} ${percent} percent versus previous period`;
  return (
    <span className={cn('inline-flex items-center gap-0.5', tone)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
