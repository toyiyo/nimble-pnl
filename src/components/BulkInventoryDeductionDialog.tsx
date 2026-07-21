import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { DatePicker } from '@/components/ui/date-picker';
import { useBulkInventoryDeduction } from '@/hooks/useBulkInventoryDeduction';
import type { BulkProgress } from '@/hooks/useBulkInventoryDeduction';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Alert, AlertDescription } from '@/components/ui/alert';

type RunOutcome = 'idle' | 'done' | 'error';

export const BulkInventoryDeductionDialog = () => {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome>('idle');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { bulkProcessHistoricalSales, loading } = useBulkInventoryDeduction();
  const { selectedRestaurant } = useRestaurantContext();

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Cancel any pending auto-close timer if the component unmounts.
  useEffect(() => clearCloseTimer, []);

  const handleProcess = async () => {
    if (!selectedRestaurant?.restaurant_id || !startDate || !endDate) return;

    // A new run cancels any auto-close still pending from a previous run, so a
    // stale 2s timer can never close the dialog out from under this one.
    clearCloseTimer();
    setOutcome('idle');

    const result = await bulkProcessHistoricalSales(
      selectedRestaurant.restaurant_id,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd'),
      setProgress
    );

    setOutcome(result ? 'done' : 'error');
    if (result) {
      // Auto-close only on success; a re-entrant handleProcess clears this first.
      closeTimerRef.current = setTimeout(() => setOpen(false), 2000);
    }
  };

  // Gate closing mid-run so a background batch loop can't fire a toast onto
  // a dialog the user thinks they cancelled; reset progress + outcome on every
  // open/close transition so a stale run's totals never leak into the next.
  const handleOpenChange = (next: boolean) => {
    if (loading) return;
    clearCloseTimer();
    setOpen(next);
    setProgress(null);
    setOutcome('idle');
  };

  const isValid = startDate && endDate && startDate <= endDate;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" />
          <span className="hidden sm:inline">Bulk Process Sales</span>
          <span className="sm:hidden">Bulk Process</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Bulk Process Historical Sales</DialogTitle>
          <DialogDescription>
            Process inventory deductions for historical sales after creating recipes. Only unprocessed sales with matching recipes will be processed.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            This will only process sales that haven't been processed yet. Already processed sales will be skipped automatically.
            {progress && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 text-[13px] text-muted-foreground"
              >
                {loading
                  ? `Processed ${progress.processed} sales so far (${progress.skipped} skipped, ${progress.errors} errors)…`
                  : outcome === 'error'
                    ? `Interrupted after processing ${progress.processed} sales (${progress.skipped} skipped, ${progress.errors} errors). Safe to re-run — already-processed sales are skipped.`
                    : `Done: processed ${progress.processed} sales, skipped ${progress.skipped}, ${progress.errors} errors.`}
              </div>
            )}
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Start Date</Label>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              aria-label="Select start date"
            />
          </div>

          <div className="grid gap-2">
            <Label>End Date</Label>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              aria-label="Select end date"
              disabled={(date) => (startDate ? date < startDate : false)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button 
            onClick={handleProcess} 
            disabled={!isValid || loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Process Sales
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
