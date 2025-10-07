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
  Activity
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
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">Welcome to Your Restaurant Dashboard</h1>
            <p className="text-muted-foreground">
              Select or create a restaurant to get started with intelligent insights
            </p>
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
          {/* Header */}
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Welcome back! 👋
              </h1>
              <p className="text-muted-foreground mt-1">
                {selectedRestaurant.restaurant.name} • {new Date().toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <DataInputDialog 
                restaurantId={selectedRestaurant.restaurant_id}
                onDataUpdated={() => {
                  // Refresh PnL data after manual entry
                  window.location.reload();
                }}
                className="w-full sm:w-auto"
              />
              <Button variant="outline" onClick={() => navigate('/reports')} className="w-full sm:w-auto">
                <TrendingUp className="h-4 w-4 mr-2" />
                View Reports
              </Button>
              <Button onClick={() => navigate('/inventory')} className="w-full sm:w-auto">
                <Package className="h-4 w-4 mr-2" />
                Manage Inventory
              </Button>
            </div>
          </div>

          {pnlLoading || alertsLoading ? (
            <div className="text-center py-12">
              <Activity className="h-12 w-12 mx-auto mb-4 animate-pulse text-primary" />
              <p className="text-muted-foreground">Loading your dashboard...</p>
            </div>
          ) : (
            <>
              {/* AI Insights */}
              <DashboardInsights insights={insights} />

              {/* Key Metrics */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Today's Performance</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                {/* Alerts */}
                <Card className={reorderAlerts.length > 0 ? 'border-destructive/50' : ''}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Inventory Alerts
                    </CardTitle>
                    <CardDescription>Items needing attention</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reorderAlerts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">All inventory levels are healthy</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Reorder Needed</span>
                          <Badge variant="destructive">{reorderAlerts.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Low Stock</span>
                          <Badge variant="outline">{lowStockItems.length}</Badge>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full mt-2"
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

              {/* Recent Activity Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Today's Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {todaysData ? (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Net Revenue</span>
                          <span className="font-semibold">${todaysData.net_revenue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Food Costs</span>
                          <span className="font-semibold">${todaysData.food_cost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Labor Costs</span>
                          <span className="font-semibold">${todaysData.labor_cost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t">
                          <span className="font-medium">Gross Profit</span>
                          <span className="font-bold text-lg text-primary">
                            ${todaysData.gross_profit.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No data for today. Start tracking your performance!
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Last 7 Days</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {recentData.slice(0, 7).length > 0 ? (
                      <div className="space-y-2">
                        {recentData.slice(0, 7).map((day, index) => (
                          <div key={day.date} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${
                                index === 0 ? 'bg-primary animate-pulse' : 'bg-muted'
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
                              <span className="text-xs text-muted-foreground">
                                ${day.net_revenue.toFixed(0)}
                              </span>
                              <Badge 
                                variant={day.prime_cost_percentage < 60 ? 'default' : day.prime_cost_percentage > 65 ? 'destructive' : 'secondary'}
                                className="text-xs"
                              >
                                {day.prime_cost_percentage.toFixed(1)}%
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No historical data available
                      </p>
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
