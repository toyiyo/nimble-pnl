import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { Hand, Calendar, Clock, MapPin } from 'lucide-react';

import type { OpenShift } from '@/types/scheduling';

import { format, parseISO } from 'date-fns';

interface ClaimConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openShift: OpenShift | null;
  onConfirm: () => void;
  isPending: boolean;
}

function formatCompactTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function ClaimConfirmDialog({
  open,
  onOpenChange,
  openShift,
  onConfirm,
  isPending,
}: Readonly<ClaimConfirmDialogProps>) {
  if (!openShift) return null;

  const dateLabel = format(parseISO(openShift.shift_date), 'EEEE, MMMM d');
  const timeLabel = `${formatCompactTime(openShift.start_time)} - ${formatCompactTime(openShift.end_time)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Hand className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Claim Shift
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Confirm you want to pick up this shift
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-3">
            <div className="text-[14px] font-medium text-foreground">
              {openShift.template_name}
            </div>
            <div className="space-y-2 text-[13px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                {dateLabel}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {timeLabel}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {openShift.position}
                {openShift.area ? ` / ${openShift.area}` : ''}
              </div>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground">
            You'll be added to this shift. Your manager may need to approve the claim first.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-5">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isPending ? 'Claiming...' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
