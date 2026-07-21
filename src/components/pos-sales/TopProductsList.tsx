import { memo } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

import { posColor, posLabel } from '@/lib/posColors';
import type { PosFilter, TopProductRow } from '@/lib/salesTrends';
import type { POSSystemType } from '@/types/pos';

import { formatCurrency } from './salesTrendsFormat';

interface TopProductsListProps {
  products: TopProductRow[];
  /**
   * Current segmented-control selection. `buildTopProducts` merges revenue
   * across POS systems when `activePos === 'all'`, so an individual product
   * row has no single accurate POS to badge in that case — the badge is
   * only shown when the data is already scoped to one system (the filter
   * itself, since `filterByPos` runs before `buildTopProducts`).
   */
  activePos: PosFilter;
  ariaLabel: string;
}

/** Top-N product list: item, revenue, share-of-revenue bar, mini sparkline. */
export const TopProductsList = memo(function TopProductsList({ products, activePos, ariaLabel }: TopProductsListProps) {
  if (products.length === 0) {
    return <p className="text-[13px] text-muted-foreground py-6 text-center">No product sales in this range.</p>;
  }

  const maxRevenue = Math.max(...products.map((p) => p.revenue));

  return (
    <div role="img" aria-label={ariaLabel}>
      <ul className="space-y-2.5">
        {products.map((product) => (
          <li key={product.item_name} className="flex items-center gap-3">
            {activePos !== 'all' && (
              <span className="inline-flex items-center gap-1 shrink-0 text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: posColor(activePos as POSSystemType) }}
                  aria-hidden="true"
                />
                {posLabel(activePos as POSSystemType)}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-foreground truncate">{product.item_name}</span>
                <span className="text-[13px] font-medium text-foreground tabular-nums shrink-0">
                  {formatCurrency(product.revenue)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground/70"
                  style={{ width: `${maxRevenue > 0 ? (product.revenue / maxRevenue) * 100 : 0}%` }}
                />
              </div>
            </div>
            <MiniSparkline points={product.sparkline} />
          </li>
        ))}
      </ul>
    </div>
  );
});

const MiniSparkline = memo(function MiniSparkline({ points }: { points: TopProductRow['sparkline'] }) {
  if (points.length < 2) return <div className="w-12 h-5 shrink-0" aria-hidden="true" />;
  return (
    <div className="w-12 h-5 shrink-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <Line type="monotone" dataKey="value" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
