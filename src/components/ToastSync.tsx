import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useToastConnection } from '@/hooks/useToastConnection';
import { RefreshCw, Download, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface ToastSyncProps {
  restaurantId: string;
}

interface SyncResult {
  ordersSynced: number;
  errors: string[];
}

export const ToastSync = ({ restaurantId }: ToastSyncProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const { toast } = useToast();
  const { connection, triggerManualSync, checkConnectionStatus } = useToastConnection();

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus(restaurantId);
    }
  }, [restaurantId, checkConnectionStatus]);

  const handleSync = async () => {
    if (!connection?.is_active) {
      toast({
        title: 'Error',
        description: 'Please connect to Toast first',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);

    try {
      const data = await triggerManualSync(restaurantId);
      
      if (data?.ordersSynced !== undefined) {
        setSyncResult({
          ordersSynced: data.ordersSynced,
          errors: data.errors || []
        });
      }
    } catch (error: any) {
      console.error('Sync error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!connection?.is_active) {
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
          Sync your Toast orders to populate P&L calculations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary">
              <Clock className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-sm">Automated Nightly Sync</h4>
              <p className="text-xs text-muted-foreground">
                Orders are automatically synced every night at 3 AM
              </p>
              {connection?.last_sync_time && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last synced: {format(new Date(connection.last_sync_time), 'PPp')}
                </p>
              )}
            </div>
            <Badge 
              variant={connection?.webhook_active ? 'default' : 'secondary'}
              className={connection?.webhook_active ? 'bg-green-100 text-green-700' : ''}
            >
              {connection?.webhook_active ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Webhooks Active
                </>
              ) : (
                'Webhooks Inactive'
              )}
            </Badge>
          </div>
        </div>

        {/* Error Alert */}
        {connection?.last_error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Last sync error: {connection.last_error}
              <p className="text-xs mt-1">
                {connection.last_error_at && `Occurred at ${format(new Date(connection.last_error_at), 'PPp')}`}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Manual Sync Button */}
        <div className="space-y-4">
          <div className="text-center">
            <Button
              onClick={handleSync}
              disabled={isLoading}
              className="w-full max-w-xs mx-auto"
              size="lg"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Syncing...' : 'Sync Now'}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              Manually trigger a sync for the last 25 hours
            </p>
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
          <div className="bg-muted/50 rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h4 className="font-medium">Sync Complete</h4>
            </div>
            
            <div className="space-y-1">
              <div className="text-2xl font-bold text-primary">{syncResult.ordersSynced}</div>
              <div className="text-sm text-muted-foreground">Orders synced</div>
            </div>

            {/* Errors */}
            {syncResult.errors && syncResult.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <div className="font-medium">Some errors occurred:</div>
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
                <div><strong>Nightly Sync:</strong> Orders are automatically synced every night at 3 AM</div>
                <div><strong>Webhooks:</strong> Real-time order updates pushed from Toast as they occur</div>
                <div><strong>Manual Sync:</strong> Use the button above for immediate sync</div>
                <div><strong>Historical Data:</strong> First sync imports last 90 days of orders</div>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
