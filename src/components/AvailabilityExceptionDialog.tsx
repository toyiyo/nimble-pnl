import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCreateAvailabilityException, useUpdateAvailabilityException } from '@/hooks/useAvailability';
import { AvailabilityException } from '@/types/scheduling';
import { EmployeeSelector } from './scheduling/EmployeeSelector';
import { TimeInput } from './scheduling/TimeInput';

interface AvailabilityExceptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  exception?: AvailabilityException;
  defaultEmployeeId?: string; // For employee self-service
}

export const AvailabilityExceptionDialog = ({
  open,
  onOpenChange,
  restaurantId,
  exception,
  defaultEmployeeId,
}: AvailabilityExceptionDialogProps) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [date, setDate] = useState<Date | undefined>();
  const [isAvailable, setIsAvailable] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');

  const createException = useCreateAvailabilityException();
  const updateException = useUpdateAvailabilityException();

  useEffect(() => {
    if (exception) {
      setEmployeeId(exception.employee_id);
      setDate(new Date(exception.date));
      setIsAvailable(exception.is_available);
      if (exception.start_time) {
        setStartTime(exception.start_time.substring(0, 5)); // HH:MM
      }
      if (exception.end_time) {
        setEndTime(exception.end_time.substring(0, 5)); // HH:MM
      }
      setReason(exception.reason || '');
    } else {
      setEmployeeId(defaultEmployeeId || '');
      setDate(undefined);
      setIsAvailable(false);
      setStartTime('09:00');
      setEndTime('17:00');
      setReason('');
    }
  }, [exception, open, defaultEmployeeId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!employeeId || !date) {
      return;
    }

    // Convert start/end times to UTC (HH:MM:SS in UTC)
    const toUTC = (time: string) => {
      const [h, m, s = '00'] = time.split(':');
      const now = new Date();
      now.setUTCHours(Number(h), Number(m), Number(s), 0);
      return `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}:${now.getUTCSeconds().toString().padStart(2, '0')}`;
    };

    const exceptionData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      date: format(date, 'yyyy-MM-dd'),
      is_available: isAvailable,
      start_time: isAvailable ? toUTC(startTime) : undefined,
      end_time: isAvailable ? toUTC(endTime) : undefined,
      reason: reason || undefined,
    };

    if (exception) {
      updateException.mutate(
        { id: exception.id, ...exceptionData },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      createException.mutate(exceptionData, {
        onSuccess: () => {
          onOpenChange(false);
        },
      });
    }
  };

  const isValid = employeeId && date && (!isAvailable || (startTime && endTime && startTime < endTime));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="exception-description">
        <DialogHeader>
          <DialogTitle>{exception ? 'Edit Availability Exception' : 'New Availability Exception'}</DialogTitle>
          <DialogDescription id="exception-description">
            {exception 
              ? 'Update a one-time availability change.' 
              : 'Set a one-time availability change for a specific date.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <EmployeeSelector
            restaurantId={restaurantId}
            value={employeeId}
            onValueChange={setEmployeeId}
            disabled={!!exception || !!defaultEmployeeId}
          />

          <div className="space-y-2">
            <Label htmlFor="date">Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                  aria-label="Select date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'MMM d, yyyy') : 'Pick a date'}
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

          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="is-available" className="flex-1">
              Available on this date
            </Label>
            <Switch
              id="is-available"
              checked={isAvailable}
              onCheckedChange={setIsAvailable}
            />
          </div>

          {isAvailable && (
            <div className="grid grid-cols-2 gap-4">
              <TimeInput
                id="start-time"
                label="Start Time"
                value={startTime}
                onChange={setStartTime}
              />
              <TimeInput
                id="end-time"
                label="End Time"
                value={endTime}
                onChange={setEndTime}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for this exception..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || createException.isPending || updateException.isPending}
            >
              {exception ? 'Update' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
