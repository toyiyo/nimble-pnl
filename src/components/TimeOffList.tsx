import { useState } from 'react';
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
import { useTimeoffCoverageImpact } from '@/hooks/useShiftProtection';
import { PolicyWarningError, type PolicyFinding } from '@/lib/shiftProtection';
import { ShiftProtectionWarning } from './scheduling/ShiftProtectionWarning';
import { TimeOffRequestDialog } from './TimeOffRequestDialog';
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
}

export function TimeOffList({ restaurantId }: TimeOffListProps) {
  const { timeOffRequests, loading } = useTimeOffRequests(restaurantId);
  const approveRequest = useApproveTimeOffRequest();
  const rejectRequest = useRejectTimeOffRequest();
  const deleteRequest = useDeleteTimeOffRequest();

  const [editingRequest, setEditingRequest] = useState<TimeOffRequest | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<TimeOffRequest | null>(null);

  // Shift Protection: an approve that answers policy_warning lands here.
  // The dialog shows the findings plus the coverage impact (fetched
  // lazily, only for this one request) and offers "Approve anyway".
  const [policyTarget, setPolicyTarget] = useState<{
    request: TimeOffRequest;
    warnings: PolicyFinding[];
  } | null>(null);
  const coverageImpact = useTimeoffCoverageImpact(policyTarget?.request.id ?? null);

  function handleEdit(request: TimeOffRequest) {
    setEditingRequest(request);
    setDialogOpen(true);
  }
  function handleApprove(request: TimeOffRequest) {
    approveRequest.mutate(
      { id: request.id, restaurantId },
      {
        onError: (error) => {
          if (error instanceof PolicyWarningError) {
            setPolicyTarget({ request, warnings: error.warnings });
          }
        },
      }
    );
  }
  function handleApproveAnyway() {
    if (!policyTarget) return;
    approveRequest.mutate(
      { id: policyTarget.request.id, restaurantId, override: true },
      { onSuccess: () => setPolicyTarget(null) }
    );
  }
  function handleReject(request: TimeOffRequest) {
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

  return (
    <>
      <div className="space-y-4 p-4">
        <PendingQueue
          requests={pending}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isApproving={approveRequest.isPending}
          isRejecting={rejectRequest.isPending}
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

      <AlertDialog open={!!policyTarget} onOpenChange={(open) => { if (!open) setPolicyTarget(null); }}>
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

              {coverageImpact.isLoading && (
                <Skeleton className="h-14 w-full rounded-lg" />
              )}
              {coverageImpact.error != null && (
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
            <AlertDialogCancel disabled={approveRequest.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleApproveAnyway();
              }}
              disabled={approveRequest.isPending}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {approveRequest.isPending ? 'Approving…' : 'Approve anyway'}
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
