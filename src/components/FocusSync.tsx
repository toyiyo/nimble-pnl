/**
 * FocusSync.tsx
 *
 * Sync dashboard for Focus POS. Reuses SyncComponents with FOCUS_CONFIG.
 *
 * Design doc §8.5 / Frontend critical #2 + §5.5:
 * - handleSync makes ONE call (no loop). recent/initial → triggerManualSync(restaurantId);
 *   custom → triggerManualSync(restaurantId, { startDate, endDate }) (yyyy-MM-dd).
 * - Background toast shown ("running in the background") — not "Sync complete".
 * - Dead progress state removed: syncProgress, totalDaysSynced, syncResult gone.
 * - SyncProgressDisplay and SyncResults removed — live progress via InitialSyncPendingAlert.
 *
 * Differences from ToastSync:
 * - No nextPage (one-day-per-call: backfill increments cursor, incremental covers 2 days)
 * - Uses useFocusConnection instead of useToastConnection
 * - Uses FOCUS_CONFIG (syncInterval:'6 hours', recentWindowLabel:'last 2 business days')
 * - InitialSyncPendingAlert receives syncCursor for passive backfill progress display
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
  HowSyncingWorksInfo,
  FOCUS_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

interface FocusSyncProps {
  restaurantId: string;
}

export function FocusSync({ restaurantId }: FocusSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
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

  // Design §8.5 / Frontend critical #2: one call, background toast, no progress loop.
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

    try {
      if (syncMode === 'custom' && dateRange?.from && dateRange?.to) {
        // Custom range: pass dates as yyyy-MM-dd — the edge function processes synchronously.
        await triggerManualSync(restaurantId, {
          startDate: format(dateRange.from, 'yyyy-MM-dd'),
          endDate: format(dateRange.to, 'yyyy-MM-dd'),
        });
      } else {
        // Recent / initial backfill: one kick; the 5-min cron finishes the rest.
        await triggerManualSync(restaurantId);
      }

      toast({
        title: 'Import started',
        description: 'Running in the background. You can leave this page; it keeps going.',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({ title: 'Sync failed', description: errorMessage, variant: 'destructive' });
      console.error('Focus sync error:', error);
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

        {/* Passive backfill progress — polls via refetchInterval in useFocusConnection.
            No explicit progress bar here: InitialSyncPendingAlert shows "N of 90 days"
            and updates itself as the connection row changes. */}
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

        <HowSyncingWorksInfo config={FOCUS_CONFIG} />
      </CardContent>
    </Card>
  );
}

export default FocusSync;
