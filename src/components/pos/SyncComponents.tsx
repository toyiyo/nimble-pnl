import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { RefreshCw, AlertCircle, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

export type SyncMode = 'recent' | 'custom';

export interface POSConfig {
  name: string;
  dataLabel: string;         // "orders" or "tickets"
  dataLabelSingular: string; // "order" or "ticket"
  syncInterval: string;      // "2 hours" or "6 hours"
}

// --- Connection Status ---

interface ConnectionStatusProps {
  lastSyncTime: Date | null;
  config: POSConfig;
}

export function ConnectionStatus({ lastSyncTime, config }: ConnectionStatusProps): JSX.Element {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-sm">Scheduled Sync Active</h4>
          <p className="text-xs text-muted-foreground">
            {config.dataLabel.charAt(0).toUpperCase() + config.dataLabel.slice(1)} sync automatically every {config.syncInterval}
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

// --- Initial Sync Pending Alert ---

interface InitialSyncPendingAlertProps {
  syncCursor?: number;
  config: POSConfig;
}

export function InitialSyncPendingAlert({ syncCursor, config }: InitialSyncPendingAlertProps): JSX.Element {
  const daysCompleted = syncCursor || 0;
  const progress = Math.round((daysCompleted / 90) * 100);
  const hasProgress = daysCompleted > 0;

  return (
    <Alert>
      <Calendar className="h-4 w-4" />
      <AlertDescription>
        <strong>{hasProgress ? 'Initial sync in progress:' : 'First sync pending:'}</strong>{' '}
        {hasProgress
          ? `${daysCompleted} of 90 days completed (${progress}%). Click "Sync Now" to continue.`
          : `The next scheduled sync will import your last 90 days of ${config.dataLabel}. You can also click "Sync Now" to start immediately.`}
      </AlertDescription>
    </Alert>
  );
}

// --- Last Error Alert ---

interface LastErrorAlertProps {
  error: string;
  errorAt?: string | null;
}

export function LastErrorAlert({ error, errorAt }: LastErrorAlertProps): JSX.Element {
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

// --- Sync Mode Selector ---

interface SyncModeSelectorProps {
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
  dateRange: { from: Date; to: Date } | undefined;
  onDateRangeChange: (range: { from: Date; to: Date } | undefined) => void;
  initialSyncDone?: boolean;
  config: POSConfig;
}

export function SyncModeSelector({
  syncMode,
  onSyncModeChange,
  dateRange,
  onDateRangeChange,
  initialSyncDone,
  config
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
              {initialSyncDone ? `Sync recent ${config.dataLabel}` : 'Initial sync'}
            </Label>
            <p className="text-sm text-muted-foreground">
              {initialSyncDone
                ? `Fetch ${config.dataLabel} from the last 25 hours`
                : `Import last 90 days of ${config.dataLabelSingular} history`}
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
              Backfill or re-sync {config.dataLabel} for specific dates (max 90 days)
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

// --- Sync Button ---

interface SyncButtonProps {
  isLoading: boolean;
  initialSyncDone?: boolean;
  syncMode: SyncMode;
  dateRange?: { from: Date; to: Date };
  onSync: () => void;
  config: POSConfig;
}

function getSyncDescription(
  syncMode: SyncMode,
  dateRange: { from: Date; to: Date } | undefined,
  initialSyncDone: boolean | undefined,
  config: POSConfig
): string {
  if (syncMode === 'custom' && dateRange) {
    return `Sync ${config.dataLabel} from ${format(dateRange.from, 'MMM d')} to ${format(dateRange.to, 'MMM d, yyyy')}`;
  }
  if (initialSyncDone) {
    return `Manually sync ${config.dataLabel} from the last 25 hours`;
  }
  return `Start initial sync (last 90 days of ${config.dataLabel})`;
}

export function SyncButton({ isLoading, initialSyncDone, syncMode, dateRange, onSync, config }: SyncButtonProps): JSX.Element {
  const buttonText = isLoading ? 'Syncing...' : 'Sync Now';
  const description = getSyncDescription(syncMode, dateRange, initialSyncDone, config);
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

// --- Sync Progress Display ---

interface SyncProgressDisplayProps {
  progress: number;
  itemsSynced: number;
  initialSyncDone?: boolean;
  config: POSConfig;
}

export function SyncProgressDisplay({ progress, itemsSynced, initialSyncDone, config }: SyncProgressDisplayProps): JSX.Element {
  const statusText = initialSyncDone
    ? `Syncing recent ${config.dataLabel}`
    : 'Initial sync fetches 90 days of history in batches';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Syncing data from {config.name}... {progress > 0 && `(${progress}%)`}
        </span>
        <RefreshCw className="h-4 w-4 animate-spin" />
      </div>
      {itemsSynced > 0 && (
        <p className="text-xs text-muted-foreground">
          {itemsSynced} {config.dataLabel} synced so far
        </p>
      )}
      <Progress value={progress || undefined} className="w-full" />
      <p className="text-xs text-muted-foreground">{statusText}</p>
    </div>
  );
}

// --- Sync Results ---

interface SyncResultsProps {
  itemsSynced: number;
  errors: string[];
  config: POSConfig;
}

export function SyncResults({ itemsSynced, errors, config }: SyncResultsProps): JSX.Element {
  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <h4 className="font-medium">Sync Complete</h4>
      </div>

      <div className="space-y-1">
        <div className="text-2xl font-bold text-primary">{itemsSynced}</div>
        <div className="text-sm text-muted-foreground">
          {config.dataLabel.charAt(0).toUpperCase() + config.dataLabel.slice(1)} synced
        </div>
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-medium">Some errors occurred:</div>
              {errors.map((error, idx) => (
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

// --- How Syncing Works Info ---

interface HowSyncingWorksInfoProps {
  config: POSConfig;
}

export function HowSyncingWorksInfo({ config }: HowSyncingWorksInfoProps): JSX.Element {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <div className="font-medium">How syncing works</div>
          <div className="text-sm space-y-1">
            <div><strong>Scheduled Sync:</strong> {config.dataLabel.charAt(0).toUpperCase() + config.dataLabel.slice(1)} sync automatically every {config.syncInterval}</div>
            <div><strong>Manual Sync:</strong> Use the button above for immediate sync</div>
            <div><strong>Historical Data:</strong> First sync imports last 90 days of {config.dataLabel}</div>
            <div><strong>Incremental:</strong> After initial sync, only recent {config.dataLabel} are fetched</div>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// --- POS Config Presets ---

export const SHIFT4_CONFIG: POSConfig = {
  name: 'Lighthouse',
  dataLabel: 'tickets',
  dataLabelSingular: 'ticket',
  syncInterval: '2 hours',
};

export const TOAST_CONFIG: POSConfig = {
  name: 'Toast',
  dataLabel: 'orders',
  dataLabelSingular: 'order',
  syncInterval: '6 hours',
};
