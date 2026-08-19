import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ClipboardCheck } from 'lucide-react';

import type { AuditSummary } from '@/utils/scheduleClockAudit';
import { AUDIT_TONE_CLASS } from './auditChipTone';

/** Which chip class filters the payroll table. `null` means no filter. */
export type ClockAuditFilterClass = 'to_fix' | 'no_clock_out' | 'info' | 'matched';

interface ClockAuditBarProps {
  summary: AuditSummary;
  loading: boolean;
  error: unknown;
  tolerance: number;
  onToleranceChange: (minutes: number) => void;
  activeFilter: ClockAuditFilterClass | null;
  onFilterChange: (filterClass: ClockAuditFilterClass | null) => void;
}

interface ChipDef {
  filterClass: ClockAuditFilterClass;
  count: number;
  label: string;
  toneClass: string;
}

/**
 * Thin summary bar above the payroll table: count chips that filter the
 * table by clock-check class, and the audit tolerance select.
 *
 * The payroll table renders in every state — loading, error, or data —
 * so an audit failure never hides the pay data.
 */
export function ClockAuditBar({
  summary,
  loading,
  error,
  tolerance,
  onToleranceChange,
  activeFilter,
  onFilterChange,
}: Readonly<ClockAuditBarProps>) {
  const toFix = summary.missingClock + summary.timeMismatch;
  const info = summary.unscheduledClock + summary.inProgress;

  const chips: ChipDef[] = [
    {
      filterClass: 'to_fix',
      count: toFix,
      label: `${toFix} to fix`,
      toneClass: AUDIT_TONE_CLASS.to_fix,
    },
    {
      filterClass: 'no_clock_out',
      count: summary.openClock,
      label: `${summary.openClock} no clock-out`,
      toneClass: AUDIT_TONE_CLASS.no_clock_out,
    },
    {
      filterClass: 'info',
      count: info,
      label: `${info} info`,
      toneClass: AUDIT_TONE_CLASS.info,
    },
    {
      filterClass: 'matched',
      count: summary.matched,
      label: `${summary.matched} matched`,
      toneClass: AUDIT_TONE_CLASS.matched,
    },
  ];

  const toggleFilter = (filterClass: ClockAuditFilterClass) => {
    onFilterChange(activeFilter === filterClass ? null : filterClass);
  };

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap px-1 py-2">
      <div className="flex items-center gap-2 flex-wrap min-h-9">
        <ClipboardCheck className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-[13px] font-medium text-muted-foreground shrink-0">Clock check</span>
        {loading && <Skeleton className="h-6 w-56 rounded-md" />}
        {!loading && error && (
          <p className="text-[13px] text-destructive" role="alert">
            Error loading the clock check: {error instanceof Error ? error.message : 'unknown error'}
          </p>
        )}
        {!loading &&
          !error &&
          chips.map((chip) => (
            <button
              key={chip.filterClass}
              type="button"
              disabled={chip.count === 0}
              aria-pressed={activeFilter === chip.filterClass}
              onClick={() => toggleFilter(chip.filterClass)}
              className={`text-[11px] px-2 py-1 rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${chip.toneClass} ${
                activeFilter === chip.filterClass ? 'ring-1 ring-foreground/40' : ''
              }`}
            >
              {chip.label}
            </button>
          ))}
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
  );
}
