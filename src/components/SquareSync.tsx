import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, AlertCircle, CheckCircle2, Zap } from 'lucide-react';

interface SquareSyncProps {
  restaurantId: string;
  isConnected: boolean;
}

interface SyncResult {
  catalogSynced: boolean;
  ordersSynced: number;
  paymentsSynced: number;
  refundsSynced: number;
  teamMembersSynced: number;
  shiftsSynced: number;
  errors: string[];
}

export const SquareSync = ({ restaurantId, isConnected }: SquareSyncProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncType, setSyncType] = useState<'initial_sync' | 'daily_sync' | 'hourly_sync'>('initial_sync');
  const { toast } = useToast();

  // Check if webhooks are registered and working
  useEffect(() => {
    if (isConnected && restaurantId) {
      // We can assume webhooks are registered automatically upon Square connection
      // The webhook registration happens in the OAuth callback
    }
  }, [isConnected, restaurantId]);

  const handleSync = async (action: 'initial_sync' | 'daily_sync' | 'hourly_sync', dateRange?: { startDate: string; endDate: string }) => {
    if (!isConnected) {
      toast({
        title: "Error",
        description: "Please connect to Square first",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);
    setSyncType(action);

    try {
      const { data, error } = await supabase.functions.invoke('square-sync-data', {
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
        
        const totalSynced = data.results.ordersSynced + data.results.paymentsSynced + 
                           data.results.refundsSynced + data.results.shiftsSynced + data.results.teamMembersSynced;
        
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${totalSynced} records from Square`,
        });
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync data from Square",
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

  const handleSyncToPOSSales = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.rpc('sync_square_to_unified_sales', {
        p_restaurant_id: restaurantId
      });

      if (error) throw error;

      toast({
        title: "Sync Complete",
        description: "Square data has been synced to POS Sales successfully",
      });
    } catch (error: any) {
      console.error('POS Sales sync error:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Square data to POS Sales",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };


  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Square Data Sync
          </CardTitle>
          <CardDescription>
            Connect to Square to sync your historical data and enable automatic updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect to Square first to enable data synchronization.
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
          Square Data Sync
        </CardTitle>
        <CardDescription>
          Sync your Square data to populate P&L calculations and keep them updated
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
                Your P&L dashboard automatically updates when new orders, payments, or shifts are processed in Square
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
          
          {/* Manual Sync to POS Sales */}
          <div className="pt-4 border-t">
            <Button
              onClick={handleSyncToPOSSales}
              disabled={isLoading}
              variant="secondary"
              className="w-full"
              size="sm"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync to POS Sales
            </Button>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Manually sync Square orders to the POS Sales page
            </p>
          </div>
        </div>

        {/* Loading Progress */}
        {isLoading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Syncing data from Square...</span>
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
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="text-2xl font-bold text-blue-600">{syncResult.ordersSynced}</div>
                <div className="text-xs text-muted-foreground">Orders</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-green-600">{syncResult.paymentsSynced}</div>
                <div className="text-xs text-muted-foreground">Payments</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-purple-600">{syncResult.shiftsSynced}</div>
                <div className="text-xs text-muted-foreground">Labor Shifts</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-orange-600">{syncResult.teamMembersSynced}</div>
                <div className="text-xs text-muted-foreground">Team Members</div>
              </div>
              
              <div className="space-y-1">
                <div className="text-2xl font-bold text-red-600">{syncResult.refundsSynced}</div>
                <div className="text-xs text-muted-foreground">Refunds</div>
              </div>
              
              <div className="space-y-1">
                <Badge variant={syncResult.catalogSynced ? "default" : "secondary"}>
                  {syncResult.catalogSynced ? "✓ Catalog" : "No Catalog"}
                </Badge>
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
                <div><strong>Automatic Updates:</strong> Your P&L dashboard updates in real-time as Square processes orders, payments, and shifts</div>
                <div><strong>Historical Data:</strong> Use the import button to bring in past data for complete P&L history</div>
                <div><strong>What's Included:</strong> Orders, payments, refunds, labor shifts, team members, and catalog items</div>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};