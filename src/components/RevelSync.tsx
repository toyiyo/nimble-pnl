import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useRevelConnection } from '@/hooks/useRevelConnection';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
  ConnectionStatus,
  InitialSyncPendingAlert,
  LastErrorAlert,
  SyncModeSelector,
  SyncButton,
  SyncResults,
  HowSyncingWorksInfo,
  REVEL_CONFIG,
  type SyncMode,
} from '@/components/pos/SyncComponents';

interface RevelSyncProps {
  restaurantId: string;
}

export function RevelSync({ restaurantId }: RevelSyncProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ordersSynced: number; errors: string[] } | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>('recent');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const { toast } = useToast();
  const { connection, triggerManualSync, checkConnectionStatus } = useRevelConnection(restaurantId);

  async function handleSync(): Promise<void> {
    if (!connection?.is_active) {
      toast({ title: 'Error', description: 'Please connect to Revel first', variant: 'destructive' });
      return;
    }
    if (syncMode === 'custom' && (!dateRange?.from || !dateRange?.to)) {
      toast({ title: 'Error', description: 'Please select a date range', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);
    try {
      // Revel's Classic order filter expects YYYY-MM-DD (the edge fn appends the time).
      const options = syncMode === 'custom' && dateRange
        ? { startDate: format(dateRange.from, 'yyyy-MM-dd'), endDate: format(dateRange.to, 'yyyy-MM-dd') }
        : undefined;

      const data = await triggerManualSync(restaurantId, options);
      const ordersSynced = Number(data?.ordersProcessed ?? 0);
      const salesSynced = Number(data?.salesSynced ?? 0);

      setSyncResult({ ordersSynced, errors: [] });
      await checkConnectionStatus(restaurantId);

      const description = syncMode === 'custom' && dateRange
        ? `${ordersSynced} orders (${salesSynced} sales) synced for ${format(dateRange.from, 'MMM d')} – ${format(dateRange.to, 'MMM d, yyyy')}`
        : `${ordersSynced} orders (${salesSynced} sales) synced`;
      toast({ title: 'Sync complete', description });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      setSyncResult({ ordersSynced: 0, errors: [message] });
      toast({ title: 'Sync failed', description: message, variant: 'destructive' });
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
            Revel Data Sync
          </CardTitle>
          <CardDescription>Connect to Revel to sync your sales data</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Please connect to Revel first to enable data synchronization.</AlertDescription>
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
          Revel Data Sync
        </CardTitle>
        <CardDescription>Sync your Revel orders to populate P&amp;L calculations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConnectionStatus lastSyncTime={lastSyncTime} config={REVEL_CONFIG} />

        {!connection.initial_sync_done && <InitialSyncPendingAlert config={REVEL_CONFIG} />}

        {connection.last_error && (
          <LastErrorAlert error={connection.last_error} errorAt={connection.last_error_at} />
        )}

        <SyncModeSelector
          syncMode={syncMode}
          onSyncModeChange={setSyncMode}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          initialSyncDone={connection.initial_sync_done}
          config={REVEL_CONFIG}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={connection.initial_sync_done}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
          config={REVEL_CONFIG}
        />

        {syncResult && (
          <SyncResults itemsSynced={syncResult.ordersSynced} errors={syncResult.errors} config={REVEL_CONFIG} />
        )}

        <HowSyncingWorksInfo config={REVEL_CONFIG} />
      </CardContent>
    </Card>
  );
}
