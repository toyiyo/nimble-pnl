import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CalendarX, Loader2 } from 'lucide-react';
import type { CoverageImpactShift } from '@/hooks/useShiftProtection';
import { DEFAULT_TRADE_NOTE, shiftCount, type TimeOffShiftAction } from '@/hooks/useTimeOffShiftAction';
import type { TimeOffRequest } from '@/types/scheduling';
import { cn } from '@/lib/utils';

interface TimeOffShiftsDialogProps {
  request: TimeOffRequest;
  shifts: CoverageImpactShift[];
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (action: TimeOffShiftAction) => void;
}

function formatDateRange(start: string, end: string) {
  const from = format(parseISO(start), 'MMM d');
  return start === end ? from : `${from} – ${format(parseISO(end), 'MMM d')}`;
}

export function TimeOffShiftsDialog({
  request,
  shifts,
  submitting,
  onCancel,
  onConfirm,
}: Readonly<TimeOffShiftsDialogProps>) {
  const [kind, setKind] = useState<TimeOffShiftAction['kind']>('trade');
  const [note, setNote] = useState(DEFAULT_TRADE_NOTE);

  const name = request.employee?.name ?? 'This employee';
  const count = shifts.length;
  const isDelete = kind === 'delete';
  const description = [
    name,
    formatDateRange(request.start_date, request.end_date),
    request.reason,
  ]
    .filter(Boolean)
    .join(' · ');
  const submitLabel = `Approve and ${isDelete ? 'delete' : 'post'} ${shiftCount(count)}`;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    onConfirm(isDelete ? { kind: 'delete' } : { kind: 'trade', note });
  }

  return (
    // The parent mounts this dialog only while a request is chosen, so open is always true.
    <Dialog
      open
      onOpenChange={(open) => {
        // Esc and the overlay click must not close the dialog mid-flow.
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarX className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Approve time off</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="px-6 py-5 space-y-5 overflow-y-auto">
            <output className="block p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px] text-foreground">
              {name} is scheduled for {shiftCount(count)} in these dates.
            </output>

            <ul
              data-testid="timeoff-shift-list"
              className="max-h-48 overflow-y-auto rounded-xl border border-border/40 bg-muted/30 divide-y divide-border/40"
            >
              {shifts.map((shift) => (
                <li
                  key={shift.shift_id}
                  data-testid="timeoff-shift-row"
                  className="flex items-center justify-between px-4 py-2.5 text-[14px]"
                >
                  <span className="font-medium text-foreground">
                    {format(parseISO(shift.shift_date), 'EEE MMM d')}
                    <span className="text-muted-foreground font-normal"> · {shift.position}</span>
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {format(new Date(shift.start_time), 'h:mm a')} – {format(new Date(shift.end_time), 'h:mm a')}
                  </span>
                </li>
              ))}
            </ul>

            <RadioGroup
              value={kind}
              onValueChange={(value) => setKind(value as TimeOffShiftAction['kind'])}
              disabled={submitting}
              className="space-y-3"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="trade" id="timeoff-shift-trade" className="mt-0.5" autoFocus />
                <div>
                  <Label htmlFor="timeoff-shift-trade" className="text-[14px] font-medium text-foreground">
                    Post for trade
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    Coworkers can pick up the shifts. {name} keeps each shift until a manager approves the trade.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="delete" id="timeoff-shift-delete" className="mt-0.5" />
                <div>
                  <Label htmlFor="timeoff-shift-delete" className="text-[14px] font-medium text-foreground">
                    Delete the shifts
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    The shifts leave the schedule. A delete also cancels any open trade on these shifts.
                  </p>
                </div>
              </div>
            </RadioGroup>

            {!isDelete && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="timeoff-trade-note"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Trade note
                </Label>
                <Input
                  id="timeoff-trade-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  disabled={submitting}
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className={cn(
                'h-9 px-4 rounded-lg text-[13px] font-medium',
                isDelete
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-foreground text-background hover:bg-foreground/90'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
                  Approving…
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
