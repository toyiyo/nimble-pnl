import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Calendar, 
  Check, 
  X, 
  Edit, 
  Trash2,
  Clock,
  User,
} from 'lucide-react';
import { format } from 'date-fns';
import { TimeOffRequest } from '@/types/scheduling';
import { useTimeOffRequests, useApproveTimeOffRequest, useRejectTimeOffRequest, useDeleteTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { TimeOffRequestDialog } from './TimeOffRequestDialog';
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

  const handleApprove = (request: TimeOffRequest) => {
    approveRequest.mutate({ id: request.id, restaurantId });
  };

  const handleReject = (request: TimeOffRequest) => {
    rejectRequest.mutate({ id: request.id, restaurantId });
  };

  const handleDelete = (request: TimeOffRequest) => {
    setRequestToDelete(request);
  };

  const confirmDelete = () => {
    if (requestToDelete) {
      deleteRequest.mutate(
        { id: requestToDelete.id, restaurantId },
        {
          onSuccess: () => {
            setRequestToDelete(null);
          },
        }
      );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
            <Check className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-gradient-to-r from-red-500 to-rose-600">
            <X className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (timeOffRequests.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/50 to-transparent">
        <CardContent className="py-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No time-off requests</h3>
          <p className="text-muted-foreground">All time-off requests will appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {timeOffRequests.map((request) => (
          <Card key={request.id} className="group hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">
                        {request.employee?.name || 'Unknown Employee'}
                      </h4>
                      {getStatusBadge(request.status)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {format(new Date(request.start_date), 'MMM d, yyyy')} - 
                          {format(new Date(request.end_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    {request.reason && (
                      <p className="text-sm text-muted-foreground">{request.reason}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {request.status === 'pending' && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleApprove(request)}
                        disabled={approveRequest.isPending}
                        aria-label="Approve request"
                        className="h-8 w-8"
                      >
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleReject(request)}
                        disabled={rejectRequest.isPending}
                        aria-label="Reject request"
                        className="h-8 w-8"
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </>
                  )}
                  {request.status === 'pending' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEdit(request)}
                      aria-label="Edit request"
                      className="h-8 w-8"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(request)}
                    aria-label="Delete request"
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <TimeOffRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        restaurantId={restaurantId}
        request={editingRequest}
      />

      <AlertDialog open={!!requestToDelete} onOpenChange={() => setRequestToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time-Off Request</AlertDialogTitle>
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
