import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useShift4Integration } from '@/hooks/useShift4Integration';
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
  SHIFT4_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

interface Shift4SyncProps {
  restaurantId: string;
}

interface SyncResult {
  ticketsSynced: number;
  errors: string[];
  syncComplete: boolean;
  progress: number;
}

export function Shift4Sync({ restaurantId }: Shift4SyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [totalTicketsSynced, setTotalTicketsSynced] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>('recent');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const { toast } = useToast();
  const { connection, triggerManualSync, checkConnection } = useShift4Integration(restaurantId);

  async function executeSyncLoop(options?: { startDate?: string; endDate?: string }): Promise<{
    totalTickets: number;
    allErrors: string[];
    complete: boolean;
  }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    const BATCH_DELAY_MS = 500;

    const allErrors: string[] = [];
    let totalTickets = 0;
    let complete = false;
    let consecutiveFailures = 0;

    while (!complete) {
      try {
        const data = await triggerManualSync(options);

        if (!data) {
          break;
        }

        consecutiveFailures = 0;
        totalTickets += data.ticketsSynced;
        setTotalTicketsSynced(totalTickets);
        setSyncProgress(data.progress || 100);

        if (data.errors && data.errors.length > 0) {
          allErrors.push(...data.errors);
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
          allErrors.push(`Sync interrupted after ${MAX_RETRIES} retries: ${errorMessage}`);
          break;
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    return { totalTickets, allErrors, complete };
  }

  async function handleSync(): Promise<void> {
    if (!connection?.is_active) {
      toast({
        title: 'Error',
        description: 'Please connect to Shift4/Lighthouse first',
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
    setTotalTicketsSynced(0);
    setSyncProgress(0);

    try {
      const syncOptions = syncMode === 'custom' && dateRange
        ? { startDate: dateRange.from.toISOString(), endDate: dateRange.to.toISOString() }
        : undefined;

      const { totalTickets, allErrors } = await executeSyncLoop(syncOptions);

      setSyncResult({
        ticketsSynced: totalTickets,
        errors: allErrors,
        syncComplete: true,
        progress: 100
      });

      await checkConnection();

      const description = syncMode === 'custom'
        ? `${totalTickets} tickets synced for ${format(dateRange!.from, 'MMM d')} - ${format(dateRange!.to, 'MMM d, yyyy')}`
        : `${totalTickets} tickets synced successfully`;

      toast({ title: 'Sync complete', description });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({ title: 'Sync failed', description: errorMessage, variant: 'destructive' });
      console.error('Sync error:', error);

      if (totalTicketsSynced > 0) {
        setSyncResult({
          ticketsSynced: totalTicketsSynced,
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
            Shift4/Lighthouse Data Sync
          </CardTitle>
          <CardDescription>
            Connect to Shift4/Lighthouse to sync your sales data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect to Shift4/Lighthouse first to enable data synchronization.
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
          Shift4/Lighthouse Data Sync
        </CardTitle>
        <CardDescription>
          Sync your Lighthouse tickets to populate P&L calculations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConnectionStatus lastSyncTime={lastSyncTime} config={SHIFT4_CONFIG} />

        {!connection.initial_sync_done && (
          <InitialSyncPendingAlert syncCursor={connection.sync_cursor} config={SHIFT4_CONFIG} />
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
          config={SHIFT4_CONFIG}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={connection.initial_sync_done}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
          config={SHIFT4_CONFIG}
        />

        {isLoading && (
          <SyncProgressDisplay
            progress={syncProgress}
            itemsSynced={totalTicketsSynced}
            initialSyncDone={connection.initial_sync_done}
            config={SHIFT4_CONFIG}
          />
        )}

        {syncResult && (
          <SyncResults
            itemsSynced={syncResult.ticketsSynced}
            errors={syncResult.errors}
            config={SHIFT4_CONFIG}
          />
        )}

        <HowSyncingWorksInfo config={SHIFT4_CONFIG} />
      </CardContent>
    </Card>
  );
}

export { Shift4Sync as default };
