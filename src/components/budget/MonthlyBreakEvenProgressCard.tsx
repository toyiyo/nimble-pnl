import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CircleCheck, CircleMinus, CircleX, Target, TrendingUp, TrendingDown } from 'lucide-react';
import type { MonthlyProgress, MonthlyProgressStatus } from '@/lib/monthlyBreakEvenProgress';
import { cn } from '@/lib/utils';

interface MonthlyBreakEvenProgressCardProps {
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

interface StatusConfig {
  Icon: typeof CircleCheck;
  iconClass: string;
  bgClass: string;
  borderClass: string;
  badgeClass: string;
  fillClass: string;
  label: string;
  DeltaIcon: typeof CircleCheck;
}

function getStatusConfig(status: Exclude<MonthlyProgressStatus, 'no_target'>): StatusConfig {
  switch (status) {
    case 'ahead':
      return {
        Icon: CircleCheck,
        iconClass: 'text-green-600 dark:text-green-400',
        bgClass:
          'from-green-50/50 via-background to-green-50/30 dark:from-green-950/20 dark:via-background dark:to-green-950/10',
        borderClass: 'border-green-200 dark:border-green-900',
        badgeClass:
          'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
        fillClass: 'bg-green-500 dark:bg-green-600',
        label: 'Ahead of pace',
        DeltaIcon: TrendingUp,
      };
    case 'on_pace':
      return {
        Icon: CircleMinus,
        iconClass: 'text-yellow-600 dark:text-yellow-400',
        bgClass:
          'from-yellow-50/50 via-background to-yellow-50/30 dark:from-yellow-950/20 dark:via-background dark:to-yellow-950/10',
        borderClass: 'border-yellow-200 dark:border-yellow-900',
        badgeClass:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
        fillClass: 'bg-yellow-500 dark:bg-yellow-600',
        label: 'On pace',
        DeltaIcon: CircleMinus,
      };
    case 'behind':
      return {
        Icon: CircleX,
        iconClass: 'text-red-600 dark:text-red-400',
        bgClass:
          'from-red-50/50 via-background to-red-50/30 dark:from-red-950/20 dark:via-background dark:to-red-950/10',
        borderClass: 'border-red-200 dark:border-red-900',
        badgeClass:
          'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        fillClass: 'bg-red-500 dark:bg-red-600',
        label: 'Behind pace',
        DeltaIcon: TrendingDown,
      };
  }
}

export function MonthlyBreakEvenProgressCard({
  progress,
  isLoading,
}: MonthlyBreakEvenProgressCardProps) {
  const statusConfig = useMemo(
    () => (progress && progress.status !== 'no_target' ? getStatusConfig(progress.status) : null),
    [progress],
  );

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 via-background to-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-3 w-full" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!progress || progress.status === 'no_target') {
    return (
      <Card className="bg-gradient-to-br from-muted/30 via-background to-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-[17px] font-semibold text-foreground">
              Monthly Break-Even Progress
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">
            Add your fixed and variable costs above to see how this month is tracking toward your
            break-even target.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { Icon, iconClass, bgClass, borderClass, badgeClass, fillClass, label, DeltaIcon } =
    statusConfig!;

  const progressDisplay = Math.max(0, Math.min(100, progress.progressPercent));
  const paceDisplay = Math.max(0, Math.min(100, progress.expectedPercent));
  const ariaLabel = `Monthly break-even progress: ${Math.round(progress.progressPercent)}% — ${label}. Expected by today: ${Math.round(progress.expectedPercent)}%.`;

  const projectionPositive = progress.projectedDelta >= 0;
  const projectionText = projectionPositive
    ? `Trending toward ${formatCurrency(progress.projectedMonthly)} by month-end — ${formatCurrency(Math.abs(progress.projectedDelta))} above target.`
    : `Trending toward ${formatCurrency(progress.projectedMonthly)} by month-end — ${formatCurrency(Math.abs(progress.projectedDelta))} below target.`;

  return (
    <Card className={cn('bg-gradient-to-br', bgClass, borderClass)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={cn('h-5 w-5', iconClass)} />
            <div>
              <CardTitle className="text-[17px] font-semibold text-foreground">
                Monthly Break-Even Progress
              </CardTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {progress.monthLabel} · Day {progress.dayOfMonth} of {progress.daysInMonth}
              </p>
            </div>
          </div>
          <div
            role="status"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium',
              badgeClass,
            )}
          >
            <DeltaIcon className="h-4 w-4" />
            {label}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-5">
        {/* Headline numbers */}
        <div>
          <p className="text-2xl font-bold tracking-tight text-foreground">
            {formatCurrency(progress.mtdSales)}
            <span className="text-[13px] font-medium text-muted-foreground ml-2">
              of {formatCurrency(progress.monthlyBreakEven)} needed
            </span>
          </p>
        </div>

        {/* Progress bar with pace marker */}
        <div className="space-y-2">
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.progressPercent)}
            aria-label={ariaLabel}
            className="relative h-3 rounded-full bg-muted overflow-visible"
          >
            {/* Fill */}
            <div
              className={cn('h-full rounded-full transition-all', fillClass)}
              style={{ width: `${progressDisplay}%` }}
            />
            {/* Pace marker */}
            <div
              aria-hidden="true"
              className="absolute top-[-3px] bottom-[-3px] w-px border-l-2 border-dashed border-foreground/60"
              style={{ left: `${paceDisplay}%` }}
            />
            <span className="sr-only">
              Expected today: {Math.round(progress.expectedPercent)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{Math.round(progress.progressPercent)}% complete</span>
            <span>Expected today: {Math.round(progress.expectedPercent)}%</span>
          </div>
        </div>

        {/* Three-stat row */}
        <div className="grid grid-cols-3 gap-px bg-border/40 rounded-lg overflow-hidden border border-border/40">
          <div className="bg-background p-3 text-center">
            <p className="text-2xl font-bold tracking-tight text-foreground">
              {formatCurrency(progress.amountRemaining)}
            </p>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
              Still needed
            </p>
          </div>
          <div className="bg-background p-3 text-center">
            <p className="text-2xl font-bold tracking-tight text-foreground">
              {progress.daysRemaining}
            </p>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
              {progress.daysRemaining === 1 ? 'Day left' : 'Days left'}
            </p>
          </div>
          <div className="bg-background p-3 text-center">
            <p className="text-2xl font-bold tracking-tight text-foreground">
              {formatCurrency(progress.dailyNeeded)}
            </p>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
              Per day to hit
            </p>
          </div>
        </div>

        {/* Projection sentence */}
        <p
          className={cn(
            'text-[13px]',
            projectionPositive
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-700 dark:text-red-400',
          )}
        >
          {projectionText}
        </p>
      </CardContent>
    </Card>
  );
}
