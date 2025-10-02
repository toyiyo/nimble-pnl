import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useBulkInventoryDeduction } from '@/hooks/useBulkInventoryDeduction';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const BulkInventoryDeductionDialog = () => {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const { bulkProcessHistoricalSales, loading } = useBulkInventoryDeduction();
  const { selectedRestaurant } = useRestaurantContext();

  const handleProcess = async () => {
    if (!selectedRestaurant?.restaurant_id || !startDate || !endDate) return;

    const result = await bulkProcessHistoricalSales(
      selectedRestaurant.restaurant_id,
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd')
    );

    if (result) {
      // Close dialog after successful processing
      setTimeout(() => setOpen(false), 2000);
    }
  };

  const isValid = startDate && endDate && startDate <= endDate;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Start Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !startDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2">
            <Label>End Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !endDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  initialFocus
                  disabled={(date) => startDate ? date < startDate : false}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
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
