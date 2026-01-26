import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTimeOffRequests, useDeleteTimeOffRequest } from '@/hooks/useTimeOffRequests';
import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';
import { useGustoEmployeeOnboarding, getOnboardingStatusLabel, useGustoWelcomeDialog } from '@/hooks/useGustoEmployeeOnboarding';
import { useGustoConnection } from '@/hooks/useGustoConnection';
import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';
import { AvailabilityDialog } from '@/components/AvailabilityDialog';
import { AvailabilityExceptionDialog } from '@/components/AvailabilityExceptionDialog';
import { GustoOnboardingWelcome } from '@/components/employee/GustoOnboardingWelcome';
import {
  CalendarClock,
  CalendarX,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  UserCircle,
  Clock,
  DollarSign,
  CheckCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import * as dateFnsTz from 'date-fns-tz';
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

const EmployeePortal = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';

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

  // Gusto payroll onboarding
  const { isConnected: gustoConnected } = useGustoConnection(restaurantId);
  const {
    onboardingState,
    isLoading: onboardingLoading,
    flowUrl,
    flowLoading,
    flowExpired,
    openOnboardingFlow,
    clearFlow,
    refreshStatus,
    isOnboardingComplete,
    needsOnboarding,
    hasGustoAccount,
  } = useGustoEmployeeOnboarding(restaurantId, currentEmployee?.id || null);

  // Welcome dialog for first-time onboarding
  const { showWelcome, setShowWelcome, dismissWelcome } = useGustoWelcomeDialog(
    needsOnboarding,
    hasGustoAccount
  );

  // Auto-load payroll flow when tab is selected and employee needs onboarding
  const [activeTab, setActiveTab] = useState('time-off');
  useEffect(() => {
    if (activeTab === 'payroll' && hasGustoAccount && !flowUrl && !flowLoading && !flowExpired) {
      openOnboardingFlow();
    }
  }, [activeTab, hasGustoAccount, flowUrl, flowLoading, flowExpired, openOnboardingFlow]);

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
  const formatTimeInRestaurantTz = (time: string | null | undefined) => {
    if (!time) return '';
    const converter = dateFnsTz.toZonedTime ?? ((date: Date) => date);
    const date = new Date(`1970-01-01T${time}Z`);
    const zoned = converter(date, restaurantTimezone);
    return format(zoned, 'HH:mm');
  };

  const renderTimeOffContent = () => {
    if (requestsLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      );
    }

    if (myTimeOffRequests.length === 0) {
      return (
        <div className="text-center py-12">
          <CalendarX className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Time-Off Requests</h3>
          <p className="text-muted-foreground mb-4">You haven't submitted any time-off requests yet.</p>
          <Button onClick={handleNewTimeOffRequest}>
            <Plus className="mr-2 h-4 w-4" />
            Request Time Off
          </Button>
        </div>
      );
    }

    return (
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
    );
  };

  const renderAvailabilityContent = () => {
    if (availabilityLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }

    if (availability.length === 0) {
      return (
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
      );
    }

    return (
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
                    {formatTimeInRestaurantTz(avail.start_time)} - {formatTimeInRestaurantTz(avail.end_time)}
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
    );
  };

  const renderExceptionContent = () => {
    if (exceptionsLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }

    if (exceptions.length === 0) {
      return (
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
      );
    }

    return (
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
                        {formatTimeInRestaurantTz(exception.start_time)} - {formatTimeInRestaurantTz(exception.end_time)}
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
    );
  };

  const renderPayrollContent = () => {
    const statusInfo = getOnboardingStatusLabel(onboardingState?.onboardingStatus);

    // Loading state
    if (onboardingLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-[500px] w-full" />
        </div>
      );
    }

    // Not synced to Gusto yet
    if (!hasGustoAccount) {
      return (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Payroll Not Set Up</h3>
              <p className="text-muted-foreground mb-4">
                Your payroll account is being set up. Please check back soon or contact your manager.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Onboarding complete
    if (isOnboardingComplete) {
      return (
        <>
          <Card className="bg-green-500/5 border-green-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-500/10">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-green-700">Payroll Setup Complete</h3>
                  <p className="text-sm text-muted-foreground">
                    Your tax forms and direct deposit information have been submitted.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Show Gusto flow for viewing pay stubs, etc. */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Payroll Information</CardTitle>
                  <CardDescription>View your pay stubs, tax documents, and update your information</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearFlow();
                    openOnboardingFlow();
                  }}
                  disabled={flowLoading}
                >
                  {flowLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {flowLoading ? (
                <div className="flex items-center justify-center h-[500px]">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : flowUrl ? (
                <iframe
                  src={flowUrl}
                  className="w-full h-[500px] border-0 rounded-b-lg"
                  title="Gusto Payroll"
                  allow="clipboard-write"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mb-4" />
                  <p>Failed to load payroll interface</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={openOnboardingFlow}
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      );
    }

    // Needs onboarding
    return (
      <>
        {/* Status Card */}
        <Card className={
          statusInfo.variant === 'warning'
            ? 'bg-yellow-500/5 border-yellow-500/20'
            : 'bg-primary/5 border-primary/20'
        }>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-full ${
                statusInfo.variant === 'warning' ? 'bg-yellow-500/10' : 'bg-primary/10'
              }`}>
                <AlertCircle className={`h-5 w-5 ${
                  statusInfo.variant === 'warning' ? 'text-yellow-600' : 'text-primary'
                }`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">Payroll Setup Required</h3>
                  <Badge variant="outline">{statusInfo.label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {statusInfo.description}
                </p>
                {!flowUrl && (
                  <Button onClick={openOnboardingFlow} disabled={flowLoading}>
                    {flowLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <DollarSign className="mr-2 h-4 w-4" />
                        Complete Setup
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Flow expired alert */}
        {flowExpired && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Session Expired</AlertTitle>
            <AlertDescription>
              Your session has expired.{' '}
              <Button variant="link" className="p-0 h-auto" onClick={() => { clearFlow(); openOnboardingFlow(); }}>
                Click here to refresh
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Embedded Gusto Flow */}
        {flowUrl && !flowExpired && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Complete Your Payroll Setup</CardTitle>
                  <CardDescription>Fill out the forms below to set up your payroll information</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshStatus}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Status
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <iframe
                src={flowUrl}
                className="w-full h-[600px] border-0 rounded-b-lg"
                title="Gusto Onboarding"
                allow="clipboard-write"
              />
            </CardContent>
          </Card>
        )}

        <Alert className="bg-primary/5 border-primary/20">
          <AlertCircle className="h-4 w-4 text-primary" />
          <AlertDescription>
            <strong>Need help?</strong> Contact your manager if you have questions about payroll setup.
          </AlertDescription>
        </Alert>
      </>
    );
  };

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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={`grid w-full ${gustoConnected && hasGustoAccount ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabsTrigger value="time-off" className="flex items-center gap-2">
            <CalendarX className="h-4 w-4" />
            <span className="hidden sm:inline">Time Off</span>
          </TabsTrigger>
          <TabsTrigger value="availability" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Availability</span>
          </TabsTrigger>
          {gustoConnected && hasGustoAccount && (
            <TabsTrigger value="payroll" className="flex items-center gap-2 relative">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Payroll</span>
              {needsOnboarding && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
          )}
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
              {renderTimeOffContent()}
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
              {renderAvailabilityContent()}
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
              {renderExceptionContent()}
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

        {/* Payroll Tab */}
        {gustoConnected && hasGustoAccount && (
          <TabsContent value="payroll" className="space-y-4">
            {renderPayrollContent()}
          </TabsContent>
        )}
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

      {/* Gusto Onboarding Welcome Dialog */}
      {currentEmployee && (
        <GustoOnboardingWelcome
          open={showWelcome}
          onOpenChange={setShowWelcome}
          employeeName={currentEmployee.name}
          onStartOnboarding={() => {
            setActiveTab('payroll');
            dismissWelcome();
          }}
          onSkip={dismissWelcome}
        />
      )}
    </div>
  );
};

export default EmployeePortal;
