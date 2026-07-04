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
  dataLabel: string;          // "orders" or "tickets"
  dataLabelSingular: string;  // "order" or "ticket"
  syncInterval: string;       // "2 hours" or "6 hours"
  recentWindowLabel?: string; // e.g. "last 2 business days" — overrides "last 25 hours"
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Capitalizes the first character of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Connection Status ---

interface ConnectionStatusProps {
  lastSyncTime: Date | null;
  config: POSConfig;
}

export function ConnectionStatus({ lastSyncTime, config }: ConnectionStatusProps): JSX.Element {
  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/50">
          <Clock className="h-4 w-4 text-foreground" />
        </div>
        <div className="flex-1">
          <h4 className="text-[14px] font-medium text-foreground">Scheduled Sync Active</h4>
          <p className="text-[13px] text-muted-foreground">
            {capitalize(config.dataLabel)} sync automatically every {config.syncInterval}
          </p>
          {lastSyncTime && (
            <p className="text-[12px] text-muted-foreground mt-1">
              Last synced: {formatDistanceToNow(lastSyncTime, { addSuffix: true })}
              <span className="text-muted-foreground/60 ml-1">
                ({format(lastSyncTime, 'PPp')})
              </span>
            </p>
          )}
        </div>
        <Badge
          variant="outline"
          className="border-border/40 bg-muted/50 text-foreground"
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
  const daysCompleted = syncCursor ?? 0;
  const progress = Math.min(100, Math.round((daysCompleted / 90) * 100));

  return (
    <Alert>
      <Calendar className="h-4 w-4" />
      <AlertDescription>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>Importing your last 90 days in the background</strong>{' '}
          ({daysCompleted} of 90, {progress}%). No need to keep this page open.
        </span>
        <Progress
          value={progress}
          className="mt-2"
          aria-label="Sync progress"
          aria-valuemin={0}
          aria-valuemax={100}
        />
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
            <Label htmlFor="recent" className="text-[14px] font-medium text-foreground cursor-pointer">
              {initialSyncDone ? `Sync recent ${config.dataLabel}` : 'Initial sync'}
            </Label>
            <p className="text-[13px] text-muted-foreground">
              {initialSyncDone
                ? `Fetch ${config.dataLabel} from the ${config.recentWindowLabel ?? 'last 25 hours'}`
                : `Import last 90 days of ${config.dataLabelSingular} history`}
            </p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <RadioGroupItem value="custom" id="custom" className="mt-1" />
          <div className="flex-1 space-y-2">
            <Label htmlFor="custom" className="text-[14px] font-medium text-foreground cursor-pointer">
              Custom date range
            </Label>
            <p className="text-[13px] text-muted-foreground">
              Backfill or re-sync {config.dataLabel} for specific dates (max 14 days)
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
    return `Manually sync ${config.dataLabel} from the ${config.recentWindowLabel ?? 'last 25 hours'}`;
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
          aria-label={isLoading ? 'Syncing in progress…' : undefined}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {buttonText}
        </Button>
        <p className="text-[13px] text-muted-foreground mt-2">{description}</p>
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
        <span className="text-[14px] font-medium text-foreground">
          Syncing data from {config.name}... {progress > 0 && `(${progress}%)`}
        </span>
        <RefreshCw className="h-4 w-4 animate-spin text-foreground" aria-hidden="true" />
      </div>
      {itemsSynced > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {itemsSynced} {config.dataLabel} synced so far
        </p>
      )}
      <Progress value={progress || undefined} className="w-full" />
      <p className="text-[12px] text-muted-foreground">{statusText}</p>
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
    <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-foreground" aria-hidden="true" />
        <h4 className="text-[14px] font-medium text-foreground">Sync Complete</h4>
      </div>

      <div className="space-y-1">
        <div className="text-[17px] font-semibold text-foreground">{itemsSynced}</div>
        <div className="text-[13px] text-muted-foreground">
          {capitalize(config.dataLabel)} synced
        </div>
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="text-[14px] font-medium">Some errors occurred:</div>
              {errors.map((error, idx) => (
                <div key={`error-${idx}`} className="text-[13px]">
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
    <Alert className="border-border/40 bg-muted/30">
      <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <AlertDescription>
        <div className="space-y-2">
          <div className="text-[14px] font-medium text-foreground">How syncing works</div>
          <div className="text-[13px] text-muted-foreground space-y-1">
            <div><strong className="text-foreground">Scheduled Sync:</strong> {capitalize(config.dataLabel)} sync automatically every {config.syncInterval}</div>
            <div><strong className="text-foreground">Manual Sync:</strong> Use the button above for immediate sync</div>
            <div><strong className="text-foreground">Historical Data:</strong> First sync imports last 90 days of {config.dataLabel}</div>
            <div><strong className="text-foreground">Incremental:</strong> After initial sync, only recent {config.dataLabel} are fetched</div>
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

export const SLING_CONFIG: POSConfig = {
  name: 'Sling',
  dataLabel: 'shifts',
  dataLabelSingular: 'shift',
  syncInterval: '6 hours',
};

export const FOCUS_CONFIG: POSConfig = {
  name: 'Focus POS',
  dataLabel: 'daily reports',
  dataLabelSingular: 'daily report',
  syncInterval: '6 hours',
  recentWindowLabel: 'last 2 business days',
};
