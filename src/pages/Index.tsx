import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { DataInputDialog } from '@/components/DataInputDialog';

const Index = () => {
  const { user, signOut, loading } = useAuth();
  const { restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData, fetchPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Auto-select first restaurant if only one exists
    if (restaurants.length === 1 && !selectedRestaurant) {
      setSelectedRestaurant(restaurants[0]);
    }
  }, [restaurants, selectedRestaurant]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleRestaurantSelect = (restaurant: UserRestaurant) => {
    setSelectedRestaurant(restaurant);
  };

  const todaysData = getTodaysData();
  const averages = getAverages(7); // 7-day averages

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container px-4">
          {/* Mobile-first navigation */}
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <h1 className="text-lg md:text-xl font-semibold truncate">Restaurant Operations</h1>
              {selectedRestaurant && (
                <div className="hidden sm:flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">•</span>
                  <span className="text-sm font-medium truncate">{selectedRestaurant.restaurant.name}</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedRestaurant(null)}
                    className="text-xs"
                  >
                    Switch
                  </Button>
                </div>
              )}
            </div>
            
            {/* Mobile menu - horizontal scroll for buttons */}
            <div className="flex items-center gap-1 md:gap-4 overflow-x-auto">
              <span className="hidden md:block text-sm text-muted-foreground truncate">
                Welcome, {user.email}
              </span>
              <div className="flex gap-1 md:gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/integrations')} className="text-xs whitespace-nowrap">
                  Integrations
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/pos-sales')} className="text-xs whitespace-nowrap">
                  POS Sales
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/recipes')} className="text-xs whitespace-nowrap">
                  Recipes
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/inventory')} className="text-xs whitespace-nowrap">
                  Inventory
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/team')} className="text-xs whitespace-nowrap">
                  Team
                </Button>
                <Button variant="outline" size="sm" onClick={signOut} className="text-xs whitespace-nowrap">
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
          
          {/* Mobile restaurant info */}
          {selectedRestaurant && (
            <div className="sm:hidden py-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{selectedRestaurant.restaurant.name}</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedRestaurant(null)}
                  className="text-xs"
                >
                  Switch Restaurant
                </Button>
              </div>
            </div>
          )}
        </div>
      </nav>
      
      <main className="container px-4 py-4 md:py-6">
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
      </main>
    </div>
  );
};

export default Index;
