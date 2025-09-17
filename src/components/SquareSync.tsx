import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, Calendar, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

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
  const [webhookRegistered, setWebhookRegistered] = useState(false);
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const { toast } = useToast();

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

  const handleCustomSync = () => {
    // For now, sync last 30 days - could add date picker later
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    handleSync('initial_sync', { startDate, endDate });
  };

  const handleRegisterWebhook = async () => {
    if (!isConnected) {
      toast({
        title: "Error",
        description: "Please connect to Square first",
        variant: "destructive",
      });
      return;
    }

    setIsRegisteringWebhook(true);

    try {
      const { data, error } = await supabase.functions.invoke('square-webhook-register', {
        body: { restaurantId }
      });

      if (error) {
        throw error;
      }

      setWebhookRegistered(true);
      toast({
        title: "Webhooks Registered",
        description: "Square will now send real-time updates for automatic P&L calculation",
      });
    } catch (error: any) {
      console.error('Webhook registration error:', error);
      toast({
        title: "Webhook Registration Failed",
        description: error.message || "Failed to register webhooks with Square",
        variant: "destructive",
      });
    } finally {
      setIsRegisteringWebhook(false);
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
        {/* Sync Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Button
              onClick={handleHistoricalSync}
              disabled={isLoading}
              className="w-full"
              variant="default"
            >
              <Download className="h-4 w-4 mr-2" />
              {isLoading && syncType === 'initial_sync' ? 'Syncing...' : 'Historical Sync'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Import last 90 days of data
            </p>
          </div>
          
          <div className="space-y-2">
            <Button
              onClick={handleDailySync}
              disabled={isLoading}
              variant="outline"
              className="w-full"
            >
              <Calendar className="h-4 w-4 mr-2" />
              {isLoading && syncType === 'daily_sync' ? 'Syncing...' : 'Daily Sync'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Import yesterday's data
            </p>
          </div>
          
          <div className="space-y-2">
            <Button
              onClick={handleCustomSync}
              disabled={isLoading}
              variant="outline"
              className="w-full"
            >
              <Clock className="h-4 w-4 mr-2" />
              {isLoading && syncType === 'initial_sync' ? 'Syncing...' : 'Last 30 Days'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Import last month's data
            </p>
          </div>
        </div>

        {/* Webhook Registration */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Real-time Updates</h4>
              <p className="text-sm text-muted-foreground">
                Register webhooks for automatic data updates
              </p>
            </div>
            <Button
              onClick={handleRegisterWebhook}
              disabled={isRegisteringWebhook || webhookRegistered}
              variant={webhookRegistered ? "default" : "outline"}
              size="sm"
            >
              {isRegisteringWebhook ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Registering...
                </>
              ) : webhookRegistered ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Webhooks Active
                </>
              ) : (
                'Register Webhooks'
              )}
            </Button>
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
              <div className="font-medium">Data Management</div>
              <div className="text-sm space-y-1">
                <div><strong>Historical Sync:</strong> Import past data to populate your P&L calculations</div>
                <div><strong>Real-time Updates:</strong> Once webhooks are registered, changes in Square automatically update your P&L</div>
                <div><strong>Manual Sync:</strong> Use daily sync to catch up on recent data or custom sync for specific date ranges</div>
              </div>
              <div className="text-sm">
                <strong>What gets synced:</strong> Orders, payments, refunds, labor shifts, team members, and catalog data are automatically processed to calculate accurate P&L metrics.
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};