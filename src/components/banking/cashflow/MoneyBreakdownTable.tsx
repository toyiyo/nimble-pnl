import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { BreakdownRow } from '@/lib/cashflowInsights';

interface MoneyBreakdownTableProps {
  /** Card title: "Money in" or "Money out". */
  title: string;
  total: number;
  /** Label for the first tab: "Source" (money in) or "Recipient" (money out). */
  primaryTabLabel: string;
  primaryRows: BreakdownRow[];
  categoryRows: BreakdownRow[];
  className?: string;
}

type Tab = 'primary' | 'category';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
}

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

/**
 * One breakdown card: a total, an underline tab pair (Source|Category or
 * Recipient|Category), and up to eight rows plus a folded Remaining row.
 * Each row shows a name, a percent, a percent-of-total track, and a
 * right-aligned amount.
 */
export function MoneyBreakdownTable({
  title,
  total,
  primaryTabLabel,
  primaryRows,
  categoryRows,
  className,
}: MoneyBreakdownTableProps) {
  const [tab, setTab] = useState<Tab>('primary');
  const rows = tab === 'primary' ? primaryRows : categoryRows;

  return (
    <div className={cn('rounded-xl border border-border/40 bg-background p-4', className)}>
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        <div className="text-[15px] font-medium text-foreground">{formatCurrency(total)}</div>
      </div>

      <div role="tablist" className="mt-3 flex border-b border-border/40">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'primary'}
          onClick={() => setTab('primary')}
          className={cn(
            'relative px-0 py-2 mr-6 text-[13px] font-medium transition-colors',
            tab === 'primary' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {primaryTabLabel}
          {tab === 'primary' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'category'}
          onClick={() => setTab('category')}
          className={cn(
            'relative px-0 py-2 text-[13px] font-medium transition-colors',
            tab === 'category' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Category
          {tab === 'category' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-[13px] text-foreground">{row.label}</div>
            <div className="w-10 shrink-0 text-right text-[12px] text-muted-foreground">
              {formatPct(row.pctOfTotal)}
            </div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                data-testid={`breakdown-track-${row.label}`}
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, row.pctOfTotal))}%` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right text-[13px] font-medium text-foreground">
              {formatCurrency(row.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
