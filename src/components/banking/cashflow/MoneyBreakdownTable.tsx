import { useId, useState } from 'react';

import { cn } from '@/lib/utils';
import { formatCurrency, type BreakdownRow } from '@/lib/cashflowInsights';

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

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  controls: string;
  className?: string;
}

/** One underline tab button, shared by the primary and Category tabs. */
function TabButton({ label, active, onClick, controls, className }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        'relative px-0 py-2 text-[13px] font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {label}
      {active && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
    </button>
  );
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
  const baseId = useId();
  const panelId = `${baseId}-panel`;

  return (
    <div className={cn('rounded-xl border border-border/40 bg-background p-4', className)}>
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        <div className="text-[15px] font-medium text-foreground">{formatCurrency(Math.abs(total))}</div>
      </div>

      <div role="tablist" className="mt-3 flex border-b border-border/40">
        <TabButton
          label={primaryTabLabel}
          active={tab === 'primary'}
          onClick={() => setTab('primary')}
          controls={panelId}
          className="mr-6"
        />
        <TabButton
          label="Category"
          active={tab === 'category'}
          onClick={() => setTab('category')}
          controls={panelId}
        />
      </div>

      <div id={panelId} role="tabpanel" className="mt-3 space-y-3">
        {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No activity for this period.</p>}
        {/* Native `ul`/`li` keep the list semantics, so a test can find one
            row with `getByRole('listitem', { name: ... })` instead of a
            data-testid. */}
        <ul className="list-none space-y-3 p-0 m-0">
          {rows.map((row) => (
            <li key={row.label} aria-label={row.label} className="flex items-center gap-3">
              <div title={row.label} className="w-40 shrink-0 truncate text-[13px] text-foreground">
                {row.label}
              </div>
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
                {formatCurrency(Math.abs(row.amount))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
