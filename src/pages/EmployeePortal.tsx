import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTimeOffRequests, useDeleteTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';
import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';
import { AvailabilityDialog } from '@/components/AvailabilityDialog';
import { AvailabilityExceptionDialog } from '@/components/AvailabilityExceptionDialog';
import {
  CalendarClock,
  CalendarX,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  UserCircle,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { TimeOffRequest, EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
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
import { formatTime } from '@/lib/utils';

const EmployeePortal = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [availabilityDialogOpen, setAvailabilityDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [selectedTimeOffRequest, setSelectedTimeOffRequest] = useState<TimeOffRequest | undefined>();
  const [selectedAvailability, setSelectedAvailability] = useState<EmployeeAvailability | undefined>();
  const [selectedException, setSelectedException] = useState<AvailabilityException | undefined>();
  const [requestToDelete, setRequestToDelete] = useState<TimeOffRequest | null>(null);

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { timeOffRequests, loading: requestsLoading } = useTimeOffRequests(restaurantId);
  const { availability, loading: availabilityLoading } = useEmployeeAvailability(restaurantId, currentEmployee?.id || undefined);
  const { exceptions, loading: exceptionsLoading } = useAvailabilityExceptions(restaurantId, currentEmployee?.id || undefined);
  const deleteTimeOffRequest = useDeleteTimeOffRequest();

  // Filter time-off requests to show only current employee's requests
  const myTimeOffRequests = currentEmployee
    ? timeOffRequests.filter(req => req.employee_id === currentEmployee.id)
    : [];

  const handleEditTimeOffRequest = (request: TimeOffRequest) => {
    if (request.status === 'pending') {
      setSelectedTimeOffRequest(request);
      setTimeOffDialogOpen(true);
    }
  };

  const handleNewTimeOffRequest = () => {
    setSelectedTimeOffRequest(undefined);
    setTimeOffDialogOpen(true);
  };

  const handleDeleteTimeOffRequest = (request: TimeOffRequest) => {
    setRequestToDelete(request);
  };

  const confirmDeleteTimeOffRequest = () => {
    if (requestToDelete) {
      deleteTimeOffRequest.mutate({
        id: requestToDelete.id,
        restaurantId: requestToDelete.restaurant_id,
      });
      setRequestToDelete(null);
    }
  };

  const handleEditAvailability = (avail: EmployeeAvailability) => {
    setSelectedAvailability(avail);
    setAvailabilityDialogOpen(true);
  };

  const handleNewAvailability = () => {
    setSelectedAvailability(undefined);
    setAvailabilityDialogOpen(true);
  };

  const handleEditException = (exception: AvailabilityException) => {
    setSelectedException(exception);
    setExceptionDialogOpen(true);
  };

  const handleNewException = () => {
    setSelectedException(undefined);
    setExceptionDialogOpen(true);
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  if (employeeLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Required</CardTitle>
              <CardDescription>Your account is not linked to an employee record.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Please contact your manager to link your account to your employee profile to access these features.
          </p>
        </CardContent>
      </Card>
    );
  }

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <UserCircle className="h-6 w-6 text-primary transition-transform duration-300" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Employee Portal
              </CardTitle>
              <CardDescription>Welcome, {currentEmployee.name}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="time-off" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="time-off" className="flex items-center gap-2">
            <CalendarX className="h-4 w-4" />
            Time Off
          </TabsTrigger>
          <TabsTrigger value="availability" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Availability
          </TabsTrigger>
        </TabsList>

        {/* Time-Off Tab */}
        <TabsContent value="time-off" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>My Time-Off Requests</CardTitle>
                  <CardDescription>Request time off and view your pending/approved requests</CardDescription>
                </div>
                <Button onClick={handleNewTimeOffRequest}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {requestsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : myTimeOffRequests.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarX className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Time-Off Requests</h3>
                  <p className="text-muted-foreground mb-4">You haven't submitted any time-off requests yet.</p>
                  <Button onClick={handleNewTimeOffRequest}>
                    <Plus className="mr-2 h-4 w-4" />
                    Request Time Off
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myTimeOffRequests.map((request) => (
                    <Card key={request.id} className="hover:bg-accent/5 transition-colors">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge
                                variant={
                                  request.status === 'approved'
                                    ? 'default'
                                    : request.status === 'rejected'
                                    ? 'destructive'
                                    : 'outline'
                                }
                                className={
                                  request.status === 'approved'
                                    ? 'bg-green-500/10 text-green-700 border-green-500/20'
                                    : ''
                                }
                              >
                                {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                              </Badge>
                            </div>
                            <div className="space-y-1">
                              <p className="font-medium">
                                {format(new Date(request.start_date), 'MMM d, yyyy')} -{' '}
                                {format(new Date(request.end_date), 'MMM d, yyyy')}
                              </p>
                              {request.reason && (
                                <p className="text-sm text-muted-foreground">{request.reason}</p>
                              )}
                              {request.reviewed_at && (
                                <p className="text-xs text-muted-foreground">
                                  Reviewed on {format(new Date(request.reviewed_at), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {request.status === 'pending' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditTimeOffRequest(request)}
                                  aria-label="Edit request"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteTimeOffRequest(request)}
                                  aria-label="Delete request"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert className="bg-primary/5 border-primary/20">
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription>
              <strong>Note:</strong> Your manager will review and approve time-off requests. You can only edit or
              delete pending requests.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability" className="space-y-4">
          {/* Weekly Availability */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Weekly Availability</CardTitle>
                  <CardDescription>Set your regular weekly availability</CardDescription>
                </div>
                <Button onClick={handleNewAvailability}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Availability
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {availabilityLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : availability.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarClock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Availability Set</h3>
                  <p className="text-muted-foreground mb-4">
                    Set your regular weekly availability to help with scheduling.
                  </p>
                  <Button onClick={handleNewAvailability}>
                    <Plus className="mr-2 h-4 w-4" />
                    Set Availability
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {availability.map((avail) => (
                    <div
                      key={avail.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-24 font-medium">{daysOfWeek[avail.day_of_week]}</div>
                        {avail.is_available ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                              Available
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {formatTime(avail.start_time)} - {formatTime(avail.end_time)}
                            </span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20">
                            Unavailable
                          </Badge>
                        )}
                        {avail.notes && (
                          <span className="text-sm text-muted-foreground">({avail.notes})</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditAvailability(avail)}
                        aria-label="Edit availability"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Availability Exceptions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Availability Exceptions</CardTitle>
                  <CardDescription>Set specific dates when you're unavailable or have different hours</CardDescription>
                </div>
                <Button onClick={handleNewException}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Exception
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {exceptionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : exceptions.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarX className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Exceptions</h3>
                  <p className="text-muted-foreground mb-4">
                    Add exceptions for specific dates when your availability differs from your regular schedule.
                  </p>
                  <Button onClick={handleNewException}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Exception
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {exceptions.map((exception) => (
                    <div
                      key={exception.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-32 font-medium">
                          {format(new Date(exception.date), 'MMM d, yyyy')}
                        </div>
                        {exception.is_available ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                              Available
                            </Badge>
                            {exception.start_time && exception.end_time && (
                              <span className="text-sm text-muted-foreground">
                                {formatTime(exception.start_time)} - {formatTime(exception.end_time)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20">
                            Unavailable
                          </Badge>
                        )}
                        {exception.reason && (
                          <span className="text-sm text-muted-foreground">({exception.reason})</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditException(exception)}
                        aria-label="Edit exception"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert className="bg-primary/5 border-primary/20">
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription>
              <strong>Tip:</strong> Setting your availability helps your manager create better schedules. Exceptions
              override your regular weekly availability.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <TimeOffRequestDialog
        open={timeOffDialogOpen}
        onOpenChange={setTimeOffDialogOpen}
        restaurantId={restaurantId}
        request={selectedTimeOffRequest}
        defaultEmployeeId={currentEmployee.id}
      />

      <AvailabilityDialog
        open={availabilityDialogOpen}
        onOpenChange={setAvailabilityDialogOpen}
        restaurantId={restaurantId}
        availability={selectedAvailability}
        defaultEmployeeId={currentEmployee.id}
      />

      <AvailabilityExceptionDialog
        open={exceptionDialogOpen}
        onOpenChange={setExceptionDialogOpen}
        restaurantId={restaurantId}
        exception={selectedException}
        defaultEmployeeId={currentEmployee.id}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!requestToDelete} onOpenChange={() => setRequestToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time-Off Request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your time-off request. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteTimeOffRequest}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EmployeePortal;
