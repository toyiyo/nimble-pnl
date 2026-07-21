import { memo } from 'react';

import type { SalesTrendsKpis } from '@/lib/salesTrends';

import { formatCurrency, formatHour, formatShortDate } from './salesTrendsFormat';

interface TrendKpiRowProps {
  kpis: SalesTrendsKpis;
}

/** KPI strip above the four charts — net sales, orders, avg order, busiest day, peak hour. */
export const TrendKpiRow = memo(function TrendKpiRow({ kpis }: TrendKpiRowProps) {
  return (
    <dl aria-label="Sales trend summary" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <KpiTile label="Net sales" value={formatCurrency(kpis.netSales)} />
      <KpiTile label="Orders" value={kpis.orders.toLocaleString()} />
      <KpiTile label="Avg order" value={formatCurrency(kpis.avgOrder)} />
      <KpiTile label="Busiest day" value={kpis.busiestDay ? formatShortDate(kpis.busiestDay.date) : '—'} />
      <KpiTile label="Peak hour" value={kpis.peakHour ? formatHour(kpis.peakHour.hour) : '—'} />
    </dl>
  );
});

function KpiTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{label}</dt>
      <dd className="text-[22px] font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
