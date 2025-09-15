import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { RestaurantSelector } from '@/components/RestaurantSelector';

const Index = () => {
  const { user, signOut, loading } = useAuth();
  const { restaurants } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);
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
          />
        ) : (
          <div>
            <div className="mb-8">
              <h2 className="text-3xl font-bold mb-2">Daily P&L Dashboard</h2>
              <p className="text-muted-foreground">
                Real-time food cost tracking and profitability insights for {selectedRestaurant.restaurant.name}
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="p-6 border rounded-lg">
                <h3 className="text-lg font-semibold mb-2">Food Cost %</h3>
                <p className="text-3xl font-bold text-primary">28.5%</p>
                <p className="text-sm text-muted-foreground">vs 30% target</p>
              </div>
              
              <div className="p-6 border rounded-lg">
                <h3 className="text-lg font-semibold mb-2">Labor Cost %</h3>
                <p className="text-3xl font-bold text-primary">32.1%</p>
                <p className="text-sm text-muted-foreground">vs 30% target</p>
              </div>
              
              <div className="p-6 border rounded-lg">
                <h3 className="text-lg font-semibold mb-2">Prime Cost %</h3>
                <p className="text-3xl font-bold text-primary">60.6%</p>
                <p className="text-sm text-muted-foreground">vs 60% target</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 border rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Today's Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Revenue</span>
                    <span className="font-medium">$2,450</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Food Costs</span>
                    <span className="font-medium">$698</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Labor Costs</span>
                    <span className="font-medium">$786</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-semibold">
                    <span>Gross Profit</span>
                    <span className="text-primary">$966</span>
                  </div>
                </div>
              </div>

              <div className="p-6 border rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="h-20 flex flex-col">
                    <span className="text-sm">Import</span>
                    <span className="text-xs text-muted-foreground">POS Data</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <span className="text-sm">Upload</span>
                    <span className="text-xs text-muted-foreground">Invoices</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <span className="text-sm">View</span>
                    <span className="text-xs text-muted-foreground">Reports</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <span className="text-sm">Manage</span>
                    <span className="text-xs text-muted-foreground">Inventory</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
