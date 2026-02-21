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
    const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
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
      <DialogContent className="sm:max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Enter today's tips</DialogTitle>
              <DialogDescription className="text-[13px] mt-0.5">
                Enter the total amount of tips collected today.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-4">
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
        <div className="px-6 pb-6">
          <Button
            onClick={handleContinue}
            className="w-full h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            disabled={!amount || !(Number.parseFloat(amount) > 0)}
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
