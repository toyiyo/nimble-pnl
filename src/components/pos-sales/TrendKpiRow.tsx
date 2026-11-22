import { memo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import type { KpiDelta, SalesTrendsKpis } from '@/lib/salesTrends';

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
          {loading ? <Skeleton className="h-3 w-16" /> : delta && <DeltaLine delta={delta} countUnit={countUnit} />}
        </dd>
      )}
    </div>
  );
}

function DeltaLine({ delta, countUnit }: Readonly<{ delta: KpiDelta; countUnit?: string }>) {
  if (delta.percent === null) {
    return <span className="text-muted-foreground">No prior sales</span>;
  }
  const up = delta.change > 0;
  const down = delta.change < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const tone = up ? 'text-success-strong' : down ? 'text-destructive' : 'text-muted-foreground';
  const sign = up ? '+' : down ? '-' : '';
  const percentText = `${sign}${Math.abs(delta.percent).toFixed(1)}%`;
  const visible = countUnit
    ? `${sign}${Math.abs(delta.change).toLocaleString()} ${countUnit}`
    : percentText;
  const direction = up ? 'up' : down ? 'down' : 'unchanged';
  const srText = countUnit
    ? `${direction} ${Math.abs(delta.change).toLocaleString()} ${countUnit}, ${Math.abs(delta.percent).toFixed(1)} percent, versus prior period`
    : `${direction} ${Math.abs(delta.percent).toFixed(1)} percent versus prior period`;
  return (
    <span className={`inline-flex items-center gap-0.5 ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
