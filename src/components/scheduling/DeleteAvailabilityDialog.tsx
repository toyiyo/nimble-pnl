import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { AlertTriangle, Calendar, CalendarX2 } from 'lucide-react';

import { useDeleteAvailability, useDeleteAvailabilityException } from '@/hooks/useAvailability';
import { describeAvailabilityDeletion } from '@/lib/scheduling/deletionCopy';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';
import { formatHourToTime } from '@/lib/timeUtils';
import { parseDateOnly, formatDateOnly } from '@/lib/dateOnly';

import type { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * The delete dialogs for the two availability sources (recurring
 * `employee_availability` rows and one-time `availability_exceptions`)
 * share every piece of copy/gating logic — only the "when" reference and
 * which mutation to fire differ. `personName` is supplied by the caller
 * (grid/editor already hold the employee list) since neither row shape
 * carries a display name.
 */
export type AvailabilityDeletionTarget =
  | { kind: 'availability'; row: EmployeeAvailability; personName: string }
  | { kind: 'exception'; row: AvailabilityException; personName: string };

export interface DeleteAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AvailabilityDeletionTarget | null;
  restaurantId: string;
  timezone: string;
}

/** UTC HH:MM(:SS) -> local "9:00 AM", anchored to `referenceDate` for correct DST offset. */
function formatLocalTime(utcTime: string, timezone: string, referenceDate: Date): string {
  const local = utcTimeToLocalTime(utcTime, timezone, referenceDate);
  const [h, m] = local.split(':').map(Number);
  return formatHourToTime(h + m / 60);
}

function timeLabelFor(
  row: { start_time?: string; end_time?: string },
  timezone: string,
  referenceDate: Date,
): string {
  if (!row.start_time || !row.end_time) {
    return 'all day';
  }
  return `${formatLocalTime(row.start_time, timezone, referenceDate)} – ${formatLocalTime(row.end_time, timezone, referenceDate)}`;
}

/**
 * Recurring rows anchor to today (no other date exists for a weekday
 * pattern); exceptions anchor to their own calendar date, matching how
 * AvailabilityDialog/AvailabilityExceptionDialog write & read these times.
 */
function whenLabelFor(target: AvailabilityDeletionTarget): { whenLabel: string; referenceDate: Date } {
  if (target.kind === 'exception') {
    return {
      whenLabel: formatDateOnly(target.row.date, 'MMM d'),
      referenceDate: parseDateOnly(target.row.date),
    };
  }
  return {
    whenLabel: WEEKDAY_LABELS[target.row.day_of_week],
    referenceDate: new Date(),
  };
}

export function DeleteAvailabilityDialog({
  open,
  onOpenChange,
  target,
  restaurantId,
  timezone,
}: DeleteAvailabilityDialogProps) {
  const [ackChecked, setAckChecked] = useState(false);

  const deleteAvailability = useDeleteAvailability();
  const deleteException = useDeleteAvailabilityException();

  // Reset the acknowledgment whenever a different row is opened for delete —
  // a stale "checked" state from a prior guardrail block must never carry
  // over and silently unlock the confirm button.
  useEffect(() => {
    setAckChecked(false);
  }, [target?.kind, target?.row.id, open]);

  if (!target) {
    return null;
  }

  const { row, personName } = target;
  const { whenLabel, referenceDate } = whenLabelFor(target);
  const timeLabel = timeLabelFor(row, timezone, referenceDate);

  const copy = describeAvailabilityDeletion({
    isAvailable: row.is_available,
    personName,
    timeLabel,
    kind: target.kind,
    dayLabel: target.kind === 'availability' ? whenLabel : undefined,
    dateLabel: target.kind === 'exception' ? whenLabel : undefined,
  });

  const isBusy = deleteAvailability.isPending || deleteException.isPending;
  const confirmDisabled = isBusy || (copy.needsAck && !ackChecked);

  const handleConfirm = () => {
    const mutation = target.kind === 'availability' ? deleteAvailability : deleteException;
    mutation.mutate({ id: row.id, restaurantId }, { onSuccess: () => onOpenChange(false) });
  };

  const title = row.is_available ? 'Remove availability?' : 'Delete this block?';
  const confirmLabel = row.is_available ? 'Remove availability' : 'Delete block';
  const busyLabel = row.is_available ? 'Removing…' : 'Deleting…';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                row.is_available ? 'bg-muted/50' : 'bg-amber-500/10'
              }`}
            >
              {row.is_available ? (
                <Calendar className="h-5 w-5 text-foreground" />
              ) : (
                <CalendarX2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-[17px] font-semibold text-foreground">
                  {title}
                </DialogTitle>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                    copy.severity === 'high'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {copy.severity === 'high' ? 'High impact' : 'Low impact'}
                </span>
              </div>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {personName} · {whenLabel} {timeLabel}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {copy.heroText && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-800 dark:text-amber-300">{copy.heroText}</p>
            </div>
          )}

          <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-1.5">
            <h3 className="text-[13px] font-semibold text-foreground">What changes</h3>
            <ul className="space-y-1">
              {copy.changes.map((change) => (
                <li key={change} className="text-[13px] text-muted-foreground">
                  {change}
                </li>
              ))}
            </ul>
          </div>

          {copy.needsAck && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Checkbox
                id="delete-availability-ack"
                checked={ackChecked}
                onCheckedChange={(checked) => setAckChecked(checked === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="delete-availability-ack"
                className="text-[13px] text-amber-800 dark:text-amber-300 font-normal cursor-pointer"
              >
                {copy.ackLabel}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/40 px-6 py-4 gap-2">
          <Button
            variant="ghost"
            disabled={isBusy}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={row.is_available ? 'default' : 'destructive'}
            disabled={confirmDisabled}
            className="h-9 px-4 rounded-lg text-[13px] font-medium"
            onClick={handleConfirm}
          >
            {isBusy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
