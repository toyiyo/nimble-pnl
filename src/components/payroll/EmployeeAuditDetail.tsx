import { Button } from '@/components/ui/button';

import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import {
  formatDeltaMinutes,
  formatMinutesAsHours,
  type AuditRow,
  type AuditRowStatus,
  type WorkSession,
} from '@/utils/scheduleClockAudit';

interface EmployeeAuditDetailProps {
  /** This employee's audit rows, ordered by time. */
  rows: AuditRow[];
  employeeName: string;
  onEnterClock: (row: AuditRow) => void;
}

const STATUS_LABEL: Record<AuditRowStatus, string> = {
  missing_clock: 'No clock data',
  open_clock: 'No clock-out',
  time_mismatch: 'Time difference',
  unscheduled_clock: 'Not scheduled',
  in_progress: 'In progress',
  matched: 'Matched',
  draft: 'Draft',
};

const STATUS_DOT: Record<AuditRowStatus, string> = {
  missing_clock: 'bg-destructive',
  open_clock: 'bg-warning',
  time_mismatch: 'bg-warning',
  unscheduled_clock: 'bg-muted-foreground',
  in_progress: 'bg-muted-foreground',
  matched: 'bg-success',
  draft: 'bg-muted-foreground',
};

/** Action button label per status. A status absent from this map shows no button. */
const ACTION_LABEL: Partial<Record<AuditRowStatus, string>> = {
  missing_clock: 'Enter clock data',
  open_clock: 'Enter clock-out',
};

const formatClockedSessions = (
  sessions: WorkSession[] | undefined,
  formatInstant: (value: string | Date, pattern: string) => string,
): string => {
  if (!sessions || sessions.length === 0) return 'No clock data';
  return sessions
    .map((session) => {
      const outPart = session.clockOut ? formatInstant(session.clockOut, 'h:mm a') : 'open';
      return `${formatInstant(session.clockIn, 'h:mm a')} – ${outPart}`;
    })
    .join(', ');
};

/**
 * Expandable per-employee detail row in the payroll table: one line per
 * audit row, with the scheduled and clocked times and a repair action.
 *
 * A single `RecordShiftClockDialog` at the page level opens from
 * `onEnterClock`; this component never opens a dialog itself (the
 * single-dialog rule for a table with many rows).
 */
export function EmployeeAuditDetail({
  rows,
  employeeName,
  onEnterClock,
}: Readonly<EmployeeAuditDetailProps>) {
  const { formatInstant } = useRestaurantClock();

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const dateSource = row.shift?.start_time ?? row.sessions?.[0]?.clockIn ?? '';
        const scheduled = row.shift
          ? `${formatInstant(row.shift.start_time, 'h:mm a')} – ${formatInstant(row.shift.end_time, 'h:mm a')}`
          : '—';
        const clocked = formatClockedSessions(row.sessions, formatInstant);
        const actionLabel = ACTION_LABEL[row.status];

        return (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_DOT[row.status]}`}
                  aria-hidden="true"
                />
                <span className="text-[13px] text-muted-foreground">
                  {dateSource ? formatInstant(dateSource, 'EEE, MMM d') : ''}
                </span>
                <span className="text-[11px] font-medium text-foreground">
                  {STATUS_LABEL[row.status]}
                </span>
                {row.status === 'time_mismatch' && (
                  <span className="text-[11px] text-warning font-medium">
                    in {formatDeltaMinutes(row.inDeltaMinutes)} · out{' '}
                    {formatDeltaMinutes(row.outDeltaMinutes)}
                  </span>
                )}
              </div>
              <div className="text-[13px] text-muted-foreground">
                Scheduled <span className="text-foreground font-medium">{scheduled}</span>
                {row.scheduledMinutes !== undefined &&
                  ` · ${formatMinutesAsHours(row.scheduledMinutes)}`}
              </div>
              <div className="text-[13px] text-muted-foreground">
                Clocked <span className="text-foreground font-medium">{clocked}</span>
                {row.workedMinutes !== undefined && ` · ${formatMinutesAsHours(row.workedMinutes)}`}
                {row.gapMinutes !== undefined && row.gapMinutes > 0 && `, gap ${row.gapMinutes} min`}
              </div>
            </div>
            {actionLabel && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEnterClock(row)}
                className="h-8 px-3 rounded-lg text-[12px] font-medium shrink-0"
                aria-label={`${actionLabel} for ${employeeName}`}
              >
                {actionLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
