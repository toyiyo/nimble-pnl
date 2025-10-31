import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import { useBankTransactions } from '@/hooks/useBankTransactions';
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
import { useMonthlyMetrics } from '@/hooks/useMonthlyMetrics';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';
import { MetricIcon } from '@/components/MetricIcon';
import { DashboardQuickActions } from '@/components/DashboardQuickActions';
import { DashboardInsights } from '@/components/DashboardInsights';
import { DashboardMiniChart } from '@/components/DashboardMiniChart';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { DataInputDialog } from '@/components/DataInputDialog';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';
import { BankSnapshotSection } from '@/components/BankSnapshotSection';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { CriticalAlertsBar } from '@/components/dashboard/CriticalAlertsBar';
import { OwnerSnapshotWidget } from '@/components/dashboard/OwnerSnapshotWidget';
import { useLiquidityMetrics } from '@/hooks/useLiquidityMetrics';
import { OperationsHealthCard } from '@/components/dashboard/OperationsHealthCard';
import { format, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import {
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Package,
  ShoppingCart,
  ChefHat,
  Clock,
  Target,
  Activity,
  Calendar,
  CheckCircle2,
  Sparkles,
  Landmark,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const Index = () => {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { lowStockItems, reorderAlerts, loading: alertsLoading } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);
  const { data: connectedBanks, isLoading: banksLoading } = useConnectedBanks(selectedRestaurant?.restaurant_id || null);
  const { data: transactionsData } = useBankTransactions('for_review');
  const { data: allTransactions } = useBankTransactions(); // Fetch all transactions for spending calculation
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  // Collapsible section states
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [trendsOpen, setTrendsOpen] = useState(true);
  const [revenueOpen, setRevenueOpen] = useState(true);
  const [monthlyOpen, setMonthlyOpen] = useState(false);

  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    type: 'today',
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
    label: 'Today',
  });

  // Use new unified metrics hook for revenue + costs
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  
  const { data: todaysMetrics, isLoading: todaysLoading } = usePeriodMetrics(
    selectedRestaurant?.restaurant_id || null,
    todayStart,
    todayEnd
  );

  const { data: periodMetrics, isLoading: periodLoading } = usePeriodMetrics(
    selectedRestaurant?.restaurant_id || null,
    selectedPeriod.from,
    selectedPeriod.to
  );

  // Fetch monthly metrics from unified_sales + daily_pnl
  const { data: monthlyMetrics, isLoading: monthlyLoading } = useMonthlyMetrics(
    selectedRestaurant?.restaurant_id || null,
    selectedPeriod.from,
    selectedPeriod.to
  );

  // Fetch revenue breakdown for selected period (still needed for detailed breakdown)
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    selectedRestaurant?.restaurant_id || null,
    selectedPeriod.from,
    selectedPeriod.to
  );

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  // Calculate period data from periodMetrics (no longer using daily_pnl for revenue)
  const periodData = useMemo(() => {
    if (!periodMetrics) return null;

    return {
      net_revenue: periodMetrics.netRevenue,
      food_cost: periodMetrics.foodCost,
      labor_cost: periodMetrics.laborCost,
      food_cost_percentage: periodMetrics.foodCostPercentage,
      labor_cost_percentage: periodMetrics.laborCostPercentage,
      prime_cost_percentage: periodMetrics.primeCostPercentage,
    };
  }, [periodMetrics]);

  // Calculate previous period data for comparison
  const periodLength = differenceInDays(selectedPeriod.to, selectedPeriod.from) + 1;
  const prevTo = new Date(selectedPeriod.from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - periodLength + 1);

  const { data: previousPeriodMetrics } = usePeriodMetrics(
    selectedRestaurant?.restaurant_id || null,
    prevFrom,
    prevTo
  );

  const previousPeriodData = useMemo(() => {
    if (!previousPeriodMetrics) return null;

    return {
      net_revenue: previousPeriodMetrics.netRevenue,
      food_cost_percentage: previousPeriodMetrics.foodCostPercentage,
      labor_cost_percentage: previousPeriodMetrics.laborCostPercentage,
      prime_cost_percentage: previousPeriodMetrics.primeCostPercentage,
    };
  }, [previousPeriodMetrics]);

  const todaysData = todaysMetrics;

  // Fetch liquidity metrics for cash runway
  const { data: liquidityMetrics } = useLiquidityMetrics(
    todayStart,
    todayEnd,
    'all'
  );

  // Calculate available cash from connected banks
  const availableCash = useMemo(() => {
    return connectedBanks?.reduce((total, bank) => {
      const bankTotal = bank.bank_account_balances?.reduce((sum, balance) => {
        return sum + (balance.current_balance || 0);
      }, 0) || 0;
      return total + bankTotal;
    }, 0) || 0;
  }, [connectedBanks]);

  // Calculate profit margin for today
  const todayProfitMargin = useMemo(() => {
    if (!todaysData || todaysData.netRevenue === 0) return 0;
    return (todaysData.grossProfit / todaysData.netRevenue) * 100;
  }, [todaysData]);

  const cashRunway = liquidityMetrics?.daysOfCash || 0;

  // Calculate daily average spending from actual transaction history
  const dailyAvgSpending = useMemo(() => {
    if (!allTransactions || allTransactions.length === 0) return 0;

    // Filter for expenses: negative amounts, not transfers, not excluded, from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const expenses = allTransactions.filter(t => {
      const transactionDate = new Date(t.transaction_date);
      return (
        t.amount < 0 && // Expenses are negative
        !t.is_transfer && // Exclude transfers
        !t.excluded_reason && // Exclude transactions marked as excluded
        transactionDate >= thirtyDaysAgo // Last 30 days only
      );
    });

    if (expenses.length === 0) return 0;

    // Calculate total spending (absolute values)
    const totalSpending = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Calculate actual number of days with data
    const dates = new Set(expenses.map(t => format(new Date(t.transaction_date), 'yyyy-MM-dd')));
    const daysWithData = dates.size;

    // Return average daily spending
    return daysWithData > 0 ? totalSpending / daysWithData : 0;
  }, [allTransactions]);

  // Generate Critical Alerts
  const criticalAlerts = useMemo(() => {
    const alerts: Array<{
      id: string;
      type: "cash" | "cost" | "inventory" | "operations";
      severity: "critical" | "warning";
      title: string;
      description: string;
      action?: { label: string; path: string };
    }> = [];

    // Cash runway alert
    const runway = dailyAvgSpending > 0 ? availableCash / dailyAvgSpending : 0;
    if (runway < 30 && runway > 0) {
      alerts.push({
        id: "cash-runway",
        type: "cash",
        severity: runway < 14 ? "critical" : "warning",
        title: `${Math.floor(runway)} days of cash runway`,
        description: "Monitor cash flow closely",
        action: { label: "View Banking", path: "/banking" },
      });
    }

    // Prime cost alert
    if (periodData && periodData.prime_cost_percentage > 65) {
      alerts.push({
        id: "prime-cost",
        type: "cost",
        severity: periodData.prime_cost_percentage > 70 ? "critical" : "warning",
        title: "Prime cost above target",
        description: `At ${periodData.prime_cost_percentage.toFixed(1)}% (target: 60-65%)`,
        action: { label: "View Reports", path: "/reports" },
      });
    }

    // Inventory alerts
    if (reorderAlerts.length > 10) {
      alerts.push({
        id: "reorder",
        type: "inventory",
        severity: reorderAlerts.length > 20 ? "critical" : "warning",
        title: `${reorderAlerts.length} items need reorder`,
        description: "Prevent stockouts",
        action: { label: "View Inventory", path: "/inventory" },
      });
    }

    // Unmapped POS items
    const unmappedCount = unmappedItems?.length || 0;
    if (unmappedCount > 20) {
      alerts.push({
        id: "unmapped-pos",
        type: "operations",
        severity: unmappedCount > 50 ? "critical" : "warning",
        title: `${unmappedCount} POS items unmapped`,
        description: "Map items for accurate cost tracking",
        action: { label: "Map Items", path: "/pos-sales" },
      });
    }

    return alerts;
  }, [availableCash, periodData, reorderAlerts, unmappedItems]);

  // Monthly data from new metrics hook
  const monthlyData = monthlyMetrics || [];

  // Generate AI insights with memoization
  const insights = useMemo(() => {
    const insightsArray: Array<{
      type: 'critical' | 'warning' | 'success' | 'info' | 'tip';
      title: string;
      description: string;
    }> = [];

    // Critical alerts
    if (reorderAlerts.length > 5) {
      insightsArray.push({
        type: 'critical',
        title: `${reorderAlerts.length} Items Need Immediate Reorder`,
        description: 'Multiple items are below reorder point. Review inventory to avoid stockouts.'
      });
    }

    // Food cost performance
    if (todaysData && previousPeriodData) {
      if (todaysData.foodCostPercentage > previousPeriodData.food_cost_percentage + 5) {
        insightsArray.push({
          type: 'warning',
          title: 'Food Cost Above Average',
          description: `Today's food cost (${todaysData.foodCostPercentage.toFixed(1)}%) is ${(todaysData.foodCostPercentage - previousPeriodData.food_cost_percentage).toFixed(1)}% higher than previous period. Check for waste or price increases.`
        });
      } else if (todaysData.foodCostPercentage < previousPeriodData.food_cost_percentage - 2) {
        insightsArray.push({
          type: 'success',
          title: 'Excellent Food Cost Control',
          description: `Food cost is ${(previousPeriodData.food_cost_percentage - todaysData.foodCostPercentage).toFixed(1)}% below previous period. Great work!`
        });
      }
    }

    // Prime cost check
    if (todaysData && todaysData.primeCostPercentage > 65) {
      insightsArray.push({
        type: 'warning',
        title: 'Prime Cost Above Target',
        description: `Prime cost at ${todaysData.primeCostPercentage.toFixed(1)}% exceeds the recommended 60-65% range. Consider reviewing labor schedules and food costs.`
      });
    }

    // Low stock warning
    if (lowStockItems.length > 0 && lowStockItems.length <= 5) {
      insightsArray.push({
        type: 'info',
        title: `${lowStockItems.length} Items Running Low`,
        description: 'Some items are below par levels. Plan your next order accordingly.'
      });
    }

    // Helpful tip
    if (insightsArray.length === 0) {
      insightsArray.push({
        type: 'tip',
        title: 'All Systems Running Smoothly',
        description: 'Your restaurant operations are looking good! Keep monitoring your metrics daily for best results.'
      });
    }

    return insightsArray;
  }, [reorderAlerts, todaysData, previousPeriodData, lowStockItems]);

  const getTrendValue = (current: number, average: number) => {
    if (!average) return 0;
    return ((current - average) / average) * 100;
  };

  return (
    <>
      {!selectedRestaurant ? (
        <div className="space-y-8 animate-fade-in">
          <div className="text-center space-y-4">
            <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
              <Package className="h-12 w-12 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Welcome to Your Restaurant Dashboard
              </h1>
              <p className="text-muted-foreground text-lg">
                Select or create a restaurant to get started with intelligent insights
              </p>
            </div>
          </div>
          <RestaurantSelector 
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            restaurants={restaurants}
            loading={restaurantsLoading}
            createRestaurant={createRestaurant}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Enhanced Header */}
          <div className="flex flex-col gap-6 p-6 rounded-2xl bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-4xl font-bold tracking-tight flex items-center gap-3">
                  <span className="animate-[wave_1s_ease-in-out_infinite]" style={{ display: 'inline-block', transformOrigin: '70% 70%' }}>
                    👋
                  </span>
                  Welcome back!
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span className="font-semibold text-foreground text-lg">
                    {selectedRestaurant.restaurant.name}
                  </span>
                  <div className="h-4 w-px bg-border" />
                  <Badge variant="outline" className="gap-1.5 px-3 py-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date().toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <DataInputDialog 
                restaurantId={selectedRestaurant.restaurant_id}
                onDataUpdated={() => {
                  window.location.reload();
                }}
                className="w-full sm:w-auto"
              />
              <Button 
                variant="outline" 
                onClick={() => navigate('/banking')} 
                className="w-full sm:w-auto group hover:border-cyan-500/50 transition-all"
              >
                <Landmark className="h-4 w-4 mr-2 group-hover:text-cyan-600 transition-colors" />
                Banking
              </Button>
              <Button 
                variant="outline" 
                onClick={() => navigate('/reports')} 
                className="w-full sm:w-auto group hover:border-primary/50 transition-all"
              >
                <TrendingUp className="h-4 w-4 mr-2 group-hover:text-primary transition-colors" />
                View Reports
              </Button>
              <Button 
                onClick={() => navigate('/inventory')} 
                className="w-full sm:w-auto group"
              >
                <Package className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform" />
                Manage Inventory
              </Button>
            </div>
          </div>

          {todaysLoading || periodLoading || alertsLoading ? (
            <DashboardSkeleton />
          ) : (
            <>
              {/* Critical Alerts Bar */}
              <CriticalAlertsBar alerts={criticalAlerts} />

              {/* Owner Snapshot Widget */}
            <OwnerSnapshotWidget
              todaySales={todaysData?.netRevenue || 0}
              profitMargin={todayProfitMargin}
              availableCash={availableCash}
              cashRunway={cashRunway}
              todayFoodCost={todaysData?.foodCost || 0}
              todayLaborCost={todaysData?.laborCost || 0}
              lastUpdated={format(new Date(), 'h:mm a')}
            />

              {/* AI Insights */}
              <DashboardInsights insights={insights} />

              {/* Bank Snapshot Section - Current State (Real-time) */}
              {!banksLoading && connectedBanks && connectedBanks.length > 0 ? (
                <BankSnapshotSection 
                  restaurantId={selectedRestaurant.restaurant_id}
                />
              ) : !banksLoading && (!connectedBanks || connectedBanks.length === 0) ? (
                <Card className="border-dashed border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent">
                  <CardContent className="py-12 text-center">
                    <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-transparent mb-4">
                      <Landmark className="h-12 w-12 text-cyan-600" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Connect Your Bank for Financial Insights</h3>
                    <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                      Get real-time cash flow tracking, spending analysis, and AI-powered financial intelligence by connecting your bank account.
                    </p>
                    <Button 
                      onClick={() => navigate('/banking')} 
                      className="gap-2"
                    >
                      <Landmark className="h-4 w-4" />
                      Connect Bank Account
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {/* Operations Health Card */}
              <OperationsHealthCard
                primeCost={periodData?.prime_cost_percentage || 0}
                primeCostTarget={62}
                lowInventoryCount={lowStockItems.length}
                unmappedPOSCount={unmappedItems?.length || 0}
                uncategorizedTransactions={transactionsData?.length || 0}
              />

              {/* Period Selector - Positioned before period-dependent sections */}
              <div className="flex flex-col gap-3 p-6 rounded-xl bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 bg-gradient-to-r from-primary to-accent rounded-full" />
                  <h2 className="text-xl font-semibold">Analyze Period</h2>
                  <Badge variant="outline" className="text-xs">
                    Select time range to analyze
                  </Badge>
                </div>
                <PeriodSelector
                  selectedPeriod={selectedPeriod}
                  onPeriodChange={setSelectedPeriod}
                />
              </div>

              {/* Key Metrics - Collapsible */}
              <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
                      <h2 className="text-2xl font-bold tracking-tight">📈 This Month's Performance</h2>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2">
                        {metricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {metricsOpen ? "Collapse" : "Expand"}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Performance metrics">
                  <DashboardMetricCard
                    title="Your Sales (after discounts/refunds)"
                    value={periodData ? `$${periodData.net_revenue.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.net_revenue, previousPeriodData.net_revenue),
                      label: 'vs previous period'
                    } : undefined}
                    icon={DollarSign}
                    variant={periodData && previousPeriodData && periodData.net_revenue > previousPeriodData.net_revenue ? 'success' : 'default'}
                    sparklineData={undefined}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Food Cost (COGS)"
                    value={periodData ? `$${periodData.food_cost.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.food_cost_percentage, previousPeriodData.food_cost_percentage),
                      label: 'vs previous period'
                    } : undefined}
                    icon={ShoppingCart}
                    variant={periodData && periodData.food_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={periodData ? `${periodData.food_cost_percentage.toFixed(1)}% of revenue | Target: 28-32%` : undefined}
                    sparklineData={undefined}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Labor Cost (Wages + Payroll)"
                    value={periodData ? `$${periodData.labor_cost.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.labor_cost_percentage, previousPeriodData.labor_cost_percentage),
                      label: 'vs previous period'
                    } : undefined}
                    icon={Clock}
                    variant={periodData && periodData.labor_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={periodData ? `${periodData.labor_cost_percentage.toFixed(1)}% of revenue | Target: 25-30%` : undefined}
                    sparklineData={undefined}
                    periodLabel={selectedPeriod.label}
                  />
                  {/* Profit Card (replaced Prime Cost) */}
                  {(() => {
                    const profit = periodData ? (periodData.net_revenue - periodData.food_cost - periodData.labor_cost) : 0;
                    const profitMargin = periodData?.net_revenue ? (profit / periodData.net_revenue) * 100 : 0;
                    const previousProfit = previousPeriodData ? (previousPeriodData.net_revenue * (1 - (previousPeriodData.food_cost_percentage + previousPeriodData.labor_cost_percentage) / 100)) : 0;
                    
                    return (
                      <DashboardMetricCard
                        title="Gross Profit"
                        value={periodData ? `$${profit.toFixed(0)}` : '--'}
                        trend={periodData && previousPeriodData ? {
                          value: getTrendValue(profit, previousProfit),
                          label: 'vs previous period'
                        } : undefined}
                        icon={TrendingUp}
                        variant={
                          periodData && periodData.net_revenue > 0
                            ? profitMargin > 15 ? 'success' : profitMargin < 5 ? 'danger' : profitMargin < 10 ? 'warning' : 'default'
                            : 'default'
                        }
                        subtitle={periodData && periodData.net_revenue > 0 ? `${profitMargin.toFixed(1)}% Gross Profit Margin` : undefined}
                        sparklineData={undefined}
                        periodLabel={selectedPeriod.label}
                      />
                    );
                  })()}
                </div>
                {/* Simple Context */}
                {periodData && (
                  <div className="mt-4 p-4 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">
                        You've earned ${(periodData.net_revenue - periodData.food_cost - periodData.labor_cost).toFixed(0)}
                      </span>{' '}
                      after food and labor costs.
                    </p>
                    {periodData.net_revenue > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        That's a {((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100).toFixed(1)}% gross margin
                        {((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100) >= 15 
                          ? ' — solid for your concept.' 
                          : ((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100) >= 10
                          ? ' — room for improvement.'
                          : ' — needs attention.'}
                      </p>
                    )}
                  </div>
                )}
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Alerts & Trends - Collapsible */}
              <Collapsible open={trendsOpen} onOpenChange={setTrendsOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-8 bg-gradient-to-r from-accent to-accent/50 rounded-full" />
                      <h2 className="text-2xl font-bold tracking-tight">Trends & Alerts</h2>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2">
                        {trendsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {trendsOpen ? "Collapse" : "Expand"}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Enhanced Alerts */}
                <Card className={`group transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 animate-fade-in ${
                  reorderAlerts.length > 0 
                    ? 'border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50/50 via-background to-red-50/30 dark:from-red-950/20 dark:via-background dark:to-red-950/10' 
                    : 'bg-gradient-to-br from-green-50/50 via-background to-green-50/30 dark:from-green-950/20 dark:via-background dark:to-green-950/10'
                }`}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      {reorderAlerts.length > 0 ? (
                        <div className="rounded-lg p-2 bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30">
                          <AlertTriangle className="h-4 w-4 text-white" />
                        </div>
                      ) : (
                        <div className="rounded-lg p-2 bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/30">
                          <CheckCircle2 className="h-4 w-4 text-white" />
                        </div>
                      )}
                      <span>Inventory Alerts</span>
                    </CardTitle>
                    <CardDescription>Items needing attention</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reorderAlerts.length === 0 ? (
                      <div className="text-center py-4 space-y-2">
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
                          All inventory levels are healthy
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Great job maintaining stock levels! 🎉
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                          <span className="text-sm font-medium">Reorder Needed</span>
                          <Badge variant="destructive" className="animate-pulse">
                            {reorderAlerts.length}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                          <span className="text-sm font-medium">Low Stock</span>
                          <Badge variant="outline">{lowStockItems.length}</Badge>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full mt-2 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-300 dark:hover:border-red-800 transition-all"
                          onClick={() => navigate('/inventory?tab=low-stock')}
                        >
                          View All Alerts
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Revenue Trend */}
                <DashboardMiniChart
                  title="Revenue Trend"
                  description="Last 14 days"
                  data={[{ date: format(new Date(), 'yyyy-MM-dd'), value: periodMetrics?.netRevenue || 0 }]}
                  color="#10b981"
                  suffix="$"
                />

                {/* Food Cost Trend */}
                <DashboardMiniChart
                  title="Food Cost Trend"
                  description="Last 14 days"
                  data={[{ date: format(new Date(), 'yyyy-MM-dd'), value: periodMetrics?.foodCostPercentage || 0 }]}
                  color="#f59e0b"
                  suffix="%"
                />
              </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Quick Actions */}
              <DashboardQuickActions restaurantId={selectedRestaurant.restaurant_id} />

              {/* Revenue Mix Section - Collapsible */}
              {!revenueLoading && revenueBreakdown && revenueBreakdown.has_categorization_data && (
                <Collapsible open={revenueOpen} onOpenChange={setRevenueOpen}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-8 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full" />
                        <h2 className="text-2xl font-bold tracking-tight">💰 Where Your Sales Come From</h2>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2">
                          {revenueOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4" />}
                          {revenueOpen ? "Collapse" : "Expand"}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This shows what products are driving your sales.
                    </p>
                    {/* Header Summary */}
                    <div className="p-3 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{revenueBreakdown.categorization_rate.toFixed(0)}% of sales are categorized.</span>{' '}
                        These totals cover mapped items only.
                      </p>
                    </div>
                    <CollapsibleContent>
                <Card className="bg-gradient-to-br from-emerald-50/50 via-background to-emerald-50/30 dark:from-emerald-950/20 dark:via-background dark:to-emerald-950/10 border-emerald-200 dark:border-emerald-900">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <MetricIcon icon={DollarSign} variant="emerald" />
                        <div>
                          <CardTitle className="text-lg">Revenue by Category</CardTitle>
                          <CardDescription>
                            Breakdown by category • {selectedPeriod.label}
                          </CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                   <CardContent className="space-y-4">

                    {/* Gross vs Net Revenue */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg bg-background/50">
                        <p className="text-sm text-muted-foreground mb-1">Gross Revenue</p>
                        <p className="text-2xl font-bold text-emerald-600">
                          ${revenueBreakdown.totals.gross_revenue.toLocaleString()}
                        </p>
                      </div>
                      {(revenueBreakdown.totals.total_discounts > 0 || revenueBreakdown.totals.total_refunds > 0) && (
                        <div className="p-4 rounded-lg bg-background/50">
                          <p className="text-sm text-muted-foreground mb-1">
                            Discounts & Refunds
                          </p>
                          <p className="text-2xl font-bold text-red-600">
                            -${(revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {((revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue * 100).toFixed(1)}% of gross
                          </p>
                        </div>
                      )}
                      <div className="p-4 rounded-lg bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-200 dark:border-emerald-800">
                        <p className="text-sm text-muted-foreground mb-1">Net Revenue</p>
                        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                          ${revenueBreakdown.totals.net_revenue.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Top Revenue Categories */}
                    {revenueBreakdown.revenue_categories.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <div className="h-1 w-6 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full" />
                          Revenue by Category
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {revenueBreakdown.revenue_categories.slice(0, 6).map((category) => (
                            <div 
                              key={category.account_id}
                              className="p-3 rounded-lg bg-background/50 hover:bg-background/80 transition-colors"
                            >
                              <div className="flex items-start justify-between mb-1">
                                <div className="flex-1">
                                  <p className="text-sm font-medium truncate">{category.account_name}</p>
                                  <p className="text-xs text-muted-foreground">{category.account_code}</p>
                                </div>
                                <Badge variant="outline" className="ml-2 shrink-0">
                                  {(category.total_amount / revenueBreakdown.totals.gross_revenue * 100).toFixed(0)}%
                                </Badge>
                              </div>
                              <p className="text-lg font-bold text-emerald-600">
                                ${category.total_amount.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {category.transaction_count} transactions
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Collected but Owed */}
                    {(revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0 || revenueBreakdown.totals.other_liabilities > 0) && (
                      <div className="pt-4 border-t">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            🧾 Collected but Owed
                          </h4>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600">
                            Not Revenue
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mb-3">
                          This money was collected at POS but belongs to staff or government agencies.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {revenueBreakdown.totals.sales_tax > 0 && (
                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium">Sales Tax Collected</p>
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                  Liability
                                </Badge>
                              </div>
                              <p className="text-xl font-bold text-amber-700 dark:text-amber-400">
                                ${revenueBreakdown.totals.sales_tax.toLocaleString()}
                              </p>
                            </div>
                          )}
                          {revenueBreakdown.totals.tips > 0 && (
                            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium">Tips Collected</p>
                                <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                                  Liability
                                </Badge>
                              </div>
                              <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                                ${revenueBreakdown.totals.tips.toLocaleString()}
                              </p>
                            </div>
                          )}
                          {revenueBreakdown.other_liability_categories.map((category) => (
                            <div key={category.account_id} className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium">{category.account_name}</p>
                                <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                                  Liability
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                                <p className="text-xl font-bold text-purple-700 dark:text-purple-400">
                                  ${category.total_amount.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}

              {/* Monthly Performance Table - Collapsible */}
              <Collapsible open={monthlyOpen} onOpenChange={setMonthlyOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full" />
                      <h2 className="text-2xl font-bold tracking-tight">📅 Monthly Profit Breakdown</h2>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-2">
                        {monthlyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {monthlyOpen ? "Collapse" : "Expand"}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <MonthlyBreakdownTable monthlyData={monthlyData} />
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Index;
