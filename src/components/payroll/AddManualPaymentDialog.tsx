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
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { DollarSign, Calendar, FileText, Loader2 } from 'lucide-react';

interface AddManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
  onSubmit: (data: {
    employeeId: string;
    date: string;
    amount: number;
    description?: string;
  }) => void;
  isSubmitting?: boolean;
}

export function AddManualPaymentDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
  onSubmit,
  isSubmitting = false,
}: Readonly<AddManualPaymentDialogProps>) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: { amount?: string; date?: string } = {};
    
    // Validate amount
    const amountValue = Number.parseFloat(amount);
    if (!amount || Number.isNaN(amountValue) || amountValue <= 0) {
      newErrors.amount = 'Please enter a valid amount greater than 0';
    }
    
    // Validate date
    if (!date) {
      newErrors.date = 'Please select a date';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    // Convert dollars to cents
    const amountInCents = Math.round(amountValue * 100);
    
    onSubmit({
      employeeId,
      date,
      amount: amountInCents,
      description: description || undefined,
    });
    
    // Reset form
    setAmount('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setDescription('');
    setErrors({});
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setAmount('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setDescription('');
      setErrors({});
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
          <DialogDescription>
            Add a manual payment for <span className="font-medium">{employeeName}</span>
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-amount" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Payment Amount
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="payment-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                className="pl-7"
                aria-describedby={errors.amount ? 'amount-error' : undefined}
                aria-invalid={!!errors.amount}
              />
            </div>
            {errors.amount && (
              <p id="amount-error" className="text-sm text-destructive">
                {errors.amount}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Payment Date
            </Label>
            <Input
              id="payment-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setErrors((prev) => ({ ...prev, date: undefined }));
              }}
              aria-describedby={errors.date ? 'date-error' : undefined}
              aria-invalid={!!errors.date}
            />
            {errors.date && (
              <p id="date-error" className="text-sm text-destructive">
                {errors.date}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-description" className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Description (Optional)
            </Label>
            <Textarea
              id="payment-description"
              placeholder="e.g., Catering event, Special project..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Payment'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
