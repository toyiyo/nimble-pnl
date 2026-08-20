import { cn } from '@/lib/utils';
import type { CashFlowTotals } from '@/lib/cashflowInsights';

interface CashFlowHeadlineProps {
  totals: CashFlowTotals;
  className?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Net cashflow, Money in, and Money out for the selected period. */
export function CashFlowHeadline({ totals, className }: CashFlowHeadlineProps) {
  const isNegative = totals.net < 0;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-8 gap-y-2', className)}>
      <div>
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
      <div>
        <div className="text-[13px] text-muted-foreground">Money in</div>
        <div className="text-[15px] font-medium text-foreground">{formatCurrency(totals.moneyIn)}</div>
      </div>
      <div>
        <div className="text-[13px] text-muted-foreground">Money out</div>
        <div className="text-[15px] font-medium text-foreground">
          {formatCurrency(Math.abs(totals.moneyOut))}
        </div>
      </div>
    </div>
  );
}
