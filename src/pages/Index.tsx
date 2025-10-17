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
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const { lowStockItems, reorderAlerts, loading: alertsLoading } = useInventoryAlerts(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

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

              {/* Key Metrics */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
                  <h2 className="text-2xl font-bold tracking-tight">Today's Performance</h2>
                  <Sparkles className="h-5 w-5 text-primary/60" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Performance metrics">
                  <DashboardMetricCard
                    title="Net Revenue"
                    value={todaysData ? `$${todaysData.net_revenue.toFixed(0)}` : '--'}
                    trend={todaysData && averages ? {
                      value: getTrendValue(todaysData.net_revenue, averages.avgRevenue),
                      label: 'vs 7-day avg'
                    } : undefined}
                    icon={DollarSign}
                    variant={todaysData && averages && todaysData.net_revenue > averages.avgRevenue ? 'success' : 'default'}
                  />
                  <DashboardMetricCard
                    title="Food Cost %"
                    value={todaysData ? `${todaysData.food_cost_percentage.toFixed(1)}%` : '--'}
                    trend={todaysData && averages ? {
                      value: getTrendValue(todaysData.food_cost_percentage, averages.avgFoodCostPercentage),
                      label: 'vs 7-day avg'
                    } : undefined}
                    icon={ShoppingCart}
                    variant={todaysData && todaysData.food_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={averages ? `Target: 28-32% | Avg: ${averages.avgFoodCostPercentage.toFixed(1)}%` : undefined}
                  />
                  <DashboardMetricCard
                    title="Labor Cost %"
                    value={todaysData ? `${todaysData.labor_cost_percentage.toFixed(1)}%` : '--'}
                    trend={todaysData && averages ? {
                      value: getTrendValue(todaysData.labor_cost_percentage, averages.avgLaborCostPercentage),
                      label: 'vs 7-day avg'
                    } : undefined}
                    icon={Clock}
                    variant={todaysData && todaysData.labor_cost_percentage > 35 ? 'warning' : 'default'}
                    subtitle={averages ? `Target: 25-30% | Avg: ${averages.avgLaborCostPercentage.toFixed(1)}%` : undefined}
                  />
                  <DashboardMetricCard
                    title="Prime Cost %"
                    value={todaysData ? `${todaysData.prime_cost_percentage.toFixed(1)}%` : '--'}
                    trend={todaysData && averages ? {
                      value: getTrendValue(todaysData.prime_cost_percentage, averages.avgPrimeCostPercentage),
                      label: 'vs 7-day avg'
                    } : undefined}
                    icon={Target}
                    variant={todaysData && todaysData.prime_cost_percentage > 65 ? 'danger' : todaysData && todaysData.prime_cost_percentage < 60 ? 'success' : 'default'}
                    subtitle={averages ? `Target: 60-65% | Avg: ${averages.avgPrimeCostPercentage.toFixed(1)}%` : undefined}
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

              {/* Enhanced Recent Activity Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="group transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 animate-fade-in bg-gradient-to-br from-card via-background to-muted/20">
                  <CardHeader className="border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className="h-1 w-6 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
                      Today's Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    {todaysData ? (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-2.5 rounded-lg hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <span className="text-sm text-muted-foreground">Net Revenue</span>
                          </div>
                          <span className="font-semibold">${todaysData.net_revenue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center p-2.5 rounded-lg hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <ShoppingCart className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                            <span className="text-sm text-muted-foreground">Food Costs</span>
                          </div>
                          <span className="font-semibold">${todaysData.food_cost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center p-2.5 rounded-lg hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            <span className="text-sm text-muted-foreground">Labor Costs</span>
                          </div>
                          <span className="font-semibold">${todaysData.labor_cost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-3 mt-2 border-t p-2.5 rounded-lg bg-gradient-to-r from-primary/10 to-transparent">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-primary" />
                            <span className="font-semibold">Gross Profit</span>
                          </div>
                          <span className="font-bold text-lg text-primary">
                            ${todaysData.gross_profit.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 space-y-3">
                        <div className="inline-flex p-3 rounded-lg bg-muted">
                          <Activity className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-1">
                            No data for today
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Start tracking your performance!
                          </p>
                        </div>
                        <Button size="sm" onClick={() => navigate('/inventory')}>
                          <Package className="h-4 w-4 mr-2" />
                          Add Data
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="group transition-all duration-300 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 animate-fade-in bg-gradient-to-br from-card via-background to-muted/20">
                  <CardHeader className="border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className="h-1 w-6 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
                      Last 7 Days
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    {recentData.slice(0, 7).length > 0 ? (
                      <div className="space-y-2">
                        {recentData.slice(0, 7).map((day, index) => (
                          <div 
                            key={day.date} 
                            className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-all cursor-pointer group/day"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                                index === 0 
                                  ? 'bg-primary shadow-lg shadow-primary/50 animate-pulse scale-110' 
                                  : 'bg-muted group-hover/day:bg-primary/50'
                              }`} />
                              <span className="text-xs font-medium">
                                {new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold text-muted-foreground group-hover/day:text-foreground transition-colors">
                                ${day.net_revenue.toFixed(0)}
                              </span>
                              <Badge 
                                variant={day.prime_cost_percentage < 60 ? 'default' : day.prime_cost_percentage > 65 ? 'destructive' : 'secondary'}
                                className="text-xs font-semibold min-w-[3rem] justify-center"
                              >
                                {day.prime_cost_percentage.toFixed(1)}%
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 space-y-3">
                        <div className="inline-flex p-3 rounded-lg bg-muted">
                          <TrendingDown className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-1">
                            No historical data available
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Start tracking to see trends
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Index;
