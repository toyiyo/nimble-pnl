import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, AlertCircle, CheckCircle2, Zap } from 'lucide-react';

interface ToastSyncProps {
  restaurantId: string;
  isConnected: boolean;
}

interface SyncResult {
  ordersSynced: number;
  itemsSynced: number;
  paymentsSynced: number;
  menuItemsSynced: number;
  errors: string[];
}

export const ToastSync = ({ restaurantId, isConnected }: ToastSyncProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncType, setSyncType] = useState<'initial_sync' | 'daily_sync' | 'hourly_sync'>('initial_sync');
  const { toast } = useToast();

  const handleSync = async (action: 'initial_sync' | 'daily_sync' | 'hourly_sync', dateRange?: { startDate: string; endDate: string }) => {
    if (!isConnected) {
      toast({
        title: "Error",
        description: "Please connect to Toast first",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);
    setSyncType(action);

    try {
      const { data, error } = await supabase.functions.invoke('toast-sync-data', {
        body: {
          restaurantId,
          action,
          ...(dateRange && { dateRange })
        }
      });

      if (error) {
        throw error;
      }

      if (data?.results) {
        setSyncResult(data.results);
        
        const totalSynced = data.results.ordersSynced + data.results.itemsSynced + 
                           data.results.paymentsSynced + data.results.menuItemsSynced;
        
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${totalSynced} records from Toast`,
        });
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync data from Toast",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleHistoricalSync = () => {
    handleSync('initial_sync');
  };

  const handleDailySync = () => {
    handleSync('daily_sync');
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Toast Data Sync
          </CardTitle>
          <CardDescription>
            Connect to Toast to sync your historical data and enable automatic updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect to Toast first to enable data synchronization.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Toast Data Sync
        </CardTitle>
        <CardDescription>
          Sync your Toast data to populate P&L calculations and keep them updated
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Real-time Status */}
        <div className="bg-muted/50 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-600">
              <Zap className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-sm">Real-time Updates Active</h4>
              <p className="text-xs text-muted-foreground">
                Your P&L dashboard automatically updates when new orders, payments, or menu items are created in Toast
              </p>
            </div>
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Live
            </Badge>
          </div>
        </div>

        {/* Primary Sync Action */}
        <div className="space-y-4">
          <div className="text-center">
            <Button
              onClick={handleHistoricalSync}
              disabled={isLoading}
              className="w-full max-w-xs mx-auto"
              size="lg"
            >
              <Download className="h-4 w-4 mr-2" />
              {isLoading && syncType === 'initial_sync' ? 'Importing Data...' : 'Import Last 90 Days'}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              Import historical data to populate your P&L calculations
            </p>
          </div>

          {/* Secondary Sync Options */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleDailySync}
              disabled={isLoading}
              variant="outline"
              size="sm"
            >
              {isLoading && syncType === 'daily_sync' ? 'Syncing...' : 'Sync Yesterday'}
            </Button>
            <Button
              onClick={() => {
                const endDate = new Date().toISOString().split('T')[0];
                const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                handleSync('initial_sync', { startDate, endDate });
              }}
              disabled={isLoading}
              variant="outline"
              size="sm"
            >
              {isLoading ? 'Syncing...' : 'Sync Last 7 Days'}
            </Button>
          </div>
        </div>

        {/* Loading Progress */}
        {isLoading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Syncing data from Toast...</span>
              <RefreshCw className="h-4 w-4 animate-spin" />
            </div>
            <Progress value={undefined} className="w-full" />
            <p className="text-xs text-muted-foreground">
              This may take a few minutes depending on the amount of data
            </p>
          </div>
        )}

        {/* Sync Results */}
        {syncResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h4 className="font-medium">Sync Results</h4>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-2xl font-bold text-blue-600">{syncResult.ordersSynced}</div>
                <div className="text-xs text-muted-foreground">Orders</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-green-600">{syncResult.itemsSynced}</div>
                <div className="text-xs text-muted-foreground">Items</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-purple-600">{syncResult.paymentsSynced}</div>
                <div className="text-xs text-muted-foreground">Payments</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-orange-600">{syncResult.menuItemsSynced}</div>
                <div className="text-xs text-muted-foreground">Menu Items</div>
              </div>
            </div>

            {/* Errors */}
            {syncResult.errors && syncResult.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <div className="font-medium">Some errors occurred during sync:</div>
                    {syncResult.errors.map((error, index) => (
                      <div key={index} className="text-sm">• {error}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Info */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">How it works</div>
              <div className="text-sm space-y-1">
                <div><strong>Automatic Updates:</strong> Your P&L dashboard updates in real-time as Toast processes orders and payments</div>
                <div><strong>Historical Data:</strong> Use the import button to bring in past data for complete P&L history</div>
                <div><strong>What's Included:</strong> Orders, order items, payments, and menu catalog</div>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
