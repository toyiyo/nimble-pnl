import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useToast } from '@/hooks/use-toast';
import { useShift4Integration } from '@/hooks/useShift4Integration';
import { RefreshCw, AlertCircle, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface Shift4SyncProps {
  restaurantId: string;
}

interface SyncResult {
  ticketsSynced: number;
  errors: string[];
  syncComplete: boolean;
  progress: number;
}

type SyncMode = 'recent' | 'custom';

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

    // Validate custom date range
    if (syncMode === 'custom') {
      if (!dateRange?.from || !dateRange?.to) {
        toast({
          title: 'Error',
          description: 'Please select a date range',
          variant: 'destructive',
        });
        return;
      }
    }

    setIsLoading(true);
    setSyncResult(null);
    setTotalTicketsSynced(0);
    setSyncProgress(0);

    try {
      // Build sync options
      const syncOptions = syncMode === 'custom' && dateRange
        ? {
            startDate: dateRange.from.toISOString(),
            endDate: dateRange.to.toISOString()
          }
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

      toast({
        title: 'Sync complete',
        description,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      toast({
        title: 'Sync failed',
        description: errorMessage,
        variant: 'destructive',
      });
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
  const initialSyncDone = connection.initial_sync_done;

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
        <ConnectionStatus lastSyncTime={lastSyncTime} />

        {!initialSyncDone && <InitialSyncPendingAlert syncCursor={connection.sync_cursor} />}

        {connection.last_error && (
          <LastErrorAlert
            error={connection.last_error}
            errorAt={connection.last_error_at}
          />
        )}

        <SyncModeSelector
          syncMode={syncMode}
          onSyncModeChange={setSyncMode}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          initialSyncDone={initialSyncDone}
        />

        <SyncButton
          isLoading={isLoading}
          initialSyncDone={initialSyncDone}
          syncMode={syncMode}
          dateRange={dateRange}
          onSync={handleSync}
        />

        {isLoading && (
          <SyncProgressDisplay
            progress={syncProgress}
            ticketsSynced={totalTicketsSynced}
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
            Tickets sync automatically every 2 hours
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

function InitialSyncPendingAlert({ syncCursor }: { syncCursor?: number }): JSX.Element {
  const daysCompleted = syncCursor || 0;
  const progress = Math.round((daysCompleted / 90) * 100);

  return (
    <Alert>
      <Calendar className="h-4 w-4" />
      <AlertDescription>
        <strong>Initial sync in progress:</strong> {daysCompleted > 0
          ? `${daysCompleted} of 90 days completed (${progress}%). Click "Sync Now" to continue.`
          : 'The next scheduled sync will import your last 90 days of tickets. You can also click "Sync Now" to start immediately.'}
      </AlertDescription>
    </Alert>
  );
}

function LastErrorAlert({ error, errorAt }: { error: string; errorAt?: string | null }): JSX.Element {
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

interface SyncModeSelectorProps {
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
  dateRange: { from: Date; to: Date } | undefined;
  onDateRangeChange: (range: { from: Date; to: Date } | undefined) => void;
  initialSyncDone?: boolean;
}

function SyncModeSelector({
  syncMode,
  onSyncModeChange,
  dateRange,
  onDateRangeChange,
  initialSyncDone
}: SyncModeSelectorProps): JSX.Element {
  return (
    <div className="space-y-4">
      <RadioGroup
        value={syncMode}
        onValueChange={(value) => onSyncModeChange(value as SyncMode)}
        className="space-y-3"
      >
        <div className="flex items-start space-x-3">
          <RadioGroupItem value="recent" id="recent" className="mt-1" />
          <div className="flex-1">
            <Label htmlFor="recent" className="font-medium cursor-pointer">
              {initialSyncDone ? 'Sync recent tickets' : 'Initial sync'}
            </Label>
            <p className="text-sm text-muted-foreground">
              {initialSyncDone
                ? 'Fetch tickets from the last 25 hours'
                : 'Import last 90 days of ticket history'}
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <RadioGroupItem value="custom" id="custom" className="mt-1" />
          <div className="flex-1 space-y-2">
            <Label htmlFor="custom" className="font-medium cursor-pointer">
              Custom date range
            </Label>
            <p className="text-sm text-muted-foreground">
              Backfill or re-sync tickets for specific dates (max 90 days)
            </p>
            {syncMode === 'custom' && (
              <div className="pt-2">
                <DateRangePicker
                  from={dateRange?.from}
                  to={dateRange?.to}
                  onSelect={onDateRangeChange}
                />
              </div>
            )}
          </div>
        </div>
      </RadioGroup>
    </div>
  );
}

interface SyncButtonProps {
  isLoading: boolean;
  initialSyncDone?: boolean;
  syncMode: SyncMode;
  dateRange?: { from: Date; to: Date };
  onSync: () => void;
}

function getSyncDescription(
  syncMode: SyncMode,
  dateRange: { from: Date; to: Date } | undefined,
  initialSyncDone: boolean | undefined
): string {
  if (syncMode === 'custom' && dateRange) {
    return `Sync tickets from ${format(dateRange.from, 'MMM d')} to ${format(dateRange.to, 'MMM d, yyyy')}`;
  }
  if (initialSyncDone) {
    return 'Manually sync tickets from the last 25 hours';
  }
  return 'Start initial sync (last 90 days of tickets)';
}

function SyncButton({ isLoading, initialSyncDone, syncMode, dateRange, onSync }: SyncButtonProps): JSX.Element {
  const buttonText = isLoading ? 'Syncing...' : 'Sync Now';
  const description = getSyncDescription(syncMode, dateRange, initialSyncDone);
  const isDisabled = isLoading || (syncMode === 'custom' && !dateRange);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <Button
          onClick={onSync}
          disabled={isDisabled}
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

interface SyncProgressDisplayProps {
  progress: number;
  ticketsSynced: number;
  initialSyncDone?: boolean;
}

function SyncProgressDisplay({ progress, ticketsSynced, initialSyncDone }: SyncProgressDisplayProps): JSX.Element {
  const statusText = initialSyncDone ? 'Syncing recent tickets' : 'Initial sync fetches 90 days of history in batches';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Syncing data from Lighthouse... {progress > 0 && `(${progress}%)`}
        </span>
        <RefreshCw className="h-4 w-4 animate-spin" />
      </div>
      {ticketsSynced > 0 && (
        <p className="text-xs text-muted-foreground">
          {ticketsSynced} tickets synced so far
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
        <div className="text-2xl font-bold text-primary">{result.ticketsSynced}</div>
        <div className="text-sm text-muted-foreground">Tickets synced</div>
      </div>

      {result.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-medium">Some errors occurred:</div>
              {result.errors.map((error, idx) => (
                <div key={`error-${idx}`} className="text-sm">
                  {error}
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
            <div><strong>Scheduled Sync:</strong> Tickets sync automatically every 2 hours</div>
            <div><strong>Manual Sync:</strong> Use the button above for immediate sync</div>
            <div><strong>Historical Data:</strong> First sync imports last 90 days of tickets</div>
            <div><strong>Incremental:</strong> After initial sync, only recent tickets are fetched</div>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Legacy export for backward compatibility
export { Shift4Sync as default };
