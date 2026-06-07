import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
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

  const createRequest = useCreateTimeOffRequest();
  const updateRequest = useUpdateTimeOffRequest();

  useEffect(() => {
    if (request) {
      setEmployeeId(request.employee_id);
      setStartDate(parseDateOnly(request.start_date));
      setEndDate(parseDateOnly(request.end_date));
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

    if (!employeeId || !startDate || !endDate) {
      return;
    }

    const requestData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      start_date: toDateOnlyString(startDate),
      end_date: toDateOnlyString(endDate),
      reason: reason || undefined,
      status: 'pending' as const,
      requested_at: new Date().toISOString(),
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
              <Label>Start Date *</Label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                dateFormat="MMM d, yyyy"
                placeholder="Pick date"
                aria-label="Select start date"
              />
            </div>

            <div className="space-y-2">
              <Label>End Date *</Label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                dateFormat="MMM d, yyyy"
                placeholder="Pick date"
                aria-label="Select end date"
                disabled={(date) => (startDate ? date < startDate : false)}
              />
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
