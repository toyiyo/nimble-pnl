import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetReconciliationBoundary, useReconciliationBoundary } from "@/hooks/useBankReconciliation";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReconciliationDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReconciliationDialog({ isOpen, onClose }: ReconciliationDialogProps) {
  const [date, setDate] = useState<Date>();
  const [openingBalance, setOpeningBalance] = useState("");
  
  const { data: boundary } = useReconciliationBoundary();
  const setBoundary = useSetReconciliationBoundary();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;

    await setBoundary.mutateAsync({
      date: format(date, 'yyyy-MM-dd'),
      openingBalance: parseFloat(openingBalance),
    });

    onClose();
    setDate(undefined);
    setOpeningBalance("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Bank Reconciliation</DialogTitle>
          <DialogDescription>
            Set your opening balance and starting date for reconciliation
          </DialogDescription>
        </DialogHeader>

        {boundary && (
          <div className="bg-muted p-4 rounded-lg mb-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="font-medium">Current Boundary</span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              <div>Date: {format(new Date(boundary.balance_start_date), 'MMM dd, yyyy')}</div>
              <div>Opening Balance: ${boundary.opening_balance.toFixed(2)}</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="date">Starting Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="balance">Opening Balance ($)</Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!date || !openingBalance}>
              Set Boundary
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
