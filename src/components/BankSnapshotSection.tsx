import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useLiquidityMetrics } from '@/hooks/useLiquidityMetrics';
import { useCashFlowMetrics } from '@/hooks/useCashFlowMetrics';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { endOfDay, startOfMonth } from 'date-fns';
import { formatRunwayDays } from '@/lib/formatRunway';
import { getRunwayWindow } from '@/lib/cashRunway';

interface BankSnapshotSectionProps {
  restaurantId: string;
}

export function BankSnapshotSection({ restaurantId }: BankSnapshotSectionProps) {
  // Use fixed date ranges for current state
  const today = endOfDay(new Date());
  const monthStart = startOfMonth(today);
  const todayKey = today.toISOString().slice(0, 10);
  const runwayWindow = useMemo(() => getRunwayWindow(new Date()), [todayKey]);

  // Fetch connected banks
  const { data: connectedBanks, isLoading: banksLoading } = useConnectedBanks(restaurantId);

  // Fetch liquidity metrics for runway, over the last 30 days
  const { data: liquidityMetrics, isLoading: liquidityLoading } = useLiquidityMetrics(
    runwayWindow.start,
    runwayWindow.end,
    'all'
  );

  // Fetch cash flow for net change
  const { data: cashFlowMetrics, isLoading: cashFlowLoading } = useCashFlowMetrics(
    monthStart,
    today,
    'all'
  );

  const isLoading = banksLoading || liquidityLoading || cashFlowLoading;

  // Calculate the 3 essential metrics
  const metrics = useMemo(() => {
    if (!liquidityMetrics || !cashFlowMetrics) return null;

    return {
      availableCash: liquidityMetrics.currentBalance,
      netChange: cashFlowMetrics.netCashFlow || 0,
      runway: liquidityMetrics.daysOfCash,
      runwayStatus: liquidityMetrics.runwayStatus,
      accountCount: connectedBanks?.length || 0,
    };
  }, [liquidityMetrics, cashFlowMetrics, connectedBanks]);

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get runway color
  const getRunwayColor = (days: number): string => {
    if (days === Infinity || days > 90) return 'text-success-strong';
    if (days > 30) return 'text-warning-strong';
    return 'text-destructive-strong';
  };

  // Don't show if no banks connected
  if (!connectedBanks || connectedBanks.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h2 className="text-[17px] font-semibold text-foreground">Cash</h2>
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-3">
      {/* Clean header */}
      <h2 className="text-[17px] font-semibold text-foreground">Cash</h2>

      {/* 3 essential metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Available Cash */}
        <div className="p-4 rounded-xl bg-background border border-border/40 hover:border-border transition-colors">
          <p className="text-sm text-muted-foreground">Available</p>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(metrics.availableCash)}
          </p>
          <p className="text-xs text-muted-foreground">
            {metrics.accountCount} account{metrics.accountCount !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Net Change */}
        <div className="p-4 rounded-xl bg-background border border-border/40 hover:border-border transition-colors">
          <p className="text-sm text-muted-foreground">This Month</p>
          <div className="flex items-center gap-1.5">
            {metrics.netChange >= 0 ? (
              <TrendingUp className="h-5 w-5 text-success-strong" />
            ) : (
              <TrendingDown className="h-5 w-5 text-destructive-strong" />
            )}
            <p className={`text-2xl font-bold ${
              metrics.netChange >= 0 
                ? 'text-success-strong'
                : 'text-destructive-strong'
            }`}>
              {metrics.netChange >= 0 ? '+' : ''}{formatCurrency(metrics.netChange)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {metrics.netChange >= 0 ? 'Cash positive' : 'Cash negative'}
          </p>
        </div>

        {/* Runway */}
        <div className="p-4 rounded-xl bg-background border border-border/40 hover:border-border transition-colors">
          <p className="text-sm text-muted-foreground">Runway</p>
          <p className={`text-2xl font-bold ${getRunwayColor(metrics.runway)}`}>
            {formatRunwayDays(metrics.runway)}
          </p>
          <p className="text-xs text-muted-foreground">At current pace</p>
        </div>
      </div>
    </div>
  );
}
