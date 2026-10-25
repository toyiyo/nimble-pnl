import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Calendar } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';
import {
  useTimeOffRequests,
  useApproveTimeOffRequest,
  useRejectTimeOffRequest,
  useDeleteTimeOffRequest,
} from '@/hooks/useTimeOffRequests';
import { useToast } from '@/hooks/use-toast';
import {
  fetchTimeoffCoverageImpact,
  timeoffCoverageImpactKey,
  useTimeoffCoverageImpact,
  type CoverageImpactShift,
} from '@/hooks/useShiftProtection';
import {
  shiftCount,
  TIME_OFF_SHIFT_ERROR_TOAST,
  useApplyTimeOffShiftAction,
  type TimeOffShiftAction,
} from '@/hooks/useTimeOffShiftAction';
import { PolicyWarningError, type PolicyFinding } from '@/lib/shiftProtection';
import { ShiftProtectionWarning } from './scheduling/ShiftProtectionWarning';
import { TimeOffRequestDialog } from './TimeOffRequestDialog';
import { TimeOffShiftsDialog } from './timeoff/TimeOffShiftsDialog';
import { PendingQueue } from './timeoff/PendingQueue';
import { DecidedHistory } from './timeoff/DecidedHistory';
import { partitionByStatus } from '@/lib/timeOffUtils';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TimeOffListProps {
  restaurantId: string;
  /** IANA zone of the restaurant, for shift times in dialogs. */
  timezone?: string | null;
}

// A shift choice made in TimeOffShiftsDialog. It travels into the
// policy dialog, so "Approve anyway" still applies it.
type PendingShiftAction = { shifts: CoverageImpactShift[]; action: TimeOffShiftAction };

const CHECK_FAILED_TOAST = {
  title: 'Could not check shifts',
  description: 'The request is approved without a shift action.',
};

