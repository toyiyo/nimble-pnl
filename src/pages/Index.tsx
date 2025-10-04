import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DataInputDialog } from '@/components/DataInputDialog';
import { PnLTrendChart } from '@/components/PnLTrendChart';
import { CostBreakdownChart } from '@/components/CostBreakdownChart';

const Index = () => {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData, getWeeklyData, getMonthlyData, fetchPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();
  const [timeFrame, setTimeFrame] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const todaysData = getTodaysData();
  const averages = getAverages(7); // 7-day averages

  // Get trend data based on time frame
  const getTrendData = () => {
    if (timeFrame === 'weekly') {
      return getWeeklyData().slice(0, 12); // Last 12 weeks
    } else if (timeFrame === 'monthly') {
      return getMonthlyData().slice(0, 12); // Last 12 months
    } else {
      // Transform daily data to include period
      return getGroupedPnLData().slice(0, 30).map(day => ({
        ...day,
        period: day.date
      })); // Last 30 days
    }
  };

  // Get breakdown data based on time frame
  const getBreakdownData = () => {
    const data = timeFrame === 'weekly' 
      ? getWeeklyData().slice(0, 4) // Last 4 weeks
      : timeFrame === 'monthly'
      ? getMonthlyData().slice(0, 3) // Last 3 months
      : getGroupedPnLData().slice(0, 7); // Last 7 days

    return data.reduce(
      (acc, item) => ({
        food_cost: acc.food_cost + item.food_cost,
        labor_cost: acc.labor_cost + item.labor_cost,
        net_revenue: acc.net_revenue + item.net_revenue,
      }),
      { food_cost: 0, labor_cost: 0, net_revenue: 0 }
    );
  };

  return (
    <>
      {!selectedRestaurant ? (
        <RestaurantSelector 
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          restaurants={restaurants}
          loading={restaurantsLoading}
          createRestaurant={createRestaurant}
        />
      ) : (
        <div className="space-y-6 md:space-y-8">
          <div className="text-center md:text-left">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Daily P&L Dashboard</h2>
            <p className="text-sm md:text-base text-muted-foreground">
              Real-time food cost tracking and profitability insights for {selectedRestaurant.restaurant.name}
            </p>
            <div className="mt-4 flex justify-center md:justify-start">
              <DataInputDialog 
                restaurantId={selectedRestaurant.restaurant_id}
                onDataUpdated={fetchPnLData}
              />
            </div>
          </div>
          
          {pnlLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading P&L data...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <div className="p-4 md:p-6 border rounded-lg">
                  <h3 className="text-base md:text-lg font-semibold mb-2">Food Cost %</h3>
                  <p className="text-2xl md:text-3xl font-bold text-primary">
                    {todaysData ? `${todaysData.food_cost_percentage.toFixed(1)}%` : '--'}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    {averages ? `7-day avg: ${averages.avgFoodCostPercentage.toFixed(1)}%` : 'No historical data'}
                  </p>
                </div>
                
                <div className="p-4 md:p-6 border rounded-lg">
                  <h3 className="text-base md:text-lg font-semibold mb-2">Labor Cost %</h3>
                  <p className="text-2xl md:text-3xl font-bold text-primary">
                    {todaysData ? `${todaysData.labor_cost_percentage.toFixed(1)}%` : '--'}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    {averages ? `7-day avg: ${averages.avgLaborCostPercentage.toFixed(1)}%` : 'No historical data'}
                  </p>
                </div>
                
                <div className="p-4 md:p-6 border rounded-lg">
                  <h3 className="text-base md:text-lg font-semibold mb-2">Prime Cost %</h3>
                  <p className="text-2xl md:text-3xl font-bold text-primary">
                    {todaysData ? `${todaysData.prime_cost_percentage.toFixed(1)}%` : '--'}
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    {averages ? `7-day avg: ${averages.avgPrimeCostPercentage.toFixed(1)}%` : 'No historical data'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <div className="p-4 md:p-6 border rounded-lg">
                  <h3 className="text-base md:text-lg font-semibold mb-4">Today's Summary</h3>
                  {todaysData ? (
                    <div className="space-y-3 text-sm md:text-base">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Revenue</span>
                        <span className="font-medium">${todaysData.net_revenue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Food Costs</span>
                        <span className="font-medium">${todaysData.food_cost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Labor Costs</span>
                        <span className="font-medium">${todaysData.labor_cost.toFixed(2)}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-semibold">
                        <span>Gross Profit</span>
                        <span className="text-primary">${todaysData.gross_profit.toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No data for today. Add daily data to see your P&L.</p>
                  )}
                </div>

                <div className="p-4 md:p-6 border rounded-lg">
                  <h3 className="text-base md:text-lg font-semibold mb-4">Recent Performance</h3>
                  {getGroupedPnLData().length > 0 ? (
                    <div className="space-y-3">
                      {getGroupedPnLData().slice(0, 5).map((day) => (
                        <div key={day.date} className="flex justify-between items-center">
                          <div>
                            <span className="text-sm font-medium">
                              {new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                                month: 'numeric',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                             <span className="text-xs text-muted-foreground ml-2">
                               ${day.net_revenue.toFixed(2)} revenue
                             </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-medium">
                              {day.prime_cost_percentage.toFixed(1)}%
                            </span>
                            <span className="text-xs text-muted-foreground block">
                              prime cost
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No historical data available.</p>
                  )}
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-xl md:text-2xl font-bold mb-4">Performance Analytics</h3>
                <Tabs value={timeFrame} onValueChange={(value) => setTimeFrame(value as any)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="daily">Daily</TabsTrigger>
                    <TabsTrigger value="weekly">Weekly</TabsTrigger>
                    <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  </TabsList>

                  <TabsContent value="daily" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <PnLTrendChart 
                        data={getTrendData()} 
                        title="Daily P&L Trends (Last 30 Days)"
                      />
                      <CostBreakdownChart 
                        data={getBreakdownData()} 
                        title="Cost Breakdown (Last 7 Days)"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="weekly" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <PnLTrendChart 
                        data={getTrendData()} 
                        title="Weekly P&L Trends (Last 12 Weeks)"
                      />
                      <CostBreakdownChart 
                        data={getBreakdownData()} 
                        title="Cost Breakdown (Last 4 Weeks)"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="monthly" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <PnLTrendChart 
                        data={getTrendData()} 
                        title="Monthly P&L Trends (Last 12 Months)"
                      />
                      <CostBreakdownChart 
                        data={getBreakdownData()} 
                        title="Cost Breakdown (Last 3 Months)"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Index;
