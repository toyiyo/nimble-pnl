import { cn } from '@/lib/utils';
import { formatCurrency, type CashFlowTotals } from '@/lib/cashflowInsights';

interface CashFlowHeadlineProps {
  totals: CashFlowTotals;
  className?: string;
}

/** Net cashflow, Money in, and Money out for the selected period. */
export function CashFlowHeadline({ totals, className }: CashFlowHeadlineProps) {
  const isNegative = totals.net < 0;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-8 gap-y-2', className)}>
      {/* `role="group"` plus `aria-label` gives each stat an accessible name, so
          a test can scope to it with `getByRole('group', { name: ... })` instead
          of walking the DOM. */}
      <div role="group" aria-label="Net cashflow">
        <div className="text-[13px] text-muted-foreground">Net cashflow</div>
        <div
          className={cn(
            'text-[28px] font-semibold tracking-tight',
            isNegative ? 'text-destructive' : 'text-foreground'
          )}
        >
          {formatCurrency(totals.net)}
        </div>
      </div>
      <div role="group" aria-label="Money in">
        <div className="text-[13px] text-muted-foreground">Money in</div>
        <div className="text-[15px] font-medium text-foreground">{formatCurrency(totals.moneyIn)}</div>
      </div>
      <div role="group" aria-label="Money out">
        <div className="text-[13px] text-muted-foreground">Money out</div>
        <div className="text-[15px] font-medium text-foreground">
          {formatCurrency(Math.abs(totals.moneyOut))}
        </div>
      </div>
    </div>
  );
}