export function TimeOffList({ restaurantId, timezone }: TimeOffListProps) {
  const { timeOffRequests, loading } = useTimeOffRequests(restaurantId);
  const approveRequest = useApproveTimeOffRequest();
  const rejectRequest = useRejectTimeOffRequest();
  const deleteRequest = useDeleteTimeOffRequest();

  const [editingRequest, setEditingRequest] = useState<TimeOffRequest | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<TimeOffRequest | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const applyShiftAction = useApplyTimeOffShiftAction();

  // Shift Protection: an approve that answers policy_warning lands here.
  // The dialog shows the findings plus the coverage impact (fetched
  // lazily, only for this one request) and offers "Approve anyway".
  const [policyTarget, setPolicyTarget] = useState<{
    request: TimeOffRequest;
    warnings: PolicyFinding[];
    shiftAction: PendingShiftAction | null;
    checkFailed: boolean;
  } | null>(null);
  const coverageImpact = useTimeoffCoverageImpact(policyTarget?.request.id ?? null);

  function handleEdit(request: TimeOffRequest) {
    setEditingRequest(request);
    setDialogOpen(true);
  }
  // The employee's shifts in the request dates, shown before the approval.
  const [shiftsTarget, setShiftsTarget] = useState<{
    request: TimeOffRequest;
    shifts: CoverageImpactShift[];
  } | null>(null);

  // True while an async step runs (shift fetch, approval, shift action).
  // The ref blocks a second click before React re-renders.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  function lock() {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    return true;
  }
  function unlock() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  // Approve, then apply the shift choice. Returns false if the approval
  // did not go through. A policy warning moves the choice into the
  // policy dialog: both state updates run in one handler, so React
  // batches the dialog swap.
  async function approveThenApply(
    request: TimeOffRequest,
    shiftAction: PendingShiftAction | null,
    override: boolean,
    checkFailed = false
  ) {
    try {
      await approveRequest.mutateAsync({ id: request.id, restaurantId, override });
    } catch (error) {
      if (error instanceof PolicyWarningError && !override) {
        setShiftsTarget(null);
        setPolicyTarget({ request, warnings: error.warnings, shiftAction, checkFailed });
      }
      return false;
    }
    if (shiftAction) {
      try {
        await applyShiftAction.mutateAsync({
          restaurantId,
          employeeId: request.employee_id,
          shiftIds: shiftAction.shifts.map((shift) => shift.shift_id),
          action: shiftAction.action,
        });
      } catch {
        // The request is approved. Close the dialogs so a retry cannot run.
        toast(TIME_OFF_SHIFT_ERROR_TOAST);
      }
    }
    setShiftsTarget(null);
    setPolicyTarget(null);
    return true;
  }

  async function handleApprove(request: TimeOffRequest) {
    if (!lock()) return;
    try {
      let shifts: CoverageImpactShift[];
      try {
        const impact = await queryClient.fetchQuery({
          queryKey: timeoffCoverageImpactKey(request.id),
          queryFn: () => fetchTimeoffCoverageImpact(request.id),
          // Always fresh: a stale empty list would skip the shift choice.
          staleTime: 0,
        });
        shifts = impact.shifts;
      } catch {
        // A failed check does not block the approval.
        const approved = await approveThenApply(request, null, false, true);
        if (approved) toast(CHECK_FAILED_TOAST);
        return;
      }
      if (shifts.length === 0) {
        await approveThenApply(request, null, false);
        return;
      }
      setShiftsTarget({ request, shifts });
    } finally {
      unlock();
    }
  }

  async function handleConfirmShifts(action: TimeOffShiftAction) {
    if (!shiftsTarget || !lock()) return;
    try {
      await approveThenApply(shiftsTarget.request, { shifts: shiftsTarget.shifts, action }, false);
    } finally {
      unlock();
    }
  }

  async function handleApproveAnyway() {
    if (!policyTarget || !lock()) return;
    try {
      const approved = await approveThenApply(
        policyTarget.request,
        policyTarget.shiftAction,
        true,
        policyTarget.checkFailed
      );
      if (approved && policyTarget.checkFailed) toast(CHECK_FAILED_TOAST);
    } finally {
      unlock();
    }
  }

  function handleCancelPolicy() {
    if (submittingRef.current) return;
    if (policyTarget?.shiftAction) toast({ title: 'Nothing changed' });
    setPolicyTarget(null);
  }

  function policyActionLabel(shiftAction: PendingShiftAction) {
    const verb = shiftAction.action.kind === 'trade' ? 'post' : 'delete';
    return `${verb} ${shiftCount(shiftAction.shifts.length)}`;
  }

  function handleReject(request: TimeOffRequest) {
    if (submittingRef.current) return;
    rejectRequest.mutate({ id: request.id, restaurantId });
  }
  function handleDelete(request: TimeOffRequest) {
    setRequestToDelete(request);
  }
  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingRequest(undefined);
  }

  const confirmDelete = () => {
    if (requestToDelete) {
      deleteRequest.mutate(
        { id: requestToDelete.id, restaurantId },
        { onSuccess: () => setRequestToDelete(null) },
      );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4" data-testid="time-off-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (timeOffRequests.length === 0) {
    return (
      <Card className="border-border/40 bg-muted/20">
        <CardContent className="py-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground/60 mb-4" />
          <h3 className="text-[15px] font-semibold mb-1">No time-off requests yet</h3>
          <p className="text-[13px] text-muted-foreground">
            New employee requests will appear here for your review.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { pending, decided } = partitionByStatus(timeOffRequests);

  let approveAnywayLabel = 'Approve anyway';
  if (submitting) approveAnywayLabel = 'Approving…';
  else if (policyTarget?.shiftAction) {
    approveAnywayLabel = `Approve anyway and ${policyActionLabel(policyTarget.shiftAction)}`;
  }

  return (
    <>
      <div className="space-y-4 p-4">
        <PendingQueue
          requests={pending}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isApproving={approveRequest.isPending || submitting}
          isRejecting={rejectRequest.isPending || submitting}
        />
        <DecidedHistory
          requests={decided}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      </div>

      <TimeOffRequestDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        restaurantId={restaurantId}
        request={editingRequest}
      />

      {/* Mount only while open: an unmount in the same commit as the policy
          dialog open keeps Radix from leaving body pointer-events on none. */}
      {shiftsTarget && (
        <TimeOffShiftsDialog
          key={shiftsTarget.request.id}
          request={shiftsTarget.request}
          shifts={shiftsTarget.shifts}
          submitting={submitting}
          timezone={timezone}
          onCancel={() => setShiftsTarget(null)}
          onConfirm={handleConfirmShifts}
        />
      )}

      <AlertDialog open={!!policyTarget} onOpenChange={(open) => { if (!open) handleCancelPolicy(); }}>
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" aria-hidden="true" />
              Shift protection findings
            </AlertDialogTitle>
            <AlertDialogDescription>
              The rules flag this approval. You can approve anyway.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {policyTarget && (
            <div className="space-y-3">
              <ShiftProtectionWarning
                messages={policyTarget.warnings.map((warning) => warning.message)}
              />
              {policyTarget.shiftAction && (
                <p className="text-[13px] font-medium text-foreground">
                  After approval: {policyActionLabel(policyTarget.shiftAction)}
                  {policyTarget.shiftAction.action.kind === 'trade' ? ' for trade' : ''}.
                </p>
              )}

              {coverageImpact.isLoading && (
                <Skeleton className="h-14 w-full rounded-lg" />
              )}
              {coverageImpact.error !== null && (
                <p className="text-[13px] text-muted-foreground">
                  Could not load the coverage detail.
                </p>
              )}
              {coverageImpact.data && (
                <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-1.5">
                  <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Coverage impact
                  </p>
                  {coverageImpact.data.shifts.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">
                      No scheduled shifts fall inside this request.
                    </p>
                  ) : (
                    coverageImpact.data.shifts.map((shift) => (
                      <p key={shift.shift_id} className="text-[13px] text-foreground">
                        {shift.position}, {format(new Date(shift.start_time), 'EEE MMM d, h:mm a')}:{' '}
                        {shift.current_count} →{' '}
                        <span
                          className={cn(
                            'font-semibold',
                            shift.after_count < shift.required && 'text-destructive'
                          )}
                        >
                          {shift.after_count}
                        </span>{' '}
                        (needs {shift.required})
                      </p>
                    ))
                  )}
                  {coverageImpact.data.overlapping_approved > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {coverageImpact.data.overlapping_approved === 1
                        ? '1 other approved request overlaps these days.'
                        : `${coverageImpact.data.overlapping_approved} other approved requests overlap these days.`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleApproveAnyway();
              }}
              disabled={submitting}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {approveAnywayLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!requestToDelete} onOpenChange={() => setRequestToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time-off request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time-off request? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
