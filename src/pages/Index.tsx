import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useDailyPnL } from '@/hooks/useDailyPnL';
import { DataInputDialog } from '@/components/DataInputDialog';
import { Store } from 'lucide-react';

const Index = () => {
  const { user, signOut, loading } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const { pnlData, loading: pnlLoading, getTodaysData, getAverages, getGroupedPnLData, fetchPnLData } = useDailyPnL(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

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

  if (!selectedRestaurant) {
    return (
      <div className="py-8">
        <div className="text-center">
          <Store className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Restaurant Selected</h3>
          <p className="text-muted-foreground">
            Please select a restaurant from the header to view dashboard.
          </p>
        </div>
      </div>
    );
  }

  const todaysData = getTodaysData();
  const averages = getAverages(7); // 7-day averages

  return (
    <div className="min-h-screen bg-background">
      <div className="py-4 md:py-6">
        <div className="text-center md:text-left mb-6">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Daily P&L Dashboard</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            Track your restaurant's financial performance
          </p>
        </div>

        <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Button 
            variant="outline" 
            onClick={() => navigate('/integrations')} 
            className="h-24 flex flex-col justify-center"
          >
            <span className="text-lg font-medium">Integrations</span>
            <span className="text-xs text-muted-foreground">Connect POS systems</span>
          </Button>
          
          <Button 
            variant="outline" 
            onClick={() => navigate('/pos-sales')} 
            className="h-24 flex flex-col justify-center"
          >
            <span className="text-lg font-medium">POS Sales</span>
            <span className="text-xs text-muted-foreground">View sales data</span>
          </Button>
          
          <Button 
            variant="outline" 
            onClick={() => navigate('/recipes')} 
            className="h-24 flex flex-col justify-center"
          >
            <span className="text-lg font-medium">Recipes</span>
            <span className="text-xs text-muted-foreground">Manage recipes & costs</span>
          </Button>
          
          <Button 
            variant="outline" 
            onClick={() => navigate('/inventory')} 
            className="h-24 flex flex-col justify-center"
          >
            <span className="text-lg font-medium">Inventory</span>
            <span className="text-xs text-muted-foreground">Track products</span>
          </Button>
        </div>

        <DataInputDialog 
          restaurantId={selectedRestaurant?.restaurant_id}
          onDataUpdated={fetchPnLData}
        />
      </div>
    </div>
  );
};

export default Index;