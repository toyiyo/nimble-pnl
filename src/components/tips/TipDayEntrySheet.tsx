import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { format } from 'date-fns';

export interface TipDayEntrySheetProps {
  open: boolean;
  date: Date;
  initialAmount?: number;
  initialBreakdown?: { cash?: number; card?: number };
  loading?: boolean;
  onSave: (amount: number, breakdown?: { cash?: number; card?: number }) => void;
  onClose: () => void;
}

export const TipDayEntrySheet = ({
  open,
  date,
  initialAmount = 0,
  initialBreakdown,
  loading,
  onSave,
  onClose,
}: TipDayEntrySheetProps) => {
  const [amount, setAmount] = useState(initialAmount);
  const [cash, setCash] = useState(initialBreakdown?.cash ?? 0);
  const [card, setCard] = useState(initialBreakdown?.card ?? 0);

  useEffect(() => {
    setAmount(initialAmount);
    setCash(initialBreakdown?.cash ?? 0);
    setCard(initialBreakdown?.card ?? 0);
  }, [initialAmount, initialBreakdown, date]);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="max-w-md w-full">
        <SheetHeader>
          <SheetTitle>Enter Tips for {format(date, 'EEE, MMM d')}</SheetTitle>
        </SheetHeader>
        <Card className="mt-4">
          <CardContent className="space-y-4">
            <label htmlFor="tip-amount" className="font-medium">Total Tip Amount</label>
            <Input
              id="tip-amount"
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              aria-label="Total tip amount"
            />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label htmlFor="tip-cash" className="text-sm">Cash</label>
                <Input
                  id="tip-cash"
                  type="number"
                  min={0}
                  step={0.01}
                  value={cash}
                  onChange={e => setCash(Number(e.target.value))}
                  aria-label="Cash tips"
                />
              </div>
              <div>
                <label htmlFor="tip-card" className="text-sm">Card</label>
                <Input
                  id="tip-card"
                  type="number"
                  min={0}
                  step={0.01}
                  value={card}
                  onChange={e => setCard(Number(e.target.value))}
                  aria-label="Card tips"
                />
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              onClick={() => onSave(amount, { cash, card })}
              disabled={loading}
              aria-label="Save tips for day"
            >
              Save
            </Button>
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                Tip entry is saved instantly and updates the period overview.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </SheetContent>
    </Sheet>
  );
};

export default TipDayEntrySheet;
