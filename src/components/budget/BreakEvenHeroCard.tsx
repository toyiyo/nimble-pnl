import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CircleCheck, CircleMinus, CircleX, TrendingUp, TrendingDown } from 'lucide-react';
import { BreakEvenData } from '@/types/operatingCosts';
import { cn } from '@/lib/utils';

interface BreakEvenHeroCardProps {
  data: BreakEvenData | null;
  isLoading: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function BreakEvenHeroCard({ data, isLoading }: BreakEvenHeroCardProps) {
  const statusConfig = useMemo(() => {
    if (!data) return null;
    
    switch (data.todayStatus) {
      case 'above':
        return {
          icon: CircleCheck,
          iconClass: 'text-green-600 dark:text-green-400',
          bgClass: 'from-green-50/50 via-background to-green-50/30 dark:from-green-950/20 dark:via-background dark:to-green-950/10',
          borderClass: 'border-green-200 dark:border-green-900',
          badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
          label: 'Above break-even',
          deltaIcon: TrendingUp,
        };
      case 'at':
        return {
          icon: CircleMinus,
          iconClass: 'text-yellow-600 dark:text-yellow-400',
          bgClass: 'from-yellow-50/50 via-background to-yellow-50/30 dark:from-yellow-950/20 dark:via-background dark:to-yellow-950/10',
          borderClass: 'border-yellow-200 dark:border-yellow-900',
          badgeClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
          label: 'At break-even',
          deltaIcon: CircleMinus,
        };
      case 'below':
        return {
          icon: CircleX,
          iconClass: 'text-red-600 dark:text-red-400',
          bgClass: 'from-red-50/50 via-background to-red-50/30 dark:from-red-950/20 dark:via-background dark:to-red-950/10',
          borderClass: 'border-red-200 dark:border-red-900',
          badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
          label: 'Below break-even',
          deltaIcon: TrendingDown,
        };
    }
  }, [data]);

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 via-background to-muted/20">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="pt-4">
          <Skeleton className="h-16 w-48 mb-4" />
          <Skeleton className="h-5 w-64" />
        </CardContent>
      </Card>
    );
  }

  if (!data || !statusConfig) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 via-background to-muted/20">
        <CardHeader>
          <CardTitle className="text-xl">Daily Break-Even</CardTitle>
          <CardDescription>
            Set up your operating costs to see your daily break-even target
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Add your fixed costs (rent, insurance) and variable costs (food %, labor %) to calculate your daily break-even point.
          </p>
        </CardContent>
      </Card>
    );
  }

  const StatusIcon = statusConfig.icon;
  const DeltaIcon = statusConfig.deltaIcon;

  return (
    <Card className={cn('bg-gradient-to-br', statusConfig.bgClass, statusConfig.borderClass)}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn('h-5 w-5', statusConfig.iconClass)} />
          <CardTitle className="text-xl">Daily Break-Even</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {/* Main break-even number */}
        <div className="mb-6">
          <div className="text-5xl font-bold tracking-tight text-foreground">
            {formatCurrency(data.dailyBreakEven)}
            <span className="text-xl font-normal text-muted-foreground ml-2">/ day</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Your average cost to keep the business running
          </p>
        </div>
        
        {/* Today's comparison */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Today's sales: <span className="font-semibold text-foreground">{formatCurrency(data.todaySales)}</span>
          </div>
          
          <div className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium', statusConfig.badgeClass)}>
            <DeltaIcon className="h-4 w-4" />
            {statusConfig.label} ({data.todayDelta >= 0 ? '+' : ''}{formatCurrency(data.todayDelta)})
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
