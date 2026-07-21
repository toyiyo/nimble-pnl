import { memo } from 'react';

import type { SalesTrendsKpis } from '@/lib/salesTrends';

import { formatCurrency, formatHour, formatShortDate } from './salesTrendsFormat';

interface TrendKpiRowProps {
  kpis: SalesTrendsKpis;
}

/** KPI strip above the four charts — net sales, orders, avg order, busiest day, peak hour. */
export const TrendKpiRow = memo(function TrendKpiRow({ kpis }: TrendKpiRowProps) {
  return (
    <div role="group" aria-label="Sales trend summary" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <KpiTile label="Net sales" value={formatCurrency(kpis.netSales)} />
      <KpiTile label="Orders" value={kpis.orders.toLocaleString()} />
      <KpiTile label="Avg order" value={formatCurrency(kpis.avgOrder)} />
      <KpiTile label="Busiest day" value={kpis.busiestDay ? formatShortDate(kpis.busiestDay.date) : '—'} />
      <KpiTile label="Peak hour" value={kpis.peakHour ? formatHour(kpis.peakHour.hour) : '—'} />
    </div>
  );
});

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-[22px] font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
