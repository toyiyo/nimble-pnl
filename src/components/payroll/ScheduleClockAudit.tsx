import { useMemo, useRef, useState } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CalendarClock, CheckCircle2 } from 'lucide-react';

import { useScheduleClockAudit } from '@/hooks/useScheduleClockAudit';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { useEmployees } from '@/hooks/useEmployees';
import {
  formatDeltaMinutes,
  formatMinutesAsHours,
  type AuditRow,
  type AuditRowStatus,
  type AuditSummary,
} from '@/utils/scheduleClockAudit';
import type { Employee } from '@/types/scheduling';

import { RecordShiftClockDialog } from './RecordShiftClockDialog';

interface ScheduleClockAuditProps {
  restaurantId: string;
  start: Date;
  end: Date;
}

interface ScheduleClockAuditViewProps extends ScheduleClockAuditProps {
  employees: Employee[];
  rows: AuditRow[];
  summary: AuditSummary;
  loading: boolean;
  error: unknown;
  tolerance: number;
  onToleranceChange: (minutes: number) => void;
}

type FilterTab = 'issues' | 'missing' | 'mismatch' | 'unscheduled' | 'matched';

const STATUS_LABEL: Record<AuditRowStatus, string> = {
  missing_clock: 'No clock data',
  open_clock: 'No clock-out',
  time_mismatch: 'Time difference',
  unscheduled_clock: 'Not scheduled',
  matched: 'Matched',
};

const STATUS_DOT: Record<AuditRowStatus, string> = {
  missing_clock: 'bg-destructive',
  open_clock: 'bg-warning',
  time_mismatch: 'bg-warning',
  unscheduled_clock: 'bg-info',
  matched: 'bg-success',
};

const STATUS_BADGE: Record<AuditRowStatus, string> = {
  missing_clock: 'bg-destructive/10 text-destructive border-destructive/20',
  open_clock: 'bg-warning/10 text-warning border-warning/20',
  time_mismatch: 'bg-warning/10 text-warning border-warning/20',
  unscheduled_clock: 'bg-info/10 text-info border-info/20',
  matched: 'bg-success/10 text-success border-success/20',
};

const ISSUE_STATUSES: AuditRowStatus[] = ['missing_clock', 'open_clock', 'time_mismatch'];

const rowMatchesTab = (row: AuditRow, tab: FilterTab): boolean => {
  switch (tab) {
    case 'issues':
      return ISSUE_STATUSES.includes(row.status);
    case 'missing':
      return row.status === 'missing_clock' || row.status === 'open_clock';
    case 'mismatch':
      return row.status === 'time_mismatch';
    case 'unscheduled':
      return row.status === 'unscheduled_clock';
    case 'matched':
      return row.status === 'matched';
  }
};

/**
 * Payroll check: compare the scheduled shifts with the clock data.
 *
 * Shows every shift without punches, every open session, and every large
 * time difference. The manager can create the missing punches from the
 * scheduled times with one dialog.
 */
export function ScheduleClockAudit({
  restaurantId,
  start,
  end,
}: ScheduleClockAuditProps) {
  const [tolerance, setTolerance] = useState(10);

  const { employees } = useEmployees(restaurantId, { status: 'all' });
  const { rows, summary, loading, error } = useScheduleClockAudit(
    restaurantId,
    start,
    end,
    tolerance,
  );

  return (
    <ScheduleClockAuditView
      restaurantId={restaurantId}
      start={start}
      end={end}
      employees={employees}
      rows={rows}
      summary={summary}
      loading={loading}
      error={error}
      tolerance={tolerance}
      onToleranceChange={setTolerance}
    />
  );
}

/**
 * The presentation half of the check. The container above feeds it live
 * data. The dev demo page feeds it sample data.
 */
