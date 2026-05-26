import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, CircleCheck, CircleMinus, CircleX, Target } from 'lucide-react';
import type { MonthlyProgress, MonthlyProgressStatus } from '@/lib/monthlyBreakEvenProgress';
import { cn } from '@/lib/utils';

interface MonthlyBreakEvenStripProps {
  readonly progress: MonthlyProgress | null;
  readonly isLoading: boolean;
}

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface StripStatusConfig {
  Icon: typeof CircleCheck;
  iconClass: string;
  bgClass: string;
  badgeClass: string;
  fillClass: string;
  label: string;
}

function getStripStatusConfig(
  status: Exclude<MonthlyProgressStatus, 'no_target'>,
): StripStatusConfig {
  switch (status) {
    case 'ahead':
      return {
        Icon: CircleCheck,
        iconClass: 'text-green-600 dark:text-green-400',
        bgClass: 'border-green-200 dark:border-green-900',
        badgeClass:
          'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
        fillClass: 'bg-green-500 dark:bg-green-600',
        label: 'Ahead',
      };
    case 'on_pace':
      return {
        Icon: CircleMinus,
        iconClass: 'text-yellow-600 dark:text-yellow-400',
        bgClass: 'border-yellow-200 dark:border-yellow-900',
        badgeClass:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
        fillClass: 'bg-yellow-500 dark:bg-yellow-600',
        label: 'On pace',
      };
    case 'behind':
      return {
        Icon: CircleX,
        iconClass: 'text-red-600 dark:text-red-400',
        bgClass: 'border-red-200 dark:border-red-900',
        badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        fillClass: 'bg-red-500 dark:bg-red-600',
        label: 'Behind',
      };
  }
}

export function MonthlyBreakEvenStrip({ progress, isLoading }: MonthlyBreakEvenStripProps) {
  const statusConfig = useMemo(
    () => (progress && progress.status !== 'no_target' ? getStripStatusConfig(progress.status) : null),
    [progress],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  }

  if (!progress || progress.status === 'no_target') {
    return (
      <div className="rounded-xl border border-border/40 bg-background p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Target className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-[13px] text-muted-foreground truncate">
              Set fixed and percentage costs to see monthly break-even progress.
            </p>
          </div>
          <Link
            to="/budget"
            className="inline-flex items-center gap-1 min-h-[24px] px-2 py-1 rounded-md text-[13px] font-medium text-foreground hover:bg-muted transition-colors focus-visible:ring-1 focus-visible:ring-border focus-visible:outline-none"
          >
            Set up costs
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const { Icon, iconClass, bgClass, badgeClass, fillClass, label } = statusConfig!;
  const progressDisplay = Math.max(0, Math.min(100, progress.progressPercent));
  const paceDisplay = Math.max(0, Math.min(100, progress.expectedPercent));
  const ariaLabel = `Monthly break-even progress: ${Math.round(progress.progressPercent)}% — ${label}. Expected by today: ${Math.round(progress.expectedPercent)}%.`;

  return (
    <div className={cn('rounded-xl border bg-background p-4 space-y-3', bgClass)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('h-4 w-4 shrink-0', iconClass)} />
          <p className="text-[14px] font-medium text-foreground truncate">
            Monthly Break-Even · {progress.monthLabel}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            role="status"
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
              badgeClass,
            )}
          >
            {label}
          </span>
          <Link
            to="/budget"
            aria-label="Open Budget page for full break-even view"
            className="inline-flex items-center gap-1 min-h-[24px] px-2 py-1 rounded-md text-[13px] font-medium text-foreground hover:bg-muted transition-colors focus-visible:ring-1 focus-visible:ring-border focus-visible:outline-none"
          >
            Budget
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.progressPercent)}
        aria-label={ariaLabel}
        className="relative h-2 rounded-full bg-muted overflow-visible"
      >
        <div
          className={cn('h-full rounded-full transition-all', fillClass)}
          style={{ width: `${progressDisplay}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute top-[-2px] bottom-[-2px] w-px border-l-2 border-dashed border-foreground/60"
          style={{ left: `${paceDisplay}%` }}
        />
        <span className="sr-only">Expected today: {Math.round(progress.expectedPercent)}%</span>
      </div>

      <p className="text-[12px] text-muted-foreground">
        {formatCurrency(progress.mtdSales)} of {formatCurrency(progress.monthlyBreakEven)}{' '}
        ({Math.round(progress.progressPercent)}%)
        {progress.dailyNeeded > 0 && (
          <>
            {' · '}
            {formatCurrency(progress.dailyNeeded)}/day to hit target
          </>
        )}
      </p>
    </div>
  );
}
