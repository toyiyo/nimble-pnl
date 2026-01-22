import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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

export const LockPeriodDialog = ({
  open,
  periodLabel,
  onConfirm,
  onCancel,
  loading,
}: LockPeriodDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            Lock tips for {periodLabel}?
          </DialogTitle>
        </DialogHeader>
        <Alert className="mb-4">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription>
            Locking ensures payroll numbers won’t change. Tips for this period will become immutable and a payroll snapshot will be created.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading} aria-label="Cancel lock">Cancel</Button>
          <Button variant="default" onClick={onConfirm} disabled={loading} aria-label="Confirm lock">
            Lock Period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LockPeriodDialog;