export function ScheduleClockAuditView({
  restaurantId,
  start,
  end,
  employees,
  rows,
  summary,
  loading,
  error,
  tolerance,
  onToleranceChange,
}: ScheduleClockAuditViewProps) {
  const [tab, setTab] = useState<FilterTab>('issues');
  const [activeRow, setActiveRow] = useState<AuditRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { formatInstant } = useRestaurantClock();

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees) map.set(employee.id, employee.name);
    return map;
  }, [employees]);

  const issueCount = summary.missingClock + summary.openClock + summary.timeMismatch;

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'issues', label: 'Issues', count: issueCount },
    { key: 'missing', label: 'Missing clocks', count: summary.missingClock + summary.openClock },
    { key: 'mismatch', label: 'Time differences', count: summary.timeMismatch },
    { key: 'unscheduled', label: 'Unscheduled', count: summary.unscheduledClock },
    { key: 'matched', label: 'Matched', count: summary.matched },
  ];

  const visibleRows = useMemo(
    () => rows.filter((row) => rowMatchesTab(row, tab)),
    [rows, tab],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 10,
  });

  const openDialog = (row: AuditRow) => {
    setActiveRow(row);
    setDialogOpen(true);
  };

  const renderTimes = (row: AuditRow) => {
    const scheduled = row.shift
      ? `${formatInstant(row.shift.start_time, 'h:mm a')} – ${formatInstant(row.shift.end_time, 'h:mm a')}`
      : '—';
    let clocked = '—';
    if (row.session) {
      const outPart = row.session.clockOut
        ? formatInstant(row.session.clockOut, 'h:mm a')
        : 'no clock-out';
      clocked = `${formatInstant(row.session.clockIn, 'h:mm a')} – ${outPart}`;
    }
    return (
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px]">
        <span className="text-muted-foreground">
          Scheduled <span className="text-foreground font-medium">{scheduled}</span>
          {row.scheduledMinutes !== undefined && (
            <span className="text-muted-foreground"> · {formatMinutesAsHours(row.scheduledMinutes)}</span>
          )}
        </span>
        <span className="text-muted-foreground">
          Clocked <span className="text-foreground font-medium">{clocked}</span>
          {row.workedMinutes !== undefined && (
            <span className="text-muted-foreground"> · {formatMinutesAsHours(row.workedMinutes)}</span>
          )}
        </span>
        {row.status === 'time_mismatch' && (
          <span className="text-warning font-medium">
            in {formatDeltaMinutes(row.inDeltaMinutes)} · out {formatDeltaMinutes(row.outDeltaMinutes)}
          </span>
        )}
      </div>
    );
  };

  const renderRow = (row: AuditRow) => {
    const dateSource = row.shift?.start_time ?? row.session?.clockIn ?? '';
    const employeeName = employeeNames.get(row.employeeId) ?? 'Unknown employee';
    const canEnterClock = row.status === 'missing_clock' || row.status === 'open_clock';

    return (
      <div
        role="listitem"
        aria-label={`${employeeName} — ${STATUS_LABEL[row.status]}`}
        className="group flex items-start justify-between gap-4 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"
      >
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${STATUS_DOT[row.status]}`}
              aria-hidden="true"
            />
            <span className="text-[14px] font-medium text-foreground">{employeeName}</span>
            {row.shift?.position && (
              <span className="text-[13px] text-muted-foreground">{row.shift.position}</span>
            )}
            <span className="text-[13px] text-muted-foreground">
              {dateSource ? formatInstant(dateSource, 'EEE, MMM d') : ''}
            </span>
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-md border font-medium ${STATUS_BADGE[row.status]}`}
            >
              {STATUS_LABEL[row.status]}
            </span>
          </div>
          {renderTimes(row)}
        </div>
        {canEnterClock && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openDialog(row)}
            className="h-9 px-4 rounded-lg text-[13px] font-medium shrink-0"
            aria-label={`Enter clock data for ${employeeName}`}
          >
            {row.status === 'open_clock' ? 'Enter clock-out' : 'Enter clock data'}
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-[17px] font-semibold">Schedule vs. clock check</CardTitle>
              <CardDescription className="text-[13px] mt-0.5">
                Payroll pays only from clock data. This check finds shifts without punches.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="audit-tolerance"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Tolerance
            </label>
            <Select value={String(tolerance)} onValueChange={(v) => onToleranceChange(Number(v))}>
              <SelectTrigger
                id="audit-tolerance"
                className="h-9 w-[110px] text-[13px] bg-muted/30 border-border/40 rounded-lg"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="10">10 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <p className="text-[13px] text-destructive">
            Error loading the check: {error instanceof Error ? error.message : 'unknown error'}
          </p>
        ) : (
          <>
            {/* Apple-style underline tabs */}
            <div className="border-b border-border/40 mb-4" role="tablist" aria-label="Filter check results">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                    tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    {t.count}
                  </span>
                  {tab === t.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
                  )}
                </button>
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle2
                  className="h-10 w-10 text-success mx-auto mb-3"
                  aria-hidden="true"
                />
                <p className="text-[14px] font-medium text-foreground">
                  {tab === 'issues'
                    ? 'Every scheduled shift has matching clock data.'
                    : 'No entries in this view.'}
                </p>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Period {formatInstant(start, 'MMM d')} – {formatInstant(end, 'MMM d')}
                </p>
              </div>
            ) : (
              <div ref={parentRef} className="max-h-[600px] overflow-y-auto">
                <div
                  role="list"
                  aria-label="Schedule vs. clock check results"
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: 'relative',
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = visibleRows[virtualRow.index];
                    if (!row) return null;
                    return (
                      <div
                        key={row.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className="pb-2"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {renderRow(row)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Single dialog for the whole list */}
      {activeRow?.shift && (
        <RecordShiftClockDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          row={activeRow}
          employeeName={employeeNames.get(activeRow.employeeId) ?? 'Unknown employee'}
          restaurantId={restaurantId}
        />
      )}
    </Card>
  );
}
