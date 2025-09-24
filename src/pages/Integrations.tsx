import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants, UserRestaurant } from '@/hooks/useRestaurants';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { IntegrationCard } from '@/components/IntegrationCard';
import { ExternalLink, Settings, ArrowLeft } from 'lucide-react';

const Integrations = () => {
  const { user, loading } = useAuth();
  const { restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<UserRestaurant | null>(null);
  const { isConnected: squareConnected } = useSquareIntegration(selectedRestaurant?.restaurant_id || null);
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

  const integrations = [
    {
      id: 'toast-pos',
      name: 'Toast POS',
      description: 'Automatically sync sales data, transactions, and menu items',
      category: 'Point of Sale',
      logo: '🍞',
      connected: false,
      features: ['Sales Data', 'Transaction History', 'Menu Items', 'Customer Data']
    },
    {
      id: 'square-pos',
      name: 'Square',
      description: 'Import sales, payments, and inventory data from Square',
      category: 'Point of Sale',
      logo: '⬜',
      connected: squareConnected,
      features: ['Sales Data', 'Payment Processing', 'Inventory', 'Analytics']
    },
    {
      id: '7shifts',
      name: '7shifts',
      description: 'Pull employee schedules, labor costs, and time tracking data',
      category: 'Scheduling',
      logo: '📅',
      connected: false,
      features: ['Employee Schedules', 'Labor Costs', 'Time Tracking', 'Payroll Data']
    },
    {
      id: 'when-i-work',
      name: 'When I Work',
      description: 'Sync staff scheduling and labor cost information',
      category: 'Scheduling',
      logo: '⏰',
      connected: false,
      features: ['Staff Scheduling', 'Time Clock', 'Labor Costs', 'Availability']
    },
    {
      id: 'quickbooks',
      name: 'QuickBooks',
      description: 'Import accounting data, expenses, and financial reports',
      category: 'Accounting',
      logo: '💼',
      connected: false,
      features: ['Financial Data', 'Expense Tracking', 'Reports', 'Tax Data']
    },
    {
      id: 'sysco',
      name: 'Sysco',
      description: 'Automatically import food costs and inventory purchases',
      category: 'Food Service',
      logo: '🚚',
      connected: false,
      features: ['Purchase Orders', 'Food Costs', 'Inventory', 'Delivery Tracking']
    }
  ];

  const groupedIntegrations = integrations.reduce((acc, integration) => {
    if (!acc[integration.category]) {
      acc[integration.category] = [];
    }
    acc[integration.category].push(integration);
    return acc;
  }, {} as Record<string, typeof integrations>);

  const connectedCount = integrations.filter(integration => integration.connected).length;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="p-2 md:px-3">
                <ArrowLeft className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Back to Dashboard</span>
              </Button>
              <div className="hidden sm:block h-4 w-px bg-border" />
              <h1 className="text-lg md:text-xl font-semibold truncate">Integrations</h1>
              {selectedRestaurant && (
                <div className="hidden lg:flex items-center gap-2">
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
            <div className="flex items-center gap-1 md:gap-4">
              <Button variant="outline" size="sm" onClick={() => navigate('/team')} className="text-xs whitespace-nowrap">
                Team
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/')} className="text-xs whitespace-nowrap">
                Dashboard
              </Button>
            </div>
          </div>
          
          {/* Mobile restaurant info */}
          {selectedRestaurant && (
            <div className="lg:hidden py-2 border-t">
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
          <div>
            <div className="mb-6 md:mb-8 text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-bold mb-2">Connect Your Applications</h2>
              <p className="text-sm md:text-base text-muted-foreground">
                Please select a restaurant to manage integrations
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
          <div className="space-y-6 md:space-y-8">
            <div className="text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-bold mb-2">Connect Your Applications</h2>
              <p className="text-sm md:text-base text-muted-foreground">
                Automatically sync data from your existing tools to eliminate manual data entry
              </p>
            </div>

            {/* Connected Integrations Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <Settings className="h-4 w-4 md:h-5 md:w-5" />
                  Connection Status
                </CardTitle>
                <CardDescription className="text-sm">
                  Overview of your connected applications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="text-xl md:text-2xl font-bold">{connectedCount}</div>
                  <div className="text-sm text-muted-foreground">
                    connected applications
                  </div>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {integrations.length} available
                  </Badge>
                </div>
              </CardContent>
            </Card>


            {/* Integration Categories */}
            {Object.entries(groupedIntegrations).map(([category, categoryIntegrations]) => (
              <div key={category} className="space-y-4">
                <h3 className="text-lg md:text-xl font-semibold">{category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryIntegrations.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      restaurantId={selectedRestaurant.restaurant_id}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Help Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <ExternalLink className="h-4 w-4 md:h-5 md:w-5" />
                  Need Help?
                </CardTitle>
                <CardDescription className="text-sm">
                  Don't see your application? Need assistance with setup?
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  We're constantly adding new integrations. Contact our support team to request 
                  a new integration or get help connecting your existing applications.
                </p>
                <Button variant="outline" size="sm">
                  Contact Support
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default Integrations;