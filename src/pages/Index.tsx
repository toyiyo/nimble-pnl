import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DataInputDialog } from '@/components/DataInputDialog';

const Index = () => {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData, fetchPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const todaysData = getTodaysData();
  const averages = getAverages(7); // 7-day averages

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
            </>
          )}
        </div>
      )}
    </>
  );
};

export default Index;
