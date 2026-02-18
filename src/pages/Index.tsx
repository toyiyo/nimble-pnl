import { useEffect, useState, useMemo } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import { useBankTransactions } from '@/hooks/useBankTransactions';
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
import { useMonthlyMetrics } from '@/hooks/useMonthlyMetrics';
import { usePendingOutflowsSummary } from '@/hooks/usePendingOutflows';
import { useInventoryPurchases } from '@/hooks/useInventoryPurchases';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';
import { DashboardQuickActions } from '@/components/DashboardQuickActions';
import { DashboardInsights } from '@/components/DashboardInsights';
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
import { useBreakEvenAnalysis } from '@/hooks/useBreakEvenAnalysis';
import { OperationsHealthCard } from '@/components/dashboard/OperationsHealthCard';
import { OnboardingDrawer } from '@/components/dashboard/OnboardingDrawer';
import { WelcomeModal } from '@/components/subscription';
import { OutflowByCategoryCard } from '@/components/dashboard/OutflowByCategoryCard';
import { TopVendorsCard } from '@/components/dashboard/TopVendorsCard';
import { CashFlowSankeyChart } from '@/components/dashboard/CashFlowSankeyChart';
import { SalesVsBreakEvenChart } from '@/components/budget/SalesVsBreakEvenChart';
import { useOpsInboxCount } from '@/hooks/useOpsInbox';
import { useSubscription } from '@/hooks/useSubscription';
import { format, startOfDay, endOfDay, differenceInDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
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
  CheckCircle2,
  Sparkles,
  Landmark,
  ChevronDown,
  ChevronUp,
  Inbox,
  Newspaper,
} from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const Index = () => {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const { isCollaborator, landingPath } = usePermissions();
  const { lowStockItems, reorderAlerts, loading: alertsLoading } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);
  const { data: connectedBanks, isLoading: banksLoading } = useConnectedBanks(selectedRestaurant?.restaurant_id || null);
  const {
    transactions: uncategorizedTransactions = [],
    totalCount: uncategorizedCount = 0,
  } = useBankTransactions('for_review', { pageSize: 100 });
  const {
    transactions: allTransactions = [],
  } = useBankTransactions(undefined, { autoLoadAll: true, pageSize: 200, sortBy: 'date', sortDirection: 'desc' }); // Fetch transactions incrementally for spending calculation
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const { totalPending: totalPendingOutflows } = usePendingOutflowsSummary();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Welcome modal state
  const [showWelcome, setShowWelcome] = useState(false);
  const hasExistingSubscription = useMemo(() => {
    const paidStatuses = new Set(['active', 'past_due', 'grandfathered']);
    return restaurants.some(({ restaurant }) => {
      if (!restaurant) return false;
      const status = restaurant.subscription_status || '';
      const hasStripeSub = Boolean(restaurant.stripe_subscription_id);
      return paidStatuses.has(status) || hasStripeSub;
    });
  }, [restaurants]);

  // Check for welcome flag in URL on mount
  useEffect(() => {
    if (!user || restaurantsLoading) return;

    const welcomeFlag = searchParams.get('welcome');
    const hasSeenWelcome = localStorage.getItem(`hasSeenWelcome_${user.id}`);

    const shouldShowWelcome =
      welcomeFlag === 'true' && !hasSeenWelcome && !hasExistingSubscription;

    if (shouldShowWelcome) {
      setShowWelcome(true);
    } else if (!hasSeenWelcome && hasExistingSubscription) {
      // User already pays for at least one restaurant; skip the trial splash permanently
      localStorage.setItem(`hasSeenWelcome_${user.id}`, 'true');
    }

    // Clean up URL param once we've processed it
    if (welcomeFlag) {
      searchParams.delete('welcome');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, user, restaurantsLoading, hasExistingSubscription]);

  function handleWelcomeClose(): void {
    setShowWelcome(false);
    if (user) {
      localStorage.setItem(`hasSeenWelcome_${user.id}`, 'true');
    }
  }

  // Collapsible section states
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [revenueOpen, setRevenueOpen] = useState(true);
  const [moneyOutOpen, setMoneyOutOpen] = useState(true);
  const [cashflowOpen, setCashflowOpen] = useState(true);
  const [monthlyOpen, setMonthlyOpen] = useState(true);
  const [bankingOpen, setBankingOpen] = useState(true);
  const [operationsOpen, setOperationsOpen] = useState(true);
  const [quickActionsOpen, setQuickActionsOpen] = useState(true);

  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    type: 'today',
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
    label: 'Today',
  });

  // Monthly table should be month-to-date for the current month (up to the selected period end)
  // so it matches Payroll + Performance Overview when the month is in progress.
  const monthlyRangeEnd = selectedPeriod.to;
  const monthlyRangeStart = startOfMonth(subMonths(monthlyRangeEnd, 11));

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
    monthlyRangeStart,
    monthlyRangeEnd
  );

  // Revenue breakdown is used by periodMetrics internally but we also need it for detailed display
  // React Query will cache this with the same key, so no duplicate network requests
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    selectedRestaurant?.restaurant_id || null,
    selectedPeriod.from,
    selectedPeriod.to
  );

  // Fetch inventory purchases for the selected period
  const { data: inventoryPurchases, isLoading: purchasesLoading } = useInventoryPurchases(
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
      pending_labor_cost: periodMetrics.pendingLaborCost,
      actual_labor_cost: periodMetrics.actualLaborCost,
      food_cost_percentage: periodMetrics.foodCostPercentage,
      labor_cost_percentage: periodMetrics.laborCostPercentage,
      pending_labor_cost_percentage: periodMetrics.pendingLaborCostPercentage,
      actual_labor_cost_percentage: periodMetrics.actualLaborCostPercentage,
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

  // Fetch break-even analysis data
  const { data: breakEvenData, isLoading: breakEvenLoading } = useBreakEvenAnalysis(
    selectedRestaurant?.restaurant_id || null,
    14 // 14 days of history
  );

  const { data: opsInboxCounts } = useOpsInboxCount(selectedRestaurant?.restaurant_id);
  const { hasFeature } = useSubscription();

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

  // Calculate daily average spending from actual transaction history + pending outflows
  const dailyAvgSpending = useMemo(() => {
    if (!allTransactions || allTransactions.length === 0) {
      // If no transactions but have pending outflows, estimate based on those
      if (totalPendingOutflows > 0) {
        return totalPendingOutflows / 30; // Rough estimate
      }
      return 0;
    }

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

    // Calculate total spending (absolute values) including pending outflows
    const totalSpending = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0) + totalPendingOutflows;

    // Calculate actual number of days with data
    const dates = new Set(expenses.map(t => format(new Date(t.transaction_date), 'yyyy-MM-dd')));
    const daysWithData = dates.size;

    // Return average daily spending (including pending outflows amortized over period)
    return daysWithData > 0 ? totalSpending / daysWithData : 0;
  }, [allTransactions, totalPendingOutflows]);

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

  // Reconciliation check: Validate that Performance Overview and Monthly Performance match
  // This helps catch data consistency issues between the two views
  useEffect(() => {
    if (!periodMetrics || !monthlyData || monthlyData.length === 0) return;
    
    // Find the current month's data in monthlyData
    const currentMonth = format(selectedPeriod.from, 'yyyy-MM');
    const monthlyEntry = monthlyData.find(m => m.period === currentMonth);
    
    if (!monthlyEntry) {
      console.info('Reconciliation check: No monthly entry found for', currentMonth, 'Available periods:', monthlyData.map(m => m.period));
      return;
    }
    
    // Compare gross revenue, discounts, and net revenue
    const overviewGrossRevenue = periodMetrics.grossRevenue;
    const monthlyGrossRevenue = monthlyEntry.gross_revenue;
    const grossRevenueDiff = Math.abs(overviewGrossRevenue - monthlyGrossRevenue);
    
    const overviewDiscounts = periodMetrics.discounts;
    const monthlyDiscounts = monthlyEntry.discounts;
    const discountsDiff = Math.abs(overviewDiscounts - monthlyDiscounts);
    
    const overviewNetRevenue = periodMetrics.netRevenue;
    const monthlyNetRevenue = monthlyEntry.net_revenue;
    const netRevenueDiff = Math.abs(overviewNetRevenue - monthlyNetRevenue);
    
    // Compare COGS/food cost
    const overviewFoodCost = periodMetrics.foodCost;
    const monthlyFoodCost = monthlyEntry.food_cost;
    const foodCostDiff = Math.abs(overviewFoodCost - monthlyFoodCost);
    
    // Log detailed comparison (always log for debugging)
    console.group(`📊 Reconciliation Check: ${selectedPeriod.label}`);
    console.table({
      'Gross Revenue': {
        'Performance Overview': `$${overviewGrossRevenue.toFixed(2)}`,
        'Monthly Performance': `$${monthlyGrossRevenue.toFixed(2)}`,
        'Difference': `$${(overviewGrossRevenue - monthlyGrossRevenue).toFixed(2)}`,
      },
      'Discounts': {
        'Performance Overview': `$${overviewDiscounts.toFixed(2)}`,
        'Monthly Performance': `$${monthlyDiscounts.toFixed(2)}`,
        'Difference': `$${(overviewDiscounts - monthlyDiscounts).toFixed(2)}`,
      },
      'Net Revenue': {
        'Performance Overview': `$${overviewNetRevenue.toFixed(2)}`,
        'Monthly Performance': `$${monthlyNetRevenue.toFixed(2)}`,
        'Difference': `$${(overviewNetRevenue - monthlyNetRevenue).toFixed(2)}`,
      },
      'COGS/Food Cost': {
        'Performance Overview': `$${overviewFoodCost.toFixed(2)}`,
        'Monthly Performance': `$${monthlyFoodCost.toFixed(2)}`,
        'Difference': `$${(overviewFoodCost - monthlyFoodCost).toFixed(2)}`,
      },
    });
    console.groupEnd();
    
    // Warn about significant discrepancies
    if (grossRevenueDiff > 1) {
      console.warn('⚠️ Gross Revenue mismatch detected:', {
        difference: `$${(overviewGrossRevenue - monthlyGrossRevenue).toFixed(2)}`,
        percentDiff: ((grossRevenueDiff / overviewGrossRevenue) * 100).toFixed(2) + '%',
      });
    }
    
    if (discountsDiff > 1) {
      console.warn('⚠️ Discounts mismatch detected:', {
        difference: `$${(overviewDiscounts - monthlyDiscounts).toFixed(2)}`,
      });
    }
    
    if (netRevenueDiff > 1) {
      console.warn('⚠️ Net Revenue mismatch detected:', {
        difference: `$${(overviewNetRevenue - monthlyNetRevenue).toFixed(2)}`,
        percentDiff: ((netRevenueDiff / overviewNetRevenue) * 100).toFixed(2) + '%',
      });
    }
    
    if (foodCostDiff > 1) {
      console.warn('⚠️ Food Cost mismatch detected:', {
        difference: `$${(overviewFoodCost - monthlyFoodCost).toFixed(2)}`,
      });
    }
  }, [periodMetrics, monthlyData, selectedPeriod]);


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

  // Redirect collaborators to their designated landing page (they don't see the dashboard)
  if (isCollaborator && landingPath !== '/') {
    return <Navigate to={landingPath} replace />;
  }

  return (
    <>
      {/* Welcome Modal for first-time users */}
      <WelcomeModal open={showWelcome} onClose={handleWelcomeClose} />

      {!selectedRestaurant ? (
        <div className="space-y-8">
          <div className="text-center space-y-4 pt-8">
            <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
              <Package className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
                Welcome to Your Dashboard
              </h1>
              <p className="text-[15px] text-muted-foreground mt-1">
                Select or create a restaurant to get started
              </p>
            </div>
          </div>
          <RestaurantSelector 
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            restaurants={restaurants}
            loading={restaurantsLoading}
            canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
          />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-5">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1.5">
                <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
                  {selectedRestaurant.restaurant.name}
                </h1>
                <p className="text-[14px] text-muted-foreground">
                  {new Date().toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  className="h-9 rounded-lg text-[13px] font-medium border-border/40"
                >
                  <Landmark className="h-4 w-4 mr-2" />
                  Banking
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/reports')}
                  className="h-9 rounded-lg text-[13px] font-medium border-border/40"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Reports
                </Button>
                <Button
                  onClick={() => navigate('/inventory')}
                  className="h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                >
                  <Package className="h-4 w-4 mr-2" />
                  Inventory
                </Button>
              </div>
            </div>
            <div className="h-px bg-border/40" />
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
                breakEvenData={breakEvenData ? {
                  dailyBreakEven: breakEvenData.dailyBreakEven,
                  todayStatus: breakEvenData.todayStatus,
                  todayDelta: breakEvenData.todayDelta,
                  daysAbove: breakEvenData.daysAbove,
                  daysBelow: breakEvenData.daysBelow,
                  historyDays: 14,
                } : null}
                breakEvenLoading={breakEvenLoading}
              />

              {/* Sales vs Break-Even Chart */}
              <SalesVsBreakEvenChart data={breakEvenData ?? null} isLoading={breakEvenLoading} />

              {/* AI Insights */}
              <DashboardInsights insights={insights} />

              {/* Period Selector - MOVED TO TOP */}
              <PeriodSelector
                selectedPeriod={selectedPeriod}
                onPeriodChange={setSelectedPeriod}
              />

              {/* ===== OPERATIONAL METRICS SECTION ===== */}

              {/* Key Metrics - Collapsible */}
              <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Performance Overview</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={metricsOpen ? "Collapse Performance Overview" : "Expand Performance Overview"}>
                        {metricsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4" role="region" aria-label="Performance metrics">
                  <DashboardMetricCard
                    title="Your Sales (after discounts/refunds)"
                    value={periodData ? `$${periodData.net_revenue.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.net_revenue, previousPeriodData.net_revenue),
                      label: 'vs previous period'
                    } : undefined}
                    icon={DollarSign}
                    variant={periodData && previousPeriodData && periodData.net_revenue > previousPeriodData.net_revenue ? 'success' : 'default'}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Inventory Purchases"
                    value={inventoryPurchases ? `$${inventoryPurchases.totalPurchases.toFixed(0)}` : '--'}
                    icon={Package}
                    variant="default"
                    subtitle={(() => {
                      if (!inventoryPurchases) return undefined;
                      const netRevenue = periodData?.net_revenue || 0;
                      const purchasePercent = netRevenue > 0 
                        ? ((inventoryPurchases.totalPurchases / netRevenue) * 100).toFixed(1)
                        : '0.0';
                      return `${purchasePercent}% of revenue | ${inventoryPurchases.purchaseCount} purchase${inventoryPurchases.purchaseCount !== 1 ? 's' : ''}`;
                    })()}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="COGS"
                    value={periodData ? `$${periodData.food_cost.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.food_cost_percentage, previousPeriodData.food_cost_percentage),
                      label: 'vs previous period'
                    } : undefined}
                    icon={ShoppingCart}
                    variant={periodData && periodData.food_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={periodData ? `${periodData.food_cost_percentage.toFixed(1)}% of revenue | Target: 28-32%` : undefined}
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
                    subtitle={periodData
                      ? `${periodData.labor_cost_percentage.toFixed(1)}% of revenue | Pending ${currencyFormatter.format(periodData.pending_labor_cost)} • Actual ${currencyFormatter.format(periodData.actual_labor_cost)}`
                      : undefined}
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
                        periodLabel={selectedPeriod.label}
                      />
                    );
                  })()}
                </div>
                {/* Summary Context */}
                {periodData && (
                  <div className="mt-4 rounded-xl border border-border/40 bg-muted/50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/40">
                      <p className="text-[14px] text-foreground">
                        <span className="font-medium">
                          ${(periodData.net_revenue - periodData.food_cost - periodData.labor_cost).toFixed(0)}
                        </span>{' '}
                        <span className="text-muted-foreground">earned after food and labor costs</span>
                        {periodData.net_revenue > 0 && (
                          <span className="text-muted-foreground">
                            {' '}&middot; {((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100).toFixed(1)}% gross margin
                            {((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100) >= 15
                              ? ' — solid'
                              : ((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue * 100) >= 10
                              ? ' — room for improvement'
                              : ' — needs attention'}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-px sm:grid-cols-2 bg-border/40">
                      <div className="bg-background p-3">
                        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Pending Payroll</p>
                        <p className="text-[15px] font-semibold text-foreground mt-0.5">
                          {currencyFormatter.format(periodData.pending_labor_cost)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {periodData.pending_labor_cost_percentage.toFixed(1)}% of revenue
                        </p>
                      </div>
                      <div className="bg-background p-3">
                        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Actual Payroll</p>
                        <p className="text-[15px] font-semibold text-foreground mt-0.5">
                          {currencyFormatter.format(periodData.actual_labor_cost)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {periodData.actual_labor_cost_percentage.toFixed(1)}% of revenue
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Cashflow Visualization - Collapsible */}
              <Collapsible open={cashflowOpen} onOpenChange={setCashflowOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Cashflow</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={cashflowOpen ? "Collapse Cashflow" : "Expand Cashflow"}>
                        {cashflowOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <CashFlowSankeyChart selectedPeriod={selectedPeriod} />
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Monthly Performance Table - Collapsible */}
              <Collapsible open={monthlyOpen} onOpenChange={setMonthlyOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Monthly Performance</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={monthlyOpen ? "Collapse Monthly Performance" : "Expand Monthly Performance"}>
                        {monthlyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <MonthlyBreakdownTable monthlyData={monthlyData} />
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Revenue Mix Section - Collapsible */}
              {!revenueLoading && revenueBreakdown && revenueBreakdown.has_categorization_data && (
                <Collapsible open={revenueOpen} onOpenChange={setRevenueOpen}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-[17px] font-semibold text-foreground">Revenue Mix</h2>
                        <p className="text-[13px] text-muted-foreground mt-0.5">
                          What products are driving your sales
                        </p>
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={revenueOpen ? "Collapse Revenue Mix" : "Expand Revenue Mix"}>
                          {revenueOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    {/* Categorization badge */}
                    <div className="flex items-center">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                        {revenueBreakdown.categorization_rate.toFixed(0)}% categorized
                      </span>
                    </div>
                    <CollapsibleContent>
                <Card className="rounded-xl border border-border/40 bg-background">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
                          <DollarSign className="h-4 w-4 text-foreground" />
                        </div>
                        <div>
                          <CardTitle className="text-[17px] font-semibold text-foreground">Revenue by Category</CardTitle>
                          <CardDescription className="text-[13px] text-muted-foreground">
                            Breakdown by category &middot; {selectedPeriod.label}
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
                        <p className="text-[15px] font-semibold text-foreground">
                          ${revenueBreakdown.totals.gross_revenue.toLocaleString()}
                        </p>
                      </div>
                      {(revenueBreakdown.totals.total_discounts > 0 || revenueBreakdown.totals.total_refunds > 0) && (
                        <div className="p-4 rounded-lg bg-background/50">
                          <p className="text-sm text-muted-foreground mb-1">
                            Discounts & Refunds
                          </p>
                          <p className="text-[15px] font-semibold text-destructive">
                            -${(revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds).toLocaleString()}
                          </p>
                          {revenueBreakdown.totals.gross_revenue > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {((revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue * 100).toFixed(1)}% of gross
                            </p>
                          )}
                        </div>
                      )}
                      <div className="p-4 rounded-lg bg-muted/50 border border-border/40">
                        <p className="text-[13px] text-muted-foreground mb-1">Net Revenue</p>
                        <p className="text-[15px] font-semibold text-foreground">
                          ${revenueBreakdown.totals.net_revenue.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Top Revenue Categories */}
                    {revenueBreakdown.revenue_categories.length > 0 && (
                      <div>
                        <h4 className="text-[13px] font-semibold text-foreground mb-3">
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
                              <p className="text-[14px] font-semibold text-foreground">
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
                          <h4 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                            Collected but Owed
                          </h4>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                            Not Revenue
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mb-3">
                          This money was collected at POS but belongs to staff or government agencies.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {revenueBreakdown.totals.sales_tax > 0 && (
                            <div className="p-3 rounded-lg bg-muted/30 border border-border/40">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[13px] font-medium text-foreground">Sales Tax Collected</p>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                  Liability
                                </span>
                              </div>
                              <p className="text-[15px] font-semibold text-foreground">
                                ${revenueBreakdown.totals.sales_tax.toLocaleString()}
                              </p>
                            </div>
                          )}
                          {revenueBreakdown.totals.tips > 0 && (
                            <div className="p-3 rounded-lg bg-muted/30 border border-border/40">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[13px] font-medium text-foreground">Tips Collected</p>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                  Liability
                                </span>
                              </div>
                              <p className="text-[15px] font-semibold text-foreground">
                                ${revenueBreakdown.totals.tips.toLocaleString()}
                              </p>
                            </div>
                          )}
                          {revenueBreakdown.other_liability_categories.map((category) => (
                            <div key={category.account_id} className="p-3 rounded-lg bg-muted/30 border border-border/40">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[13px] font-medium text-foreground">{category.account_name}</p>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                  Liability
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono text-muted-foreground">{category.account_code}</span>
                                <p className="text-[15px] font-semibold text-foreground">
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

              {/* ===== BANKING SECTION ===== */}

              {/* Bank Snapshot Section */}
              <Collapsible open={bankingOpen} onOpenChange={setBankingOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Banking</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={bankingOpen ? "Collapse Banking" : "Expand Banking"}>
                        {bankingOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    {!banksLoading && connectedBanks && connectedBanks.length > 0 ? (
                      <BankSnapshotSection
                        restaurantId={selectedRestaurant.restaurant_id}
                      />
                    ) : !banksLoading && (!connectedBanks || connectedBanks.length === 0) ? (
                      <div className="rounded-xl border border-dashed border-border/40 p-8 text-center">
                        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                          <Landmark className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <h3 className="text-[15px] font-medium text-foreground mb-1">Connect your bank</h3>
                        <p className="text-[13px] text-muted-foreground mb-4 max-w-sm mx-auto">
                          Get cash flow tracking, spending analysis, and financial intelligence.
                        </p>
                        <Button
                          onClick={() => navigate('/banking')}
                          className="h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                        >
                          <Landmark className="h-4 w-4 mr-2" />
                          Connect Bank Account
                        </Button>
                      </div>
                    ) : null}
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Expenses Section */}
              <Collapsible open={moneyOutOpen} onOpenChange={setMoneyOutOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-[17px] font-semibold text-foreground">Expenses</h2>
                      <p className="text-[13px] text-muted-foreground mt-0.5">Where your money went</p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={moneyOutOpen ? "Collapse Expenses" : "Expand Expenses"}>
                        {moneyOutOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="space-y-6">
                      <OutflowByCategoryCard
                        startDate={selectedPeriod.from}
                        endDate={selectedPeriod.to}
                        periodLabel={selectedPeriod.label}
                      />
                      <TopVendorsCard
                        startDate={selectedPeriod.from}
                        endDate={selectedPeriod.to}
                        periodLabel={selectedPeriod.label}
                      />
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Operations Health */}
              <Collapsible open={operationsOpen} onOpenChange={setOperationsOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Operations Health</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={operationsOpen ? "Collapse Operations Health" : "Expand Operations Health"}>
                        {operationsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <OperationsHealthCard
                      primeCost={periodData?.prime_cost_percentage || 0}
                      primeCostTarget={62}
                      lowInventoryCount={lowStockItems.length}
                      unmappedPOSCount={unmappedItems?.length || 0}
                      uncategorizedTransactions={uncategorizedCount}
                    />
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* AI Operator — Pro only */}
              {hasFeature('ops_inbox') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(opsInboxCounts?.open ?? 0) > 0 && (
                    <button
                      onClick={() => navigate('/ops-inbox')}
                      className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors text-left"
                    >
                      <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
                        <Inbox className="h-5 w-5 text-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-foreground">Ops Inbox</div>
                        <div className="text-[13px] text-muted-foreground">
                          {opsInboxCounts!.open} open item{opsInboxCounts!.open !== 1 ? 's' : ''}
                          {(opsInboxCounts!.critical ?? 0) > 0 && (
                            <span className="text-destructive font-medium"> ({opsInboxCounts!.critical} critical)</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/weekly-brief')}
                    className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors text-left"
                  >
                    <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
                      <Newspaper className="h-5 w-5 text-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-foreground">Weekly Brief</div>
                      <div className="text-[13px] text-muted-foreground">This week's performance summary</div>
                    </div>
                  </button>
                </div>
              )}

              {/* Quick Actions */}
              <Collapsible open={quickActionsOpen} onOpenChange={setQuickActionsOpen}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold text-foreground">Quick Actions</h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground" aria-label={quickActionsOpen ? "Collapse Quick Actions" : "Expand Quick Actions"}>
                        {quickActionsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <DashboardQuickActions />
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </>
          )}
        </div>
      )}
      <OnboardingDrawer />
    </>
  );
};

export default Index;
