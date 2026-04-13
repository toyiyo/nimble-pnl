import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { Volume2, AlertTriangle } from 'lucide-react';

import { useBroadcastOpenShifts } from '@/hooks/useBroadcastOpenShifts';

import { format } from 'date-fns';

interface BroadcastOpenShiftsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  publicationId: string;
  weekStart: Date;
  weekEnd: Date;
  openShiftCount: number;
  alreadyBroadcast: boolean;
  broadcastDate?: string | null;
}

export function BroadcastOpenShiftsDialog({
  open,
  onOpenChange,
  restaurantId,
  publicationId,
  weekStart,
  weekEnd,
  openShiftCount,
  alreadyBroadcast,
  broadcastDate,
}: Readonly<BroadcastOpenShiftsDialogProps>) {
  const broadcastMutation = useBroadcastOpenShifts();
  const isPending = broadcastMutation.isPending;

  async function handleBroadcast() {
    await broadcastMutation.mutateAsync({ restaurantId, publicationId });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Volume2 className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Broadcast Open Shifts
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Notify your team about available shifts
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg bg-muted/30 p-4 space-y-2">
            <div className="text-[14px] font-medium text-foreground">
              {openShiftCount} open {openShiftCount === 1 ? 'shift' : 'shifts'} for{' '}
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d')}
            </div>
            <p className="text-[13px] text-muted-foreground">
              All active team members will receive a push notification and email.
            </p>
          </div>

          {alreadyBroadcast && broadcastDate && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm">
                Already broadcast on {format(new Date(broadcastDate), 'MMM d')}. Sending again
                will re-notify your team.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 pb-5">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleBroadcast}
            disabled={isPending}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isPending ? 'Broadcasting...' : 'Broadcast to Team'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
