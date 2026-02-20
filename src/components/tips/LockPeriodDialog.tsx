import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Lock } from 'lucide-react';

export interface LockPeriodDialogProps {
  open: boolean;
  periodLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function LockPeriodDialog({
  open,
  periodLabel,
  onConfirm,
  onCancel,
  loading,
}: LockPeriodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-md w-full p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Lock className="h-5 w-5 text-foreground" />
            </div>
            <DialogTitle className="text-[17px] font-semibold text-foreground">Lock tips for {periodLabel}?</DialogTitle>
          </div>
        </DialogHeader>
        <div className="px-6 py-5">
          <Alert>
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-[13px]">
              Locking ensures payroll numbers won’t change. Tips for this period will become immutable and a payroll snapshot will be created.
            </AlertDescription>
          </Alert>
        </div>
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onCancel} disabled={loading} aria-label="Cancel lock" className="h-9 rounded-lg text-[13px] font-medium">Cancel</Button>
          <Button onClick={onConfirm} disabled={loading} aria-label="Confirm lock" className="h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium">
            Lock Period
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
