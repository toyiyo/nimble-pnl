import { useState } from 'react';
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
import { DollarSign } from 'lucide-react';
import { formatCurrencyFromCents } from '@/utils/tipPooling';

interface TipSubmissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (cashTips: number, creditTips: number) => void | Promise<void>;
  isSubmitting: boolean;
  employeeName?: string;
}

/**
 * TipSubmissionDialog - Reusable dialog for employees to submit tips
 * Used in KioskMode after clock-out and in employee self-service
 * 
 * Follows DRY principle - single component for all tip submission flows
 */
export const TipSubmissionDialog = ({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  employeeName,
}: TipSubmissionDialogProps) => {
  const [cashTips, setCashTips] = useState('');
  const [creditTips, setCreditTips] = useState('');

  const cashCents = Math.round((Number.parseFloat(cashTips) || 0) * 100);
  const creditCents = Math.round((Number.parseFloat(creditTips) || 0) * 100);
  const totalCents = cashCents + creditCents;

  const handleReset = () => {
    setCashTips('');
    setCreditTips('');
  };

  const handleSkip = () => {
    handleReset();
    onOpenChange(false);
  };

  const handleSubmitClick = () => {
    if (totalCents <= 0) {
      handleSkip();
      return;
    }
    onSubmit(cashCents, creditCents);
    // Reset is handled by parent closing the dialog on success
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <DialogTitle>Enter Your Tips</DialogTitle>
          </div>
          <DialogDescription>
            {employeeName ? `${employeeName}, h` : 'H'}ow much did you earn in tips today?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Cash Tips */}
          <div className="space-y-2">
            <Label htmlFor="cash-tips">Cash Tips</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="cash-tips"
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter cash tips"
                aria-label="Cash tips amount"
                className="pl-6"
                value={cashTips}
                onChange={(e) => setCashTips(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Credit Card Tips */}
          <div className="space-y-2">
            <Label htmlFor="credit-tips">Credit Card Tips</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="credit-tips"
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter credit tips"
                aria-label="Credit card tips amount"
                className="pl-6"
                value={creditTips}
                onChange={(e) => setCreditTips(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Total Display */}
          {totalCents > 0 && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Tips</span>
                <span className="text-lg font-bold text-primary">
                  {formatCurrencyFromCents(totalCents)}
                </span>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Optional - Your manager will review and include in tip pool
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isSubmitting}
            className="flex-1 sm:flex-none"
          >
            Skip
          </Button>
          <Button
            onClick={handleSubmitClick}
            disabled={isSubmitting || totalCents <= 0}
            className="flex-1 sm:flex-none"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Tips'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
