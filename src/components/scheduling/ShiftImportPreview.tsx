import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';

import { CheckCircle2, AlertTriangle, ShieldAlert, MinusCircle, Clock } from 'lucide-react';

import type { ShiftImportEmployee } from '@/utils/shiftEmployeeMatching';
import type { ShiftImportPreviewResult, PreviewShift } from '@/utils/shiftImportPreview';

interface ShiftImportPreviewProps {
  preview: ShiftImportPreviewResult;
  employeeMatches: ShiftImportEmployee[];
}

const statusBadge = (status: PreviewShift['status']) => {
  switch (status) {
    case 'ready':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
          Ready
        </Badge>
      );
    case 'duplicate':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 border-amber-500/20">
          Duplicate
        </Badge>
      );
    case 'published':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive border-destructive/20">
          Published Week
        </Badge>
      );
    case 'skipped':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border-border/40">
          Skipped
        </Badge>
      );
  }
};

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return `${h}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}

function hoursBetween(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const hours = Math.max(0, ms / (1000 * 60 * 60));
  return hours.toFixed(1);
}

const SummaryCard = ({
  label,
  count,
  icon: Icon,
  colorClass,
}: {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}) => (
  <div className="rounded-xl border border-border/40 bg-background p-3 flex items-center gap-3">
    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${colorClass}`}>
      <Icon className="h-4 w-4" />
    </div>
    <div>
      <p className="text-[17px] font-semibold text-foreground">{count}</p>
      <p className="text-[12px] text-muted-foreground">{label}</p>
    </div>
  </div>
);

export const ShiftImportPreview = ({
  preview,
  employeeMatches,
}: ShiftImportPreviewProps) => {
  const { summary, shifts } = preview;

  const employeeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    employeeMatches.forEach(m => {
      if (m.matchedEmployeeName) {
        map[m.csvName] = m.matchedEmployeeName;
      }
    });
    return map;
  }, [employeeMatches]);

  const groupedByDate = useMemo(() => {
    const groups: Array<{ dateKey: string; dateLabel: string; shifts: PreviewShift[] }> = [];
    const dateMap = new Map<string, PreviewShift[]>();

    for (const shift of shifts) {
      const key = formatDateKey(shift.startTime);
      const existing = dateMap.get(key);
      if (existing) {
        existing.push(shift);
      } else {
        dateMap.set(key, [shift]);
      }
    }

    const sortedKeys = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b));
    for (const key of sortedKeys) {
      const dateShifts = dateMap.get(key) ?? [];
      groups.push({
        dateKey: key,
        dateLabel: formatDate(dateShifts[0].startTime),
        shifts: dateShifts,
      });
    }

    return groups;
  }, [shifts]);

  if (!shifts.length) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-[13px] text-muted-foreground">No shifts to preview.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryCard
          label="Ready"
          count={summary.readyCount}
          icon={CheckCircle2}
          colorClass="bg-emerald-500/10 text-emerald-600"
        />
        <SummaryCard
          label="Duplicates"
          count={summary.duplicateCount}
          icon={AlertTriangle}
          colorClass="bg-amber-500/10 text-amber-600"
        />
        <SummaryCard
          label="Published"
          count={summary.publishedCount}
          icon={ShieldAlert}
          colorClass="bg-destructive/10 text-destructive"
        />
        <SummaryCard
          label="Skipped"
          count={summary.skippedCount}
          icon={MinusCircle}
          colorClass="bg-muted text-muted-foreground"
        />
      </div>

      <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span>{summary.totalShifts} total shifts</span>
        </div>
        <span>&middot;</span>
        <span>{summary.totalHours} total hours</span>
      </div>

      <div className="rounded-xl border border-border/40 overflow-hidden">
        {groupedByDate.map((group) => (
          <div key={group.dateKey}>
            <div className="px-4 py-2.5 border-b border-border/40 bg-muted/50">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                {group.dateLabel}
              </p>
            </div>
            <div className="divide-y divide-border/40">
              {group.shifts.map((shift, idx) => (
                <div
                  key={`${shift.employeeName}-${shift.startTime}-${idx}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">
                      {employeeNameMap[shift.employeeName] || shift.employeeName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[13px] text-muted-foreground">
                        {formatTime(shift.startTime)} &ndash; {formatTime(shift.endTime)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        ({hoursBetween(shift.startTime, shift.endTime)}h)
                      </span>
                      {shift.position && (
                        <>
                          <span className="text-muted-foreground">&middot;</span>
                          <span className="text-[12px] text-muted-foreground">{shift.position}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {statusBadge(shift.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
