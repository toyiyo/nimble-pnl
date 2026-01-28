import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useToastConnection } from '@/hooks/useToastConnection';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
  ConnectionStatus,
  InitialSyncPendingAlert,
  LastErrorAlert,
  SyncModeSelector,
  SyncButton,
  SyncProgressDisplay,
  SyncResults,
  HowSyncingWorksInfo,
  TOAST_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

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

function formatErrors(errors: (string | SyncError)[]): string[] {
  return errors.map(e => typeof e === 'string' ? e : e.message);
}

export function ToastSync({ restaurantId }: ToastSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [totalOrdersSynced, setTotalOrdersSynced] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>('recent');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const { toast } = useToast();
  const { connection, triggerManualSync, checkConnectionStatus } = useToastConnection(restaurantId);

  async function executeSyncLoop(options?: { startDate?: string; endDate?: string }): Promise<{
    totalOrders: number;
    allErrors: (string | SyncError)[];
    complete: boolean;
  }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    const BATCH_DELAY_MS = 500;

    const allErrors: (string | SyncError)[] = [];
    let totalOrders = 0;
    let complete = false;
    let consecutiveFailures = 0;
    let currentPage: number | undefined;

    while (!complete) {
      try {
        const requestOptions = {
          ...options,
          ...(currentPage && { page: currentPage })
        };
        const data = await triggerManualSync(restaurantId, requestOptions);

        if (data?.ordersSynced === undefined) {
          break;
        }

        consecutiveFailures = 0;
        totalOrders += data.ordersSynced as number;
        setTotalOrdersSynced(totalOrders);
        setSyncProgress((data.progress as number) || 100);

        currentPage = data.nextPage as number | undefined;

        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          allErrors.push(...(data.errors as (string | SyncError)[]));
        }

        complete = data.syncComplete !== false;

        if (!complete) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        consecutiveFailures++;
        const errorMessage = error instanceof Error ? error.message : 'Request failed';

        console.warn(`Sync request failed (attempt ${consecutiveFailures}/${MAX_RETRIES}):`, errorMessage);

        if (consecutiveFailures >= MAX_RETRIES) {
          allErrors.push({ message: `Sync interrupted after ${MAX_RETRIES} retries: ${errorMessage}` });
          break;
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
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

    if (syncMode === 'custom' && (!dateRange?.from || !dateRange?.to)) {
      toast({
        title: 'Error',
        description: 'Please select a date range',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);
    setTotalOrdersSynced(0);
    setSyncProgress(0);

    try {
      const syncOptions = syncMode === 'custom' && dateRange
        ? { startDate: dateRange.from.toISOString(), endDate: dateRange.to.toISOString() }
        : undefined;

      const { totalOrders, allErrors } = await executeSyncLoop(syncOptions);

      setSyncResult({
        ordersSynced: totalOrders,
        errors: allErrors,
        syncComplete: true,
        progress: 100
      });

      await checkConnectionStatus(restaurantId);

      const description = syncMode === 'custom'
        ? `${totalOrders} orders synced for ${format(dateRange!.from, 'MMM d')} - ${format(dateRange!.to, 'MMM d, yyyy')}`
        : `${totalOrders} orders synced successfully`;

      toast({ title: 'Sync complete', description });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({ title: 'Sync failed', description: errorMessage, variant: 'destructive' });
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
        <ConnectionStatus lastSyncTime={lastSyncTime} config={TOAST_CONFIG} />

        {!connection.initial_sync_done && (
          <InitialSyncPendingAlert config={TOAST_CONFIG} />
        )}

        {connection.last_error && (
          <LastErrorAlert error={connection.last_error} errorAt={connection.last_error_at} />
        )}

        <SyncModeSelector
          syncMode={syncMode}
          onSyncModeChange={setSyncMode}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          initialSyncDone={connection.initial_sync_done}
          config={TOAST_CONFIG}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={connection.initial_sync_done}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
          config={TOAST_CONFIG}
        />

        {isLoading && (
          <SyncProgressDisplay
            progress={syncProgress}
            itemsSynced={totalOrdersSynced}
            initialSyncDone={connection.initial_sync_done}
            config={TOAST_CONFIG}
          />
        )}

        {syncResult && (
          <SyncResults
            itemsSynced={syncResult.ordersSynced}
            errors={formatErrors(syncResult.errors)}
            config={TOAST_CONFIG}
          />
        )}

        <HowSyncingWorksInfo config={TOAST_CONFIG} />
      </CardContent>
    </Card>
  );
}
