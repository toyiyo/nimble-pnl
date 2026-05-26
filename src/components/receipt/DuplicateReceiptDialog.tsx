import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ReceiptImport } from '@/hooks/useReceiptImport';

interface DuplicateReceiptDialogProps {
  open: boolean;
  existing: ReceiptImport;
  onCancel: () => void;
  onProceed: () => void;
}

export function DuplicateReceiptDialog({
  open,
  existing,
  onCancel,
  onProceed,
}: DuplicateReceiptDialogProps) {
  const vendor = existing.vendor_name ?? 'Unknown vendor';
  const totalDisplay =
    existing.total_amount != null
      ? `$${existing.total_amount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';
  const createdDisplay = (() => {
    try {
      return format(new Date(existing.created_at), 'MMM d, yyyy');
    } catch {
      return 'an earlier date';
    }
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Possible duplicate receipt
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                This file matches a receipt you already uploaded on {createdDisplay}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="text-[14px] font-medium text-foreground">
            {vendor} — {totalDisplay}
          </div>
          <Link
            to={`/receipt-import?receipt=${existing.id}`}
            onClick={onCancel}
            className="text-[13px] text-foreground underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            View previous receipt
          </Link>
        </div>

        <div className="flex flex-row justify-end gap-2 px-6 pb-5 pt-2">
          <Button
            onClick={onCancel}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            onClick={onProceed}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Upload anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
