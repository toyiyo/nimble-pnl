import React, { useEffect, useState } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { utcTimeToLocalTime, localTimeToUtcTime } from '@/lib/availabilityTimeUtils';
import { parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/ui/date-picker';
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
  defaultDate?: Date; // Pre-fill when creating from grid cell
  // Only rendered when editing an existing row AND the caller supplies this
  // (Scheduling.tsx is the only caller that does). Closes the editor and
  // hands the row up so the caller can open the shared
  // DeleteAvailabilityDialog.
  onRemove?: (exception: AvailabilityException) => void;
}

export const AvailabilityExceptionDialog = ({
  open,
  onOpenChange,
  restaurantId,
  exception,
  defaultEmployeeId,
  defaultDate,
  onRemove,
}: AvailabilityExceptionDialogProps) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [date, setDate] = useState<Date | undefined>();
  const [isAvailable, setIsAvailable] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');

  const createException = useCreateAvailabilityException();
  const updateException = useUpdateAvailabilityException();

  const { selectedRestaurant } = useRestaurantContext();
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';

  useEffect(() => {
    if (exception) {
      setEmployeeId(exception.employee_id);
      const exceptionDate = parseDateOnly(exception.date);
      setDate(exceptionDate);
      setIsAvailable(exception.is_available);
      if (exception.start_time) {
        setStartTime(utcTimeToLocalTime(exception.start_time, restaurantTimezone, exceptionDate));
      }
      if (exception.end_time) {
        setEndTime(utcTimeToLocalTime(exception.end_time, restaurantTimezone, exceptionDate));
      }
      setReason(exception.reason || '');
    } else {
      setEmployeeId(defaultEmployeeId || '');
      setDate(defaultDate);
      setIsAvailable(false);
      setStartTime('09:00');
      setEndTime('17:00');
      setReason('');
    }
  }, [exception, open, defaultEmployeeId, defaultDate, restaurantTimezone]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!employeeId || !date) {
      return;
    }

    const exceptionData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      date: toDateOnlyString(date),
      is_available: isAvailable,
      start_time: isAvailable ? localTimeToUtcTime(startTime, restaurantTimezone, date) : undefined,
      end_time: isAvailable ? localTimeToUtcTime(endTime, restaurantTimezone, date) : undefined,
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
            <Label>Date *</Label>
            <DatePicker
              value={date}
              onChange={setDate}
              dateFormat="MMM d, yyyy"
              placeholder="Pick a date"
              aria-label="Select date"
            />
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

          <div className="flex items-center justify-between gap-2">
            {exception && onRemove && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive/80"
                onClick={() => {
                  onOpenChange(false);
                  onRemove(exception);
                }}
              >
                Remove
              </Button>
            )}
            <div className="flex justify-end gap-2 ml-auto">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
