import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';
import { DashboardQuickActions } from '@/components/DashboardQuickActions';
import { DashboardInsights } from '@/components/DashboardInsights';
import { DashboardMiniChart } from '@/components/DashboardMiniChart';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { DataInputDialog } from '@/components/DataInputDialog';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { MonthlyBreakdownTable } from '@/components/MonthlyBreakdownTable';
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
  Sparkles
} from 'lucide-react';

const Index = () => {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData, getMonthlyData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const { lowStockItems, reorderAlerts, loading: alertsLoading } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    type: 'today',
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
    label: 'Today',
  });

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  // Calculate period data
  const periodData = useMemo(() => {
    const allData = getGroupedPnLData();
    const fromStr = format(selectedPeriod.from, 'yyyy-MM-dd');
    const toStr = format(selectedPeriod.to, 'yyyy-MM-dd');
    
    const filtered = allData.filter(day => day.date >= fromStr && day.date <= toStr);
    
    if (filtered.length === 0) {
      return null;
    }

    // Aggregate totals
    const totalRevenue = filtered.reduce((sum, day) => sum + day.net_revenue, 0);
    const totalFoodCost = filtered.reduce((sum, day) => sum + day.food_cost, 0);
    const totalLaborCost = filtered.reduce((sum, day) => sum + day.labor_cost, 0);
    const totalPrimeCost = filtered.reduce((sum, day) => sum + day.prime_cost, 0);
    
    // Calculate percentages from aggregated totals (guard against division by zero)
    const avgFoodCostPercentage = totalRevenue > 0 ? (totalFoodCost / totalRevenue) * 100 : 0;
    const avgLaborCostPercentage = totalRevenue > 0 ? (totalLaborCost / totalRevenue) * 100 : 0;
    const avgPrimeCostPercentage = totalRevenue > 0 ? (totalPrimeCost / totalRevenue) * 100 : 0;

    return {
      net_revenue: totalRevenue,
      food_cost: totalFoodCost,
      labor_cost: totalLaborCost,
      food_cost_percentage: avgFoodCostPercentage,
      labor_cost_percentage: avgLaborCostPercentage,
      prime_cost_percentage: avgPrimeCostPercentage,
      daily_data: filtered,
    };
  }, [getGroupedPnLData, selectedPeriod]);

  // Calculate previous period data for comparison
  const previousPeriodData = useMemo(() => {
    const allData = getGroupedPnLData();
    const periodLength = differenceInDays(selectedPeriod.to, selectedPeriod.from) + 1;
    
    const prevTo = new Date(selectedPeriod.from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - periodLength + 1);
    
    const fromStr = format(prevFrom, 'yyyy-MM-dd');
    const toStr = format(prevTo, 'yyyy-MM-dd');
    
    const filtered = allData.filter(day => day.date >= fromStr && day.date <= toStr);
    
    if (filtered.length === 0) {
      return null;
    }

    const totalRevenue = filtered.reduce((sum, day) => sum + day.net_revenue, 0);
    const totalFoodCost = filtered.reduce((sum, day) => sum + day.food_cost, 0);
    const totalLaborCost = filtered.reduce((sum, day) => sum + day.labor_cost, 0);
    const totalPrimeCost = filtered.reduce((sum, day) => sum + day.prime_cost, 0);
    
    // Calculate percentages from aggregated totals (guard against division by zero)
    const avgFoodCostPercentage = totalRevenue > 0 ? (totalFoodCost / totalRevenue) * 100 : 0;
    const avgLaborCostPercentage = totalRevenue > 0 ? (totalLaborCost / totalRevenue) * 100 : 0;
    const avgPrimeCostPercentage = totalRevenue > 0 ? (totalPrimeCost / totalRevenue) * 100 : 0;

    return {
      net_revenue: totalRevenue,
      food_cost_percentage: avgFoodCostPercentage,
      labor_cost_percentage: avgLaborCostPercentage,
      prime_cost_percentage: avgPrimeCostPercentage,
    };
  }, [getGroupedPnLData, selectedPeriod]);

  const todaysData = getTodaysData();
  const averages = getAverages(7);
  const recentData = getGroupedPnLData().slice(0, 30);

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
    if (todaysData && averages) {
      if (todaysData.food_cost_percentage > averages.avgFoodCostPercentage + 5) {
        insightsArray.push({
          type: 'warning',
          title: 'Food Cost Above Average',
          description: `Today's food cost (${todaysData.food_cost_percentage.toFixed(1)}%) is ${(todaysData.food_cost_percentage - averages.avgFoodCostPercentage).toFixed(1)}% higher than your 7-day average. Check for waste or price increases.`
        });
      } else if (todaysData.food_cost_percentage < averages.avgFoodCostPercentage - 2) {
        insightsArray.push({
          type: 'success',
          title: 'Excellent Food Cost Control',
          description: `Food cost is ${(averages.avgFoodCostPercentage - todaysData.food_cost_percentage).toFixed(1)}% below your average. Great work!`
        });
      }
    }

    // Prime cost check
    if (todaysData && todaysData.prime_cost_percentage > 65) {
      insightsArray.push({
        type: 'warning',
        title: 'Prime Cost Above Target',
        description: `Prime cost at ${todaysData.prime_cost_percentage.toFixed(1)}% exceeds the recommended 60-65% range. Consider reviewing labor schedules and food costs.`
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
  }, [reorderAlerts, todaysData, averages, lowStockItems]);

  // Prepare chart data with memoization
  const getChartData = useMemo(() => {
    return (key: 'net_revenue' | 'food_cost_percentage' | 'prime_cost_percentage') => {
      return recentData.slice(0, 14).reverse().map(day => ({
        date: day.date,
        value: day[key]
      }));
    };
  }, [recentData]);

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

          {pnlLoading || alertsLoading ? (
            <DashboardSkeleton />
          ) : (
            <>
              {/* AI Insights */}
              <DashboardInsights insights={insights} />

              {/* Period Selector */}
              <PeriodSelector
                selectedPeriod={selectedPeriod}
                onPeriodChange={setSelectedPeriod}
              />

              {/* Key Metrics */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
                  <h2 className="text-2xl font-bold tracking-tight">Performance Overview</h2>
                  <Sparkles className="h-5 w-5 text-primary/60" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Performance metrics">
                  <DashboardMetricCard
                    title="Net Revenue"
                    value={periodData ? `$${periodData.net_revenue.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.net_revenue, previousPeriodData.net_revenue),
                      label: 'vs previous period'
                    } : undefined}
                    icon={DollarSign}
                    variant={periodData && previousPeriodData && periodData.net_revenue > previousPeriodData.net_revenue ? 'success' : 'default'}
                    sparklineData={periodData?.daily_data.map(d => ({ value: d.net_revenue }))}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Food Cost"
                    value={periodData ? `$${periodData.food_cost.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.food_cost_percentage, previousPeriodData.food_cost_percentage),
                      label: 'vs previous period'
                    } : undefined}
                    icon={ShoppingCart}
                    variant={periodData && periodData.food_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={periodData ? `${periodData.food_cost_percentage.toFixed(1)}% of revenue | Target: 28-32%` : undefined}
                    sparklineData={periodData?.daily_data.map(d => ({ value: d.food_cost }))}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Labor Cost"
                    value={periodData ? `$${periodData.labor_cost.toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(periodData.labor_cost_percentage, previousPeriodData.labor_cost_percentage),
                      label: 'vs previous period'
                    } : undefined}
                    icon={Clock}
                    variant={periodData && periodData.labor_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={periodData ? `${periodData.labor_cost_percentage.toFixed(1)}% of revenue | Target: 25-30%` : undefined}
                    sparklineData={periodData?.daily_data.map(d => ({ value: d.labor_cost }))}
                    periodLabel={selectedPeriod.label}
                  />
                  <DashboardMetricCard
                    title="Profit"
                    value={periodData ? `$${(periodData.net_revenue - periodData.food_cost - periodData.labor_cost).toFixed(0)}` : '--'}
                    trend={periodData && previousPeriodData ? {
                      value: getTrendValue(
                        periodData.net_revenue - periodData.food_cost - periodData.labor_cost,
                        previousPeriodData.net_revenue * (1 - (previousPeriodData.food_cost_percentage + previousPeriodData.labor_cost_percentage) / 100)
                      ),
                      label: 'vs previous period'
                    } : undefined}
                    icon={TrendingUp}
                    variant={
                      periodData && periodData.net_revenue > 0
                        ? (() => {
                            const profitMargin = ((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue) * 100;
                            return profitMargin > 15 ? 'success' : profitMargin < 5 ? 'danger' : profitMargin < 10 ? 'warning' : 'default';
                          })()
                        : 'default'
                    }
                    subtitle={periodData && periodData.net_revenue > 0 ? `${(((periodData.net_revenue - periodData.food_cost - periodData.labor_cost) / periodData.net_revenue) * 100).toFixed(1)}% margin` : undefined}
                    sparklineData={periodData?.daily_data.map(d => ({ value: d.net_revenue - d.food_cost - d.labor_cost }))}
                    periodLabel={selectedPeriod.label}
                  />
                </div>
              </div>

              {/* Alerts & Trends */}
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
                  data={getChartData('net_revenue')}
                  color="#10b981"
                  suffix="$"
                />

                {/* Food Cost Trend */}
                <DashboardMiniChart
                  title="Food Cost Trend"
                  description="Last 14 days"
                  data={getChartData('food_cost_percentage')}
                  color="#f59e0b"
                  suffix="%"
                />
              </div>

              {/* Quick Actions */}
              <DashboardQuickActions restaurantId={selectedRestaurant.restaurant_id} />

              {/* Monthly Performance Table */}
              <MonthlyBreakdownTable monthlyData={getMonthlyData()} />
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Index;
