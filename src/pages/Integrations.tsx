import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { useCloverIntegration } from '@/hooks/useCloverIntegration';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { IntegrationCard } from '@/components/IntegrationCard';
import { MetricIcon } from '@/components/MetricIcon';
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
          <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
            <MetricIcon icon={Plug} variant="purple" className="mx-auto mb-4" />
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
              <div className="flex items-center gap-4">
                <MetricIcon icon={Plug} variant="purple" />
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold">Connect Your Applications</h1>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="region" aria-label="Integration statistics">
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={CheckCircle2} variant="emerald" />
                  <div>
                    <div className="text-3xl font-bold" aria-label={`${connectedCount} integrations connected`}>
                      {connectedCount}
                    </div>
                    <div className="text-sm text-muted-foreground">Connected</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Plug} variant="blue" />
                  <div>
                    <div className="text-3xl font-bold" aria-label={`${integrations.length} integrations available`}>
                      {integrations.length}
                    </div>
                    <div className="text-sm text-muted-foreground">Available</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {(() => {
              const integrationRate = integrations.length 
                ? Math.round((connectedCount / integrations.length) * 100) 
                : 0;
              
              return (
                <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <MetricIcon icon={TrendingUp} variant="purple" />
                      <div>
                        <div className="text-3xl font-bold" aria-label={`${integrationRate}% integration rate`}>
                          {integrationRate}%
                        </div>
                        <div className="text-sm text-muted-foreground">Integration Rate</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
          </div>

          {/* Integration Categories */}
          {Object.entries(groupedIntegrations).map(([category, categoryIntegrations]) => (
            <div key={category} className="space-y-4" role="region" aria-labelledby={`${category}-heading`}>
              <div className="flex items-center gap-3 pb-2 border-b">
                <h2 id={`${category}-heading`} className="text-lg md:text-xl font-semibold">{category}</h2>
                <Badge variant="secondary" className="text-xs" aria-label={`${categoryIntegrations.length} integrations available`}>
                  {categoryIntegrations.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="list" aria-label={`${category} integrations`}>
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
          <Card className="bg-gradient-to-br from-muted/30 to-muted/10 border-muted hover:shadow-md transition-all duration-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <ExternalLink className="h-4 w-4 md:h-5 md:w-5" aria-hidden="true" />
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
              <Button 
                variant="outline" 
                size="sm" 
                className="hover:bg-background transition-all duration-200"
                aria-label="Contact support for integration assistance"
              >
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