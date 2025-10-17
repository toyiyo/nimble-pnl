import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { useCloverIntegration } from '@/hooks/useCloverIntegration';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { IntegrationCard } from '@/components/IntegrationCard';
import { ExternalLink, Plug, CheckCircle2, TrendingUp } from 'lucide-react';

const Integrations = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { isConnected: squareConnected } = useSquareIntegration(selectedRestaurant?.restaurant_id || null);
  const { isConnected: cloverConnected } = useCloverIntegration(selectedRestaurant?.restaurant_id || null);

  const handleRestaurantSelect = (restaurant: any) => {
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
      id: 'clover-pos',
      name: 'Clover',
      description: 'Sync orders, payments, and menu items from Clover POS',
      category: 'Point of Sale',
      logo: '🍀',
      connected: cloverConnected,
      features: ['Orders', 'Payments', 'Menu Items', 'Multi-region Support']
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

  const groupedIntegrations = useMemo(() => {
    return integrations.reduce((acc, integration) => {
      if (!acc[integration.category]) {
        acc[integration.category] = [];
      }
      acc[integration.category].push(integration);
      return acc;
    }, {} as Record<string, typeof integrations>);
  }, [integrations]);

  const connectedCount = useMemo(() => {
    return integrations.filter(integration => integration.connected).length;
  }, [integrations]);

  return (
    <>
      {!selectedRestaurant ? (
        <div className="space-y-6">
          <div className="text-center">
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
          {/* Hero Section */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-8">
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Plug className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold">Connect Your Applications</h2>
                  <p className="text-sm md:text-base text-muted-foreground mt-1">
                    Automatically sync data from your existing tools to eliminate manual data entry
                  </p>
                </div>
              </div>
            </div>
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl -z-0" />
          </div>

          {/* Dashboard Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">{connectedCount}</div>
                    <div className="text-sm text-muted-foreground">Connected</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Plug className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">{integrations.length}</div>
                    <div className="text-sm text-muted-foreground">Available</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <div className="text-3xl font-bold">
                      {Math.round((connectedCount / integrations.length) * 100)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Integration Rate</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integration Categories */}
          {Object.entries(groupedIntegrations).map(([category, categoryIntegrations]) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b">
                <h3 className="text-lg md:text-xl font-semibold">{category}</h3>
                <Badge variant="secondary" className="text-xs">
                  {categoryIntegrations.length}
                </Badge>
              </div>
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
          <Card className="bg-gradient-to-br from-muted/30 to-muted/10 border-muted">
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
              <Button variant="outline" size="sm" className="hover:bg-background transition-colors">
                Contact Support
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
};

export default Integrations;