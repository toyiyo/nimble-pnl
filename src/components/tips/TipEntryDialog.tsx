import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DollarSign } from 'lucide-react';

interface TipEntryDialogProps {
  onContinue: (amountCents: number) => void;
  defaultAmount?: number;
  trigger?: React.ReactNode;
}

/**
 * TipEntryDialog - Focused single-input for tip amount
 * Part 2 of Apple-style UX: "Enter today's tips"
 */
export function TipEntryDialog({ onContinue, defaultAmount, trigger }: TipEntryDialogProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount ? (defaultAmount / 100).toFixed(2) : '');

  const handleContinue = () => {
    const amountCents = Math.round(parseFloat(amount || '0') * 100);
    if (amountCents > 0) {
      onContinue(amountCents);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="lg" className="w-full">
            <DollarSign className="h-5 w-5 mr-2" />
            Enter today's tips
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Enter today's tips</DialogTitle>
          <DialogDescription>
            Enter the total amount of tips collected today.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="tip-amount" className="sr-only">
              Tip amount
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 transform -translate-y-1/2 h-6 w-6 text-muted-foreground" />
              <Input
                id="tip-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleContinue();
                  }
                }}
                className="text-4xl text-center pl-12 h-20"
                autoFocus
              />
            </div>
          </div>
        </div>
        <Button 
          onClick={handleContinue} 
          size="lg" 
          className="w-full"
          disabled={!amount || parseFloat(amount) <= 0}
        >
          Continue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
