import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSetDepositMatchResolution } from '@/hooks/useDepositMatch';
import { formatCurrency } from '@/lib/utils';
import { causeLabel, formatBusinessDate } from '@/lib/depositMatchUi';
import type { DepositMatchLedgerRow, DepositMatchReport } from '@/types/depositMatch';

interface DisputeDialogProps {
  item: DepositMatchLedgerRow | null;
  report: DepositMatchReport | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string | null | undefined;
}

function buildEmailText(item: DepositMatchLedgerRow, neighbors: DepositMatchLedgerRow[]): string {
  const lines = [
    `Deposit dispute — ${item.pos_source}, business date ${formatBusinessDate(item.business_date)}`,
    `Expected: ${formatCurrency(item.expected_amount)}`,
    `Received: ${formatCurrency(item.received_amount)}`,
    `Fees: ${formatCurrency(item.fee_amount)}`,
    `Probable cause: ${causeLabel(item)}`,
  ];
  if (neighbors.length > 0) {
    lines.push('', 'Neighboring days:');
    for (const neighbor of neighbors) {
      lines.push(
        `  ${formatBusinessDate(neighbor.business_date)}: expected ${formatCurrency(
          neighbor.expected_amount
        )}, received ${formatCurrency(
          neighbor.received_amount
        )} (${neighbor.status})`
      );
    }
  }
  return lines.join('\n');
}

/**
 * The one instance of the dispute dialog, driven by `activeItem` at the
 * page level. Shows the item's own numbers as evidence, the neighboring
 * days from the same stream as proof of the normal pattern, and a
 * "Copy as email" action. Per the design's cause-attribution rule, the
 * probable cause is labeled only with POS evidence the engine confirmed —
 * today that is never, so it always reads "unknown".
 */
export function DisputeDialog({ item, report, open, onOpenChange, restaurantId }: DisputeDialogProps) {
  const [note, setNote] = useState('');
  const resolutionMutation = useSetDepositMatchResolution(restaurantId);

  const neighbors = useMemo(() => {
    if (!item || !report) return [];
    return report.ledger
      .filter((row) => row.rule_id === item.rule_id && row.item_id !== item.item_id)
      .sort(
        (a, b) =>
          Math.abs(new Date(a.business_date).getTime() - new Date(item.business_date).getTime()) -
          Math.abs(new Date(b.business_date).getTime() - new Date(item.business_date).getTime())
      )
      .slice(0, 2);
  }, [item, report]);

  if (!item) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg" />
      </Dialog>
    );
  }

  const handleCopyEmail = async () => {
    const text = buildEmailText(item, neighbors);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Email text copied.');
    } catch {
      toast.error('The copy did not work. Select and copy the text yourself.');
    }
  };

  const handleSubmit = () => {
    resolutionMutation.mutate(
      { item_id: item.item_id, resolution: 'disputed', resolution_note: note || null },
      {
        onSuccess: () => {
          toast.success('You marked this day disputed.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(`The dispute did not save: ${error.message}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <FileText className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Prepare dispute</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {formatBusinessDate(item.business_date)} · {item.pos_source}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-5">
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Evidence</h3>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Expected</p>
                <p className="text-foreground font-medium">{formatCurrency(item.expected_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Received</p>
                <p className="text-foreground font-medium">{formatCurrency(item.received_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fees</p>
                <p className="text-foreground font-medium">{formatCurrency(item.fee_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Probable cause</p>
                <p className="text-foreground font-medium capitalize">{causeLabel(item)}</p>
              </div>
            </div>
          </div>

          {neighbors.length > 0 && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Neighboring days</h3>
              </div>
              <div className="p-4 space-y-2">
                {neighbors.map((neighbor) => (
                  <div key={neighbor.item_id} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{formatBusinessDate(neighbor.business_date)}</span>
                    <span className="text-foreground">
                      {formatCurrency(neighbor.received_amount)} of {formatCurrency(neighbor.expected_amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="deposit_match_dispute_note" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Note (optional)
            </Label>
            <Textarea
              id="deposit_match_dispute_note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="text-[14px] bg-muted/30 border-border/40 rounded-lg"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="px-6 pb-6">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={handleCopyEmail}
          >
            Copy as email
          </Button>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={handleSubmit}
            disabled={resolutionMutation.isPending}
          >
            {resolutionMutation.isPending ? 'Saving…' : 'Mark disputed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
