import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { AlarmClockPlus } from 'lucide-react';

import { useBulkCreateTimePunches } from '@/hooks/useTimePunches';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { useToast } from '@/hooks/use-toast';

import type { AuditRow } from '@/utils/scheduleClockAudit';
import type { TimePunchInsert } from '@/utils/timePunchImport';

interface RecordShiftClockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: AuditRow;
  employeeName: string;
  restaurantId: string;
}

const MINUTE_MS = 60_000;

/**
 * Parse a wall-clock input string to epoch milliseconds.
 * Returns `null` when the parsed value is not a finite timestamp.
 */
function parseWallClockMs(
  wallClockInput: string,
  parseWallClock: (wallClock: string) => string,
): number | null {
  const ms = new Date(parseWallClock(wallClockInput)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Enter clock data for a scheduled shift.
 *
 * Two cases share this dialog:
 * - `missing_clock`: create the clock_in and clock_out pair.
 * - `open_clock`: create only the clock_out.
 * The scheduled times pre-fill the inputs. The manager can change them.
 */
export function RecordShiftClockDialog({
  open,
  onOpenChange,
  row,
  employeeName,
  restaurantId,
}: Readonly<RecordShiftClockDialogProps>) {
  const shift = row.shift;
  const outOnly = row.status === 'open_clock';

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tzAbbrev, viewerTzDiffers, formatInstant, toWallClockInput, parseWallClock } =
    useRestaurantClock();
  const bulkCreate = useBulkCreateTimePunches();

  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [includeBreak, setIncludeBreak] = useState(true);
  const [note, setNote] = useState('Manager entry from the scheduled shift');

  const breakMinutes = shift?.break_duration ?? 0;

  useEffect(() => {
    if (!open || !shift) return;
    setClockIn(toWallClockInput(shift.start_time));
    setClockOut(toWallClockInput(shift.end_time));
    setIncludeBreak(true);
    setNote('Manager entry from the scheduled shift');
  }, [open, shift, toWallClockInput]);

  const validationError = useMemo(() => {
    if (outOnly) {
      if (!clockOut) return 'Enter the clock-out time.';
      // `row.session.clockIn` is the real punch already on record, not the
      // scheduled start time. The clock-out must land after it, or the
      // saved punch pair goes clock_out-before-clock_in and corrupts
      // payroll's chronological pairing.
      const realClockInMs = row.session ? new Date(row.session.clockIn).getTime() : null;
      const outMs = parseWallClockMs(clockOut, parseWallClock);
      if (outMs === null) return 'Enter a valid clock-out time.';
      if (realClockInMs !== null && outMs <= realClockInMs) {
        return 'The clock-out time must be after the actual clock-in time.';
      }
      return null;
    }
    if (!clockIn || !clockOut) return 'Enter the clock-in and the clock-out times.';
    const inMs = parseWallClockMs(clockIn, parseWallClock);
    const outMs = parseWallClockMs(clockOut, parseWallClock);
    if (inMs === null || outMs === null) {
      return 'Enter valid clock-in and clock-out times.';
    }
    if (outMs <= inMs) return 'The clock-out time must be after the clock-in time.';
    if (includeBreak && breakMinutes > 0 && outMs - inMs <= breakMinutes * MINUTE_MS) {
      return 'The shift is too short for the scheduled break.';
    }
    return null;
  }, [outOnly, clockIn, clockOut, includeBreak, breakMinutes, parseWallClock, row.session]);

  if (!shift) return null;

  const handleSave = () => {
    if (validationError) return;

    const base = {
      restaurant_id: restaurantId,
      employee_id: shift.employee_id,
      shift_id: shift.id,
      notes: note.trim() || null,
      device_info: 'manager-entry',
    };

    const punches: TimePunchInsert[] = [];
    if (!outOnly) {
      punches.push({ ...base, punch_type: 'clock_in', punch_time: parseWallClock(clockIn) });
    }
    if (!outOnly && includeBreak && breakMinutes > 0) {
      const inMs = new Date(parseWallClock(clockIn)).getTime();
      const outMs = new Date(parseWallClock(clockOut)).getTime();
      const midMs = (inMs + outMs) / 2;
      const breakStart = new Date(midMs - (breakMinutes / 2) * MINUTE_MS);
      const breakEnd = new Date(midMs + (breakMinutes / 2) * MINUTE_MS);
      punches.push(
        { ...base, punch_type: 'break_start', punch_time: breakStart.toISOString() },
        { ...base, punch_type: 'break_end', punch_time: breakEnd.toISOString() },
      );
    }
    punches.push({ ...base, punch_type: 'clock_out', punch_time: parseWallClock(clockOut) });

    bulkCreate.mutate(
      { restaurantId, punches },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['payroll', restaurantId] });
          toast({
            title: 'Clock data saved',
            description: `${punches.length} punch(es) created for ${employeeName}.`,
          });
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast({
            title: 'Error saving clock data',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const shiftDay = formatInstant(shift.start_time, 'EEE, MMM d');
  const scheduledRange = `${formatInstant(shift.start_time, 'h:mm a')} – ${formatInstant(
    shift.end_time,
    'h:mm a',
  )}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <AlarmClockPlus className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {outOnly ? 'Enter the clock-out' : 'Enter clock data'}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {employeeName} · {shiftDay} · scheduled {scheduledRange}
                {viewerTzDiffers ? ` (${tzAbbrev})` : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <p className="text-[13px] text-muted-foreground rounded-lg bg-warning/10 border border-warning/20 px-3 py-2.5">
            Payroll pays from these times. Confirm the times with the employee first.
          </p>

          {!outOnly && (
            <div className="space-y-1.5">
              <Label
                htmlFor="record-clock-in"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Clock in{viewerTzDiffers ? ` (${tzAbbrev})` : ''}
              </Label>
              <Input
                id="record-clock-in"
                type="datetime-local"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
          )}

          {outOnly && row.session && (
            <p className="text-[13px] text-muted-foreground">
              Actual clock-in on record:{' '}
              <span className="text-foreground font-medium">
                {formatInstant(row.session.clockIn, 'h:mm a')}
              </span>
              {viewerTzDiffers ? ` (${tzAbbrev})` : ''}
            </p>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="record-clock-out"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Clock out{viewerTzDiffers ? ` (${tzAbbrev})` : ''}
            </Label>
            <Input
              id="record-clock-out"
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {!outOnly && breakMinutes > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
              <div>
                <Label
                  htmlFor="record-include-break"
                  className="text-[14px] font-medium text-foreground"
                >
                  Record the scheduled break
                </Label>
                <p className="text-[13px] text-muted-foreground">
                  {breakMinutes} min, unpaid, in the middle of the shift
                </p>
              </div>
              <Switch
                id="record-include-break"
                checked={includeBreak}
                onCheckedChange={setIncludeBreak}
                className="data-[state=checked]:bg-foreground"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="record-clock-note"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Note
            </Label>
            <Input
              id="record-clock-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {validationError && (
            <p className="text-[13px] text-destructive" role="alert">
              {validationError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!!validationError || bulkCreate.isPending}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {bulkCreate.isPending ? 'Saving…' : 'Save clock data'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
