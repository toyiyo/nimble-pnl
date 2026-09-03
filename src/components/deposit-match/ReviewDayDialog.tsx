import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSetDepositMatchResolution } from '@/hooks/useDepositMatch';
import { formatCurrency } from '@/lib/utils';
import { formatBusinessDate } from '@/lib/depositMatchUi';
import type { DepositMatchLedgerRow } from '@/types/depositMatch';
import { StatusChip } from './StatusChip';

interface ReviewDayDialogProps {
  item: DepositMatchLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string | null | undefined;
  onDispute: (item: DepositMatchLedgerRow) => void;
}

/**
 * The one instance of the review dialog, driven by `activeItem` at the
 * page level (CLAUDE.md Single Dialog Pattern). Offers Accept / Dispute on
 * the selected day; Accept writes `resolution = 'accepted'`, Dispute hands
 * off to `DisputeDialog`.
 */
export function ReviewDayDialog({ item, open, onOpenChange, restaurantId, onDispute }: ReviewDayDialogProps) {
  const resolutionMutation = useSetDepositMatchResolution(restaurantId);

  const handleAccept = () => {
    if (!item) return;
    resolutionMutation.mutate(
      { item_id: item.item_id, resolution: 'accepted' },
      {
        onSuccess: () => {
          toast.success('You accepted this day.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(`The accept did not save: ${error.message}`);
        },
      }
    );
  };

  const gap = item ? item.expected_amount - item.received_amount - item.fee_amount : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Review day</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {item ? `${item.business_date} · ${item.pos_source}` : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {item && (
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <StatusChip status={item.status} />
              <p className="text-[14px] font-medium text-foreground">
                {gap > 0.005 ? `Short ${formatMoney(gap)}` : gap < -0.005 ? `Over ${formatMoney(-gap)}` : 'No gap'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-[13px]">
              <div>
                <p className="text-muted-foreground">Expected</p>
                <p className="text-foreground font-medium">{formatMoney(item.expected_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Received</p>
                <p className="text-foreground font-medium">{formatMoney(item.received_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fees</p>
                <p className="text-foreground font-medium">{formatMoney(item.fee_amount)}</p>
              </div>
            </div>
            {item.resolution && (
              <p className="text-[12px] text-muted-foreground">
                Already marked {item.resolution}
                {item.resolution_note ? `: ${item.resolution_note}` : '.'}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="px-6 pb-6">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => item && onDispute(item)}
          >
            Dispute
          </Button>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={handleAccept}
            disabled={resolutionMutation.isPending}
          >
            {resolutionMutation.isPending ? 'Saving…' : 'Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
