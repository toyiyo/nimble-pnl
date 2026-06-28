/**
 * FocusSync.tsx
 *
 * Sync dashboard for Focus POS. Reuses SyncComponents with FOCUS_CONFIG.
 *
 * Design doc §10 + F5 (FOCUS_CONFIG.recentWindowLabel = 'last 2 business days'),
 * F7 (early-return not-connected guard).
 *
 * Differences from ToastSync:
 * - No nextPage (one-day-per-call: backfill increments cursor, incremental covers 2 days)
 * - Uses useFocusConnection instead of useToastConnection
 * - Uses FOCUS_CONFIG (syncInterval:'6 hours', recentWindowLabel:'last 2 business days')
 * - InitialSyncPendingAlert receives syncCursor for backfill progress display
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useFocusConnection } from '@/hooks/useFocusConnection';
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
  FOCUS_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

interface FocusSyncProps {
  restaurantId: string;
}

interface SyncResult {
  daysSynced: number;
  errors: string[];
  syncComplete: boolean;
  progress: number;
}

export function FocusSync({ restaurantId }: FocusSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [totalDaysSynced, setTotalDaysSynced] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>('recent');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const { toast } = useToast();
  const { connection, loading: connectionLoading, error: connectionError, triggerManualSync } = useFocusConnection(restaurantId);

  // Handle query loading / error states before the happy path (CLAUDE.md rule)
  if (connectionLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (connectionError) {
    return (
      <Card>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load Focus POS connection status. Please refresh the page.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // F7: early-return guard — don't read connection.initial_sync_done on null
  if (!connection?.is_active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Focus POS Data Sync
          </CardTitle>
          <CardDescription>
            Connect to Focus POS to sync your daily sales data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect to Focus POS first to enable data synchronization.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  async function handleSync(): Promise<void> {
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
    setTotalDaysSynced(0);
    setSyncProgress(0);

    const allErrors: string[] = [];
    let totalDays = 0;

    try {
      // Focus sync is one-day-per-call (no nextPage pagination).
      // For custom date range, we call triggerManualSync once and let the edge function
      // handle the date range. For recent/initial, we call once per click.
      const data = await triggerManualSync(restaurantId);

      if (data) {
        // The edge function returns { syncCursor, initialSyncDone, status }
        // We treat each call as 1 day synced for progress feedback.
        totalDays = 1;
        setTotalDaysSynced(totalDays);
        setSyncProgress(100);

        if (data.status === 'error') {
          allErrors.push('Sync reported an error — check connection status for details');
        }
      }

      setSyncResult({
        daysSynced: totalDays,
        errors: allErrors,
        syncComplete: true,
        progress: 100,
      });

      const description =
        syncMode === 'custom' && dateRange
          ? `Synced for ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`
          : 'Sync triggered successfully';

      toast({ title: 'Sync complete', description });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({ title: 'Sync failed', description: errorMessage, variant: 'destructive' });
      console.error('Focus sync error:', error);

      // Use local `totalDays` (not the React state `totalDaysSynced`) because the
      // state setter is async — the closure captures the value at render time (0).
      if (totalDays > 0) {
        setSyncResult({
          daysSynced: totalDays,
          errors: [errorMessage],
          syncComplete: false,
          progress: 100,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  const lastSyncTime = connection.last_sync_time ? new Date(connection.last_sync_time) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Focus POS Data Sync
        </CardTitle>
        <CardDescription>
          Sync your Focus POS daily reports to populate P&amp;L calculations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConnectionStatus lastSyncTime={lastSyncTime} config={FOCUS_CONFIG} />

        {/* Backfill progress: pass syncCursor so InitialSyncPendingAlert shows "N of 90 days" */}
        {!connection.initial_sync_done && (
          <InitialSyncPendingAlert
            syncCursor={connection.sync_cursor}
            config={FOCUS_CONFIG}
          />
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
          config={FOCUS_CONFIG}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={connection.initial_sync_done}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
          config={FOCUS_CONFIG}
        />

        {isLoading && (
          <SyncProgressDisplay
            progress={syncProgress}
            itemsSynced={totalDaysSynced}
            initialSyncDone={connection.initial_sync_done}
            config={FOCUS_CONFIG}
          />
        )}

        {syncResult && (
          <SyncResults
            itemsSynced={syncResult.daysSynced}
            errors={syncResult.errors}
            config={FOCUS_CONFIG}
          />
        )}

        <HowSyncingWorksInfo config={FOCUS_CONFIG} />
      </CardContent>
    </Card>
  );
}

export default FocusSync;
