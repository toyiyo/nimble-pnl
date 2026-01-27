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

interface SyncError {
  orderGuid?: string;
  message: string;
}

interface SyncResult {
  ordersSynced: number;
  errors: (string | SyncError)[];
  syncComplete?: boolean;
  progress?: number;
}

function formatError(error: string | SyncError): string {
  return typeof error === 'string' ? error : error.message;
}

export function ToastSync({ restaurantId }: ToastSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [totalOrdersSynced, setTotalOrdersSynced] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const { toast } = useToast();
  const { connection, triggerManualSync, checkConnectionStatus } = useToastConnection(restaurantId);

  async function executeSyncLoop(): Promise<{
    totalOrders: number;
    allErrors: (string | SyncError)[];
    complete: boolean;
  }> {
    let allErrors: (string | SyncError)[] = [];
    let totalOrders = 0;
    let complete = false;

    while (!complete) {
      const data = await triggerManualSync(restaurantId);

      if (data?.ordersSynced === undefined) {
        break;
      }

      totalOrders += data.ordersSynced;
      setTotalOrdersSynced(totalOrders);
      setSyncProgress(data.progress || 100);

      if (data.errors?.length) {
        allErrors = [...allErrors, ...data.errors];
      }

      complete = data.syncComplete !== false;

      if (!complete) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return { totalOrders, allErrors, complete };
  }

  async function handleSync(): Promise<void> {
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
    setTotalOrdersSynced(0);
    setSyncProgress(0);

    try {
      const { totalOrders, allErrors } = await executeSyncLoop();

      setSyncResult({
        ordersSynced: totalOrders,
        errors: allErrors,
        syncComplete: true,
        progress: 100
      });

      await checkConnectionStatus(restaurantId);

      toast({
        title: 'Sync complete',
        description: `${totalOrders} orders synced successfully`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({
        title: 'Sync failed',
        description: errorMessage,
        variant: 'destructive',
      });
      console.error('Sync error:', error);

      if (totalOrdersSynced > 0) {
        setSyncResult({
          ordersSynced: totalOrdersSynced,
          errors: [errorMessage],
          syncComplete: false,
          progress: syncProgress
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

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

  const lastSyncTime = connection.last_sync_time ? new Date(connection.last_sync_time) : null;
  const initialSyncDone = connection.initial_sync_done;

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
        <ConnectionStatus lastSyncTime={lastSyncTime} />

        {!initialSyncDone && <InitialSyncPendingAlert />}

        {connection.last_error && (
          <LastErrorAlert
            error={connection.last_error}
            errorAt={connection.last_error_at}
          />
        )}

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={initialSyncDone}
          onSync={handleSync}
        />

        {isLoading && (
          <SyncProgress
            progress={syncProgress}
            ordersSynced={totalOrdersSynced}
            initialSyncDone={initialSyncDone}
          />
        )}

        {syncResult && <SyncResults result={syncResult} />}

        <HowSyncingWorksInfo />
      </CardContent>
    </Card>
  );
}

function ConnectionStatus({ lastSyncTime }: { lastSyncTime: Date | null }): JSX.Element {
  return (
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
  );
}

function InitialSyncPendingAlert(): JSX.Element {
  return (
    <Alert>
      <Calendar className="h-4 w-4" />
      <AlertDescription>
        <strong>First sync pending:</strong> The next scheduled sync will import your last 90 days of orders.
        You can also click "Sync Now" to start immediately.
      </AlertDescription>
    </Alert>
  );
}

function LastErrorAlert({ error, errorAt }: { error: string; errorAt?: string }): JSX.Element {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <strong>Last sync error:</strong> {error}
        {errorAt && (
          <p className="text-xs mt-1">
            Occurred {formatDistanceToNow(new Date(errorAt), { addSuffix: true })}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface SyncButtonProps {
  isLoading: boolean;
  initialSyncDone?: boolean;
  onSync: () => void;
}

function SyncButton({ isLoading, initialSyncDone, onSync }: SyncButtonProps): JSX.Element {
  const buttonText = isLoading ? 'Syncing...' : 'Sync Now';
  const description = initialSyncDone
    ? 'Manually sync orders from the last 25 hours'
    : 'Start initial sync (last 90 days of orders)';

  return (
    <div className="space-y-4">
      <div className="text-center">
        <Button
          onClick={onSync}
          disabled={isLoading}
          className="w-full max-w-xs mx-auto"
          size="lg"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          {buttonText}
        </Button>
        <p className="text-sm text-muted-foreground mt-2">{description}</p>
      </div>
    </div>
  );
}

interface SyncProgressProps {
  progress: number;
  ordersSynced: number;
  initialSyncDone?: boolean;
}

function SyncProgress({ progress, ordersSynced, initialSyncDone }: SyncProgressProps): JSX.Element {
  const statusText = initialSyncDone ? 'Syncing recent orders' : 'Initial sync fetches 90 days of history in batches';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Syncing data from Toast... {progress > 0 && `(${progress}%)`}
        </span>
        <RefreshCw className="h-4 w-4 animate-spin" />
      </div>
      {ordersSynced > 0 && (
        <p className="text-xs text-muted-foreground">
          {ordersSynced} orders synced so far
        </p>
      )}
      <Progress value={progress || undefined} className="w-full" />
      <p className="text-xs text-muted-foreground">{statusText}</p>
    </div>
  );
}

function SyncResults({ result }: { result: SyncResult }): JSX.Element {
  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <h4 className="font-medium">Sync Complete</h4>
      </div>

      <div className="space-y-1">
        <div className="text-2xl font-bold text-primary">{result.ordersSynced}</div>
        <div className="text-sm text-muted-foreground">Orders synced</div>
      </div>

      {result.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-medium">Some errors occurred:</div>
              {result.errors.map((error, idx) => (
                <div key={`error-${idx}`} className="text-sm">
                  {formatError(error)}
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function HowSyncingWorksInfo(): JSX.Element {
  return (
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
  );
}
