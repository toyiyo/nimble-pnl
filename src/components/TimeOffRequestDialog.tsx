import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
import { useCreateTimeOffRequest, useUpdateTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { useShiftProtection, useTimeoffDayCounts } from '@/hooks/useShiftProtection';
import { usePermissions } from '@/hooks/usePermissions';
import { TimeOffRequest } from '@/types/scheduling';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmployeeSelector } from './scheduling/EmployeeSelector';
import { timeoffNoticeFinding } from '@/lib/shiftProtection';

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

  // Shift Protection: warn about (or, in block mode, stop) short-notice
  // and stacked same-day requests. A capability holder is exempt — the
  // server triggers apply the same exemption.
  const { protection } = useShiftProtection(restaurantId);
  const { hasCapability, isResolved } = usePermissions();
  const isExempt = isResolved && hasCapability('edit:scheduling');

  const startStr = startDate ? toDateOnlyString(startDate) : null;
  const endStr = endDate ? toDateOnlyString(endDate) : null;
  const todayStr = toDateOnlyString(new Date());

  const noticeFinding = useMemo(
    () => timeoffNoticeFinding(protection, startStr ?? undefined, todayStr),
    [protection, startStr, todayStr]
  );

  const countsEnabled = protection.timeoff_sameday_mode !== 'off';
  const dayCounts = useTimeoffDayCounts(
    countsEnabled ? restaurantId : null,
    employeeId || null,
    startStr,
    endStr
  );
  const maxSameday = useMemo(
    () => Math.max(0, ...(dayCounts.data ?? []).map((d) => d.approved_count)),
    [dayCounts.data]
  );
  const samedayHit = countsEnabled && maxSameday >= protection.timeoff_sameday_limit;

  const blocked =
    !isExempt &&
    ((noticeFinding?.mode === 'block') ||
      (samedayHit && protection.timeoff_sameday_mode === 'block'));
  const hasPolicyWarning = !!noticeFinding || samedayHit;

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
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto" aria-describedby="time-off-request-description">
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

          {countsEnabled && dayCounts.isLoading && startStr && endStr && (
            <p className="text-[13px] text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Checking the coverage rules…
            </p>
          )}
          {countsEnabled && dayCounts.error != null && (
            <p className="text-[13px] text-muted-foreground">
              Could not check the coverage rules. You can still submit.
            </p>
          )}

          {hasPolicyWarning && (
            <div
              id="time-off-policy-warning"
              role="status"
              className="flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
            >
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                {noticeFinding && (
                  <p className="text-[13px] text-foreground">{noticeFinding.message}</p>
                )}
                {samedayHit && (
                  <p className="text-[13px] text-foreground">
                    {maxSameday} coworker{maxSameday === 1 ? '' : 's'} with the same position
                    already have approved time off on a requested day
                    (limit {protection.timeoff_sameday_limit}).
                  </p>
                )}
                <p className="text-[12px] text-muted-foreground">
                  {blocked
                    ? 'A shift protection rule blocks this request. Ask your manager to submit it for you.'
                    : 'You can still submit. Your manager sees this warning with your request.'}
                </p>
              </div>
            </div>
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
              disabled={!isValid || blocked || createRequest.isPending || updateRequest.isPending}
              aria-describedby={blocked ? 'time-off-policy-warning' : undefined}
            >
              {request ? 'Update Request' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
