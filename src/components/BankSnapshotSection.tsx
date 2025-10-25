import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useLiquidityMetrics } from '@/hooks/useLiquidityMetrics';
import { useCashFlowMetrics } from '@/hooks/useCashFlowMetrics';
import { useSpendingAnalysis } from '@/hooks/useSpendingAnalysis';
import { useRevenueHealth } from '@/hooks/useRevenueHealth';
import { Period } from '@/components/PeriodSelector';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Timer,
  Activity,
  BarChart3,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { differenceInDays, startOfMonth, subDays } from 'date-fns';

interface BankSnapshotSectionProps {
  restaurantId: string;
  selectedPeriod: Period;
}

export function BankSnapshotSection({ restaurantId, selectedPeriod }: BankSnapshotSectionProps) {
  const { data: connectedBanks, isLoading: banksLoading } = useConnectedBanks(restaurantId);

  // Calculate date ranges for metrics
  const periodEnd = selectedPeriod.to;
  const thirtyDaysAgo = subDays(periodEnd, 30);
  const monthStart = startOfMonth(periodEnd);

  // Fetch all metrics
  const { data: liquidityMetrics, isLoading: liquidityLoading } = useLiquidityMetrics(
    thirtyDaysAgo,
    periodEnd,
    'all'
  );

  const { data: cashFlowMetrics, isLoading: cashFlowLoading } = useCashFlowMetrics(
    monthStart,
    periodEnd,
    'all'
  );

  const { data: spendingMetrics, isLoading: spendingLoading } = useSpendingAnalysis(
    thirtyDaysAgo,
    periodEnd,
    'all'
  );

  const { data: revenueMetrics, isLoading: revenueLoading } = useRevenueHealth(
    thirtyDaysAgo,
    periodEnd,
    'all'
  );

  // Combined loading state
  const isLoading = banksLoading || liquidityLoading || cashFlowLoading || spendingLoading || revenueLoading;

  // Calculate derived metrics
  const metrics = useMemo(() => {
    if (!liquidityMetrics || !cashFlowMetrics || !spendingMetrics || !revenueMetrics) {
      return null;
    }

    // 1. Available Cash Balance
    const availableCash = liquidityMetrics.currentBalance;

    // 2. Net Cash Flow (This Month) - MTD
    const netCashFlowMTD = cashFlowMetrics.netCashFlow30d || 0;

    // 3. Trailing 7-Day Net Flow
    const netCashFlow7d = cashFlowMetrics.netCashFlow7d || 0;

    // 4. Top 3 Spending Categories
    const topCategories = spendingMetrics.categoryBreakdown
      ?.slice(0, 3)
      .map(cat => ({ name: cat.category, amount: cat.amount })) || [];

    // 5. Vendor Dependence Ratio (max vendor / total spend)
    const vendorConcentration = spendingMetrics.vendorConcentration || 0;

    // 6. Incoming vs Outgoing Ratio
    const incomingOutgoingRatio = (cashFlowMetrics.netInflows30d || 0) / Math.max(Math.abs(cashFlowMetrics.netOutflows30d || 0), 1);

    // 7. Average Daily Burn
    const avgDailyBurn = liquidityMetrics.avgDailyOutflow;

    // 8. Runway (in Days)
    const runway = liquidityMetrics.daysOfCash;

    // 9. Cash Volatility Index
    const volatility = cashFlowMetrics.volatility || 0;

    // 10. Deposit Frequency (days with deposits in last 30 days)
    const depositFrequency = revenueMetrics.depositCount || 0;

    return {
      availableCash,
      netCashFlowMTD,
      netCashFlow7d,
      topCategories,
      vendorConcentration,
      incomingOutgoingRatio,
      avgDailyBurn,
      runway,
      volatility,
      depositFrequency,
      runwayStatus: liquidityMetrics.runwayStatus,
    };
  }, [liquidityMetrics, cashFlowMetrics, spendingMetrics, revenueMetrics]);

  // Helper functions
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getVolatilityStatus = (volatility: number): 'low' | 'medium' | 'high' => {
    if (volatility < 0.3) return 'low';
    if (volatility < 0.6) return 'medium';
    return 'high';
  };

  if (!connectedBanks || connectedBanks.length === 0) {
    return null; // Don't show section if no banks connected
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-1 w-8 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full" />
          <h2 className="text-2xl font-bold tracking-tight">Bank Snapshot</h2>
          <Sparkles className="h-5 w-5 text-cyan-500/60" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <div className="h-1 w-8 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full" />
        <h2 className="text-2xl font-bold tracking-tight">Bank Snapshot</h2>
        <Sparkles className="h-5 w-5 text-cyan-500/60" />
      </div>

      {/* Quick Glance Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashboardMetricCard
          title="Available Cash"
          value={formatCurrency(metrics.availableCash)}
          icon={Wallet}
          variant={metrics.availableCash > 10000 ? 'success' : metrics.availableCash < 2000 ? 'danger' : 'warning'}
          subtitle={`Across ${connectedBanks.length} ${connectedBanks.length === 1 ? 'account' : 'accounts'}`}
          periodLabel="Current Balance"
        />

        <DashboardMetricCard
          title="Net Cash Flow (MTD)"
          value={formatCurrency(metrics.netCashFlowMTD)}
          icon={TrendingUp}
          variant={metrics.netCashFlowMTD > 0 ? 'success' : 'danger'}
          subtitle={metrics.netCashFlowMTD > 0 ? 'Cash positive' : 'Cash negative'}
          periodLabel="Month to Date"
        />

        <DashboardMetricCard
          title="Runway"
          value={metrics.runway !== Infinity ? `${Math.floor(metrics.runway)} days` : '∞'}
          icon={Timer}
          variant={
            metrics.runwayStatus === 'healthy' ? 'success' :
            metrics.runwayStatus === 'caution' ? 'warning' : 'danger'
          }
          subtitle={metrics.avgDailyBurn > 0 ? `Burning ${formatCurrency(metrics.avgDailyBurn)}/day` : 'No daily burn'}
          periodLabel="Days of Cash"
        />
      </div>

      {/* Insights & Drivers Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Top 3 Spending Categories Card */}
        <Card className="bg-gradient-to-br from-cyan-50/50 via-background to-blue-50/30 dark:from-cyan-950/10 dark:via-background dark:to-blue-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              Top 3 Spending
            </CardTitle>
            <CardDescription className="text-xs">Last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.topCategories.length > 0 ? (
              metrics.topCategories.map((cat, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground truncate flex-1">{cat.name}</span>
                  <span className="font-semibold ml-2">{formatCurrency(cat.amount)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No spending data</p>
            )}
            <div className="pt-2 border-t border-border/50">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Vendor concentration</span>
                <Badge 
                  variant={metrics.vendorConcentration > 50 ? 'destructive' : 'outline'}
                  className="text-xs"
                >
                  {metrics.vendorConcentration.toFixed(0)}%
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <DashboardMetricCard
          title="Incoming/Outgoing"
          value={`${metrics.incomingOutgoingRatio.toFixed(2)}x`}
          icon={Activity}
          variant={
            metrics.incomingOutgoingRatio >= 1.2 ? 'success' :
            metrics.incomingOutgoingRatio >= 1.0 ? 'default' : 'danger'
          }
          subtitle={metrics.incomingOutgoingRatio >= 1.0 ? 'Cash positive' : 'Cash negative'}
          periodLabel="Last 30 Days"
        />

        <DashboardMetricCard
          title="Cash Volatility"
          value={getVolatilityStatus(metrics.volatility).toUpperCase()}
          icon={TrendingDown}
          variant={
            metrics.volatility < 0.3 ? 'success' :
            metrics.volatility < 0.6 ? 'warning' : 'danger'
          }
          subtitle={`Volatility index: ${metrics.volatility.toFixed(2)}`}
          periodLabel="Last 30 Days"
        />

        <DashboardMetricCard
          title="Deposit Frequency"
          value={`${metrics.depositFrequency} days`}
          icon={TrendingUp}
          variant={metrics.depositFrequency >= 20 ? 'success' : metrics.depositFrequency >= 15 ? 'default' : 'warning'}
          subtitle="Days with deposits"
          periodLabel="Last 30 Days"
        />
      </div>

      {/* 7-Day Trend Badge */}
      <div className="flex items-center gap-2">
        <Badge 
          variant={metrics.netCashFlow7d > 0 ? 'default' : 'outline'}
          className="gap-1.5 px-3 py-1"
        >
          {metrics.netCashFlow7d > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          )}
          7-Day: {formatCurrency(metrics.netCashFlow7d)}
        </Badge>
        {metrics.runwayStatus === 'critical' && (
          <Badge variant="destructive" className="gap-1.5 px-3 py-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Critical Runway
          </Badge>
        )}
      </div>
    </div>
  );
}
