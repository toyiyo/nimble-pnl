import { useState, useEffect } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import * as dateFnsTz from 'date-fns-tz';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar as CalendarIcon, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCreateTimeOffRequest, useUpdateTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { TimeOffRequest } from '@/types/scheduling';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmployeeSelector } from './scheduling/EmployeeSelector';

interface TimeOffRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  request?: TimeOffRequest;
  defaultEmployeeId?: string; // For employee self-service
}

export const TimeOffRequestDialog = ({
  open,
  onOpenChange,
  restaurantId,
  request,
  defaultEmployeeId,
}: TimeOffRequestDialogProps) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [reason, setReason] = useState('');
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
  const { zonedTimeToUtc } = dateFnsTz;

  const createRequest = useCreateTimeOffRequest();
  const updateRequest = useUpdateTimeOffRequest();

  useEffect(() => {
    if (request) {
      setEmployeeId(request.employee_id);
      setStartDate(new Date(request.start_date));
      setEndDate(new Date(request.end_date));
      setReason(request.reason || '');
    } else {
      setEmployeeId(defaultEmployeeId || '');
      setStartDate(undefined);
      setEndDate(undefined);
      setReason('');
    }
  }, [request, open, defaultEmployeeId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Convert start/end dates to UTC using provided timezone; fallback is identity
    const toUTCDate = (date: Date) => {
      const converter = zonedTimeToUtc ?? ((value: Date) => value);
      return converter(date, restaurantTimezone).toISOString().substring(0, 10);
    };

    if (!employeeId || !startDate || !endDate) {
      return;
    }

    const requestData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      start_date: toUTCDate(startDate),
      end_date: toUTCDate(endDate),
      reason: reason || undefined,
      status: 'pending' as const,
    };

    if (request) {
      updateRequest.mutate(
        { id: request.id, ...requestData },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      createRequest.mutate(requestData, {
        onSuccess: () => {
          onOpenChange(false);
        },
      });
    }
  };

  const isValid = employeeId && startDate && endDate && startDate <= endDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="time-off-request-description">
        <DialogHeader>
          <DialogTitle>{request ? 'Edit Time-Off Request' : 'New Time-Off Request'}</DialogTitle>
          <DialogDescription id="time-off-request-description">
            {request ? 'Update the time-off request details below.' : 'Submit a new time-off request for an employee.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <EmployeeSelector
            restaurantId={restaurantId}
            value={employeeId}
            onValueChange={setEmployeeId}
            disabled={!!request || !!defaultEmployeeId}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="start-date"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !startDate && 'text-muted-foreground'
                    )}
                    aria-label="Select start date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'MMM d, yyyy') : 'Pick date'}
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

            <div className="space-y-2">
              <Label htmlFor="end-date">End Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="end-date"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !endDate && 'text-muted-foreground'
                    )}
                    aria-label="Select end date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    disabled={(date) => startDate ? date < startDate : false}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {startDate && endDate && startDate > endDate && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                End date must be on or after the start date.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for time-off..."
              rows={3}
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
              disabled={!isValid || createRequest.isPending || updateRequest.isPending}
            >
              {request ? 'Update Request' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
