import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStripeFinancialConnections } from '@/hooks/useStripeFinancialConnections';
import { BankConnectionCard } from '@/components/BankConnectionCard';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { TestBankConnectionDialog } from '@/components/TestBankConnectionDialog';
import { MetricIcon } from '@/components/MetricIcon';
import { Building2, Plus, Wallet, TrendingUp, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const Accounting = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { 
    connectedBanks, 
    loading, 
    createFinancialConnectionsSession,
    isCreatingSession 
  } = useStripeFinancialConnections(selectedRestaurant?.restaurant_id || null);
  const { toast } = useToast();
  const [showTestDialog, setShowTestDialog] = useState(false);

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const handleConnectBank = async () => {
    if (!selectedRestaurant) return;

    try {
      const sessionData = await createFinancialConnectionsSession();
      
      if (sessionData?.clientSecret) {
        // Open Stripe Financial Connections in a new window
        const stripeUrl = `https://connect.stripe.com/setup/e/${sessionData.clientSecret}`;
        window.open(stripeUrl, '_blank', 'width=600,height=800');
        
        toast({
          title: "Bank Connection Started",
          description: "Complete the bank connection process in the popup window.",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to Connect Bank",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const totalBalance = connectedBanks.reduce((sum, bank) => {
    return sum + (bank.balances?.[0]?.current_balance || 0);
  }, 0);

  return (
    <>
      {!selectedRestaurant ? (
        <div className="space-y-6">
          <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
            <MetricIcon icon={Building2} variant="blue" className="mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Accounting Dashboard</h2>
            <p className="text-sm md:text-base text-muted-foreground">
              Please select a restaurant to manage accounting
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
                <MetricIcon icon={Building2} variant="blue" />
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold">Accounting</h1>
                  <p className="text-sm md:text-base text-muted-foreground mt-1">
                    Connect your bank accounts for automated financial tracking
                  </p>
                </div>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl -z-0" />
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Wallet} variant="emerald" />
                  <div>
                    <div className="text-3xl font-bold">
                      ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Balance</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Building2} variant="blue" />
                  <div>
                    <div className="text-3xl font-bold">{connectedBanks.length}</div>
                    <div className="text-sm text-muted-foreground">Connected Banks</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={TrendingUp} variant="purple" />
                  <div>
                    <div className="text-3xl font-bold">
                      {connectedBanks.reduce((sum, bank) => sum + (bank.balances?.length || 0), 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">Accounts</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Connected Banks Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-xl font-semibold">Connected Banks</h2>
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={() => setShowTestDialog(true)}
                  className="gap-2"
                >
                  <FlaskConical className="h-4 w-4" />
                  Test Mode
                </Button>
                <Button 
                  onClick={handleConnectBank}
                  disabled={isCreatingSession}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {isCreatingSession ? 'Connecting...' : 'Connect Bank'}
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="text-center p-8 text-muted-foreground">
                Loading connected banks...
              </div>
            ) : connectedBanks.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                  <MetricIcon icon={Building2} variant="blue" className="mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Banks Connected</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Connect your bank accounts to automatically track transactions, reconcile expenses, and gain real-time financial insights.
                  </p>
                  <Button onClick={handleConnectBank} disabled={isCreatingSession}>
                    <Plus className="h-4 w-4 mr-2" />
                    Connect Your First Bank
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {connectedBanks.map((bank) => (
                  <BankConnectionCard
                    key={bank.id}
                    bank={bank}
                    restaurantId={selectedRestaurant.restaurant_id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      <TestBankConnectionDialog
        open={showTestDialog}
        onOpenChange={setShowTestDialog}
        restaurantId={selectedRestaurant?.restaurant_id || ''}
      />
    </>
  );
};

export default Accounting;
