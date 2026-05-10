import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';
import {
  useTimeOffRequests,
  useApproveTimeOffRequest,
  useRejectTimeOffRequest,
  useDeleteTimeOffRequest,
} from '@/hooks/useTimeOffRequests';
import { TimeOffRequestDialog } from './TimeOffRequestDialog';
import { PendingQueue } from './timeoff/PendingQueue';
import { DecidedHistory } from './timeoff/DecidedHistory';
import { partitionByStatus } from '@/lib/timeOffUtils';
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

export const TimeOffList = ({ restaurantId }: TimeOffListProps) => {
  const { timeOffRequests, loading } = useTimeOffRequests(restaurantId);
  const approveRequest = useApproveTimeOffRequest();
  const rejectRequest = useRejectTimeOffRequest();
  const deleteRequest = useDeleteTimeOffRequest();

  const [editingRequest, setEditingRequest] = useState<TimeOffRequest | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<TimeOffRequest | null>(null);

  const handleEdit = (request: TimeOffRequest) => {
    setEditingRequest(request);
    setDialogOpen(true);
  };
  const handleApprove = (request: TimeOffRequest) =>
    approveRequest.mutate({ id: request.id, restaurantId });
  const handleReject = (request: TimeOffRequest) =>
    rejectRequest.mutate({ id: request.id, restaurantId });
  const handleDelete = (request: TimeOffRequest) => setRequestToDelete(request);

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
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRequest(undefined);
        }}
        restaurantId={restaurantId}
        request={editingRequest}
      />

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
};
