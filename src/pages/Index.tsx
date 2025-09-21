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
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, fetchPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
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
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Restaurant Operations</h1>
            {selectedRestaurant && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">•</span>
                <span className="text-sm font-medium">{selectedRestaurant.restaurant.name}</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedRestaurant(null)}
                >
                  Switch
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.email}
            </span>
            <Button variant="outline" onClick={() => navigate('/integrations')}>
              Integrations
            </Button>
            <Button variant="outline" onClick={() => navigate('/inventory')}>
              Inventory
            </Button>
            <Button variant="outline" onClick={() => navigate('/team')}>
              Team
            </Button>
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </nav>
      
      <main className="container py-6">
        {!selectedRestaurant ? (
          <RestaurantSelector 
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            restaurants={restaurants}
            loading={restaurantsLoading}
            createRestaurant={createRestaurant}
          />
        ) : (
          <div>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-bold mb-2">Daily P&L Dashboard</h2>
                <p className="text-muted-foreground">
                  Real-time food cost tracking and profitability insights for {selectedRestaurant.restaurant.name}
                </p>
              </div>
              <div className="flex gap-2">
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="p-6 border rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Food Cost %</h3>
                    <p className="text-3xl font-bold text-primary">
                      {todaysData ? `${todaysData.food_cost_percentage.toFixed(1)}%` : '--'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {averages ? `7-day avg: ${averages.avgFoodCostPercentage.toFixed(1)}%` : 'No historical data'}
                    </p>
                  </div>
                  
                  <div className="p-6 border rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Labor Cost %</h3>
                    <p className="text-3xl font-bold text-primary">
                      {todaysData ? `${todaysData.labor_cost_percentage.toFixed(1)}%` : '--'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {averages ? `7-day avg: ${averages.avgLaborCostPercentage.toFixed(1)}%` : 'No historical data'}
                    </p>
                  </div>
                  
                  <div className="p-6 border rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Prime Cost %</h3>
                    <p className="text-3xl font-bold text-primary">
                      {todaysData ? `${todaysData.prime_cost_percentage.toFixed(1)}%` : '--'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {averages ? `7-day avg: ${averages.avgPrimeCostPercentage.toFixed(1)}%` : 'No historical data'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="p-6 border rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Today's Summary</h3>
                    {todaysData ? (
                      <div className="space-y-3">
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
                      <p className="text-muted-foreground">No data for today. Add daily data to see your P&L.</p>
                    )}
                  </div>

                  <div className="p-6 border rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Recent Performance</h3>
                    {pnlData.length > 0 ? (
                      <div className="space-y-3">
                        {pnlData.slice(0, 5).map((day) => (
                          <div key={day.id} className="flex justify-between items-center">
                            <div>
                              <span className="text-sm font-medium">
                                {new Date(day.date).toLocaleDateString()}
                              </span>
                              <span className="text-xs text-muted-foreground ml-2">
                                ${day.net_revenue.toFixed(0)} revenue
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
                      <p className="text-muted-foreground">No historical data available.</p>
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
