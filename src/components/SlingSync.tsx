import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { RefreshCw, AlertCircle } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { useSlingConnection } from '@/hooks/useSlingConnection';

import {
  ConnectionStatus,
  InitialSyncPendingAlert,
  LastErrorAlert,
  SyncModeSelector,
  SyncButton,
  SyncProgressDisplay,
  SyncResults,
  HowSyncingWorksInfo,
  SLING_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

import { format } from 'date-fns';

interface SlingSyncProps {
  readonly restaurantId: string;
}

interface SyncError {
  message: string;
}

interface SyncResult {
  shiftsSynced: number;
  timesheetsSynced: number;
  errors: (string | SyncError)[];
  syncComplete?: boolean;
  progress?: number;
}

function formatErrors(errors: (string | SyncError)[]): string[] {
  return errors.map(e => typeof e === 'string' ? e : e.message);
}

export function SlingSync({ restaurantId }: SlingSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [totalItemsSynced, setTotalItemsSynced] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>('recent');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const { toast } = useToast();
  const { connection, triggerManualSync } = useSlingConnection(restaurantId);

  async function executeSyncLoop(options?: { startDate?: string; endDate?: string }): Promise<{
    totalShifts: number;
    totalTimesheets: number;
    allErrors: (string | SyncError)[];
    complete: boolean;
  }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    const BATCH_DELAY_MS = 500;

    const allErrors: (string | SyncError)[] = [];
    let totalShifts = 0;
    let totalTimesheets = 0;
    let complete = false;
    let consecutiveFailures = 0;

    while (!complete) {
      try {
        const data = await triggerManualSync(restaurantId, options);

        if (!data || (data.shiftsSynced === undefined && data.timesheetsSynced === undefined)) {
          break;
        }

        consecutiveFailures = 0;
        totalShifts += Number(data.shiftsSynced) || 0;
        totalTimesheets += Number(data.timesheetsSynced) || 0;
        const currentTotal = totalShifts + totalTimesheets;
        setTotalItemsSynced(currentTotal);
        setSyncProgress(Number(data.progress) || 100);

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

        if (consecutiveFailures >= MAX_RETRIES) {
          allErrors.push({ message: `Sync interrupted after ${MAX_RETRIES} retries: ${errorMessage}` });
          break;
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    return { totalShifts, totalTimesheets, allErrors, complete };
  }

  async function handleSync(): Promise<void> {
    if (!connection?.is_active) {
      toast({
        title: 'Error',
        description: 'Please connect to Sling first',
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
    setTotalItemsSynced(0);
    setSyncProgress(0);

    try {
      const syncOptions = syncMode === 'custom' && dateRange
        ? { startDate: format(dateRange.from, 'yyyy-MM-dd'), endDate: format(dateRange.to, 'yyyy-MM-dd') }
        : undefined;

      const { totalShifts, totalTimesheets, allErrors } = await executeSyncLoop(syncOptions);

      setSyncResult({
        shiftsSynced: totalShifts,
        timesheetsSynced: totalTimesheets,
        errors: allErrors,
        syncComplete: true,
        progress: 100,
      });

      const description = syncMode === 'custom' && dateRange
        ? `${totalShifts} shifts + ${totalTimesheets} timesheets synced for ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`
        : `${totalShifts} shifts + ${totalTimesheets} timesheets synced successfully`;

      toast({ title: 'Sync complete', description });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({ title: 'Sync failed', description: errorMessage, variant: 'destructive' });

      if (totalItemsSynced > 0) {
        setSyncResult({
          shiftsSynced: 0,
          timesheetsSynced: 0,
          errors: [errorMessage],
          syncComplete: false,
          progress: syncProgress,
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
            Sling Data Sync
          </CardTitle>
          <CardDescription>
            Connect to Sling to sync your shift and timesheet data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect to Sling first to enable data synchronization.
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
          Sling Data Sync
        </CardTitle>
        <CardDescription>
          Sync your Sling shifts and time punches to populate payroll calculations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConnectionStatus lastSyncTime={lastSyncTime} config={SLING_CONFIG} />

        {!connection.initial_sync_done && (
          <InitialSyncPendingAlert syncCursor={connection.sync_cursor} config={SLING_CONFIG} />
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
          config={SLING_CONFIG}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={connection.initial_sync_done}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
          config={SLING_CONFIG}
        />

        {isLoading && (
          <SyncProgressDisplay
            progress={syncProgress}
            itemsSynced={totalItemsSynced}
            initialSyncDone={connection.initial_sync_done}
            config={SLING_CONFIG}
          />
        )}

        {syncResult && (
          <SyncResults
            itemsSynced={syncResult.shiftsSynced + syncResult.timesheetsSynced}
            errors={formatErrors(syncResult.errors)}
            config={SLING_CONFIG}
          />
        )}

        <HowSyncingWorksInfo config={SLING_CONFIG} />
      </CardContent>
    </Card>
  );
}
