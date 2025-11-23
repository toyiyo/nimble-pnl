import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useEmployees } from '@/hooks/useEmployees';
import { useCreateAvailabilityException, useUpdateAvailabilityException } from '@/hooks/useAvailability';
import { AvailabilityException } from '@/types/scheduling';

interface AvailabilityExceptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  exception?: AvailabilityException;
}

export const AvailabilityExceptionDialog = ({
  open,
  onOpenChange,
  restaurantId,
  exception,
}: AvailabilityExceptionDialogProps) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [date, setDate] = useState<Date | undefined>();
  const [isAvailable, setIsAvailable] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');

  const { employees } = useEmployees(restaurantId);
  const createException = useCreateAvailabilityException();
  const updateException = useUpdateAvailabilityException();

  const activeEmployees = employees.filter(emp => emp.status === 'active');

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
      setEmployeeId('');
      setDate(undefined);
      setIsAvailable(false);
      setStartTime('09:00');
      setEndTime('17:00');
      setReason('');
    }
  }, [exception, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!employeeId || !date) {
      return;
    }

    const exceptionData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      date: format(date, 'yyyy-MM-dd'),
      is_available: isAvailable,
      start_time: isAvailable ? `${startTime}:00` : undefined,
      end_time: isAvailable ? `${endTime}:00` : undefined,
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
          <div className="space-y-2">
            <Label htmlFor="employee">Employee *</Label>
            <Select
              value={employeeId}
              onValueChange={setEmployeeId}
              disabled={!!exception}
            >
              <SelectTrigger id="employee">
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {activeEmployees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name} - {employee.position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-time">End Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
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
