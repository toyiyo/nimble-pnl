import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useToastConnection } from '@/hooks/useToastConnection';
import { RefreshCw, AlertCircle, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

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
  const { connection, triggerManualSync } = useToastConnection(restaurantId);

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

        toast({
          title: 'Sync complete',
          description: `${data.ordersSynced} orders synced successfully`,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({
        title: 'Sync failed',
        description: errorMessage,
        variant: 'destructive',
      });
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
            Connect to Toast to sync your sales data
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

  const lastSyncTime = connection?.last_sync_time ? new Date(connection.last_sync_time) : null;
  const initialSyncDone = connection?.initial_sync_done;

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
              <h4 className="font-medium text-sm">Scheduled Sync Active</h4>
              <p className="text-xs text-muted-foreground">
                Orders sync automatically every 6 hours
              </p>
              {lastSyncTime && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last synced: {formatDistanceToNow(lastSyncTime, { addSuffix: true })}
                  <span className="text-muted-foreground/60 ml-1">
                    ({format(lastSyncTime, 'PPp')})
                  </span>
                </p>
              )}
            </div>
            <Badge
              variant="default"
              className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          </div>
        </div>

        {/* Initial Sync Status */}
        {!initialSyncDone && (
          <Alert>
            <Calendar className="h-4 w-4" />
            <AlertDescription>
              <strong>First sync pending:</strong> The next scheduled sync will import your last 90 days of orders.
              You can also click "Sync Now" to start immediately.
            </AlertDescription>
          </Alert>
        )}

        {/* Error Alert */}
        {connection?.last_error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Last sync error:</strong> {connection.last_error}
              {connection.last_error_at && (
                <p className="text-xs mt-1">
                  Occurred {formatDistanceToNow(new Date(connection.last_error_at), { addSuffix: true })}
                </p>
              )}
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
              {initialSyncDone
                ? 'Manually sync orders from the last 25 hours'
                : 'Start initial sync (last 90 days of orders)'
              }
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
                    {syncResult.errors.map((error, idx) => (
                      <div key={`error-${idx}`} className="text-sm">• {error}</div>
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
              <div className="font-medium">How syncing works</div>
              <div className="text-sm space-y-1">
                <div><strong>Scheduled Sync:</strong> Orders sync automatically every 6 hours</div>
                <div><strong>Manual Sync:</strong> Use the button above for immediate sync</div>
                <div><strong>Historical Data:</strong> First sync imports last 90 days of orders</div>
                <div><strong>Incremental:</strong> After initial sync, only new/updated orders are fetched</div>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
