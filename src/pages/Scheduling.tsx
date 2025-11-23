import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useShifts, useDeleteShift } from '@/hooks/useShifts';
import { useCheckConflicts } from '@/hooks/useConflictDetection';
import { usePublishSchedule, useUnpublishSchedule } from '@/hooks/useSchedulePublish';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { ShiftDialog } from '@/components/ShiftDialog';
import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';
import { TimeOffList } from '@/components/TimeOffList';
import { AvailabilityDialog } from '@/components/AvailabilityDialog';
import { AvailabilityExceptionDialog } from '@/components/AvailabilityExceptionDialog';
import { 
  Calendar, 
  Plus, 
  Users, 
  DollarSign, 
  Clock,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  CalendarClock,
  CalendarX,
  AlertTriangle,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import * as dateFnsTz from 'date-fns-tz';
import { Employee, Shift, ConflictCheck } from '@/types/scheduling';
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

type ShiftCardProps = {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
};

const buildConflictKey = (conflict: ConflictCheck) =>
  conflict.time_off_id ? `timeoff-${conflict.time_off_id}` : `${conflict.conflict_type}-${conflict.message}`;

const ShiftCard = ({ shift, onEdit, onDelete }: ShiftCardProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
  const { zonedTimeToUtc } = dateFnsTz;

  const formatToUTC = (isoString: string) => {
    const date = new Date(isoString);
    const converter = zonedTimeToUtc ?? ((value: Date) => value);
    const utcDate = converter(date, restaurantTimezone);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())} ${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}:${pad(utcDate.getUTCSeconds())}`;
  };

  const conflictParams = useMemo(() => ({
    employeeId: shift.employee_id,
    restaurantId: shift.restaurant_id,
    startTime: formatToUTC(shift.start_time),
    endTime: formatToUTC(shift.end_time),
  }), [shift, restaurantTimezone]);

  const { conflicts, hasConflicts } = useCheckConflicts(conflictParams);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`group relative p-2 rounded border transition-colors cursor-pointer ${
              hasConflicts 
                ? 'bg-yellow-50 border-yellow-300 hover:bg-yellow-100' 
                : 'bg-card hover:bg-accent/50'
            }`}
            onClick={() => onEdit(shift)}
          >
            {hasConflicts && (
              <AlertTriangle className="absolute top-1 left-1 h-3 w-3 text-yellow-600" />
            )}
            <div className="text-xs font-medium">
              {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
              {format(parseISO(shift.end_time), 'h:mm a')}
            </div>
            <div className="text-xs text-muted-foreground">{shift.position}</div>
            <Badge
              variant={
                shift.status === 'confirmed'
                  ? 'default'
                  : shift.status === 'cancelled'
                  ? 'destructive'
                  : 'outline'
              }
              className="mt-1 text-xs"
            >
              {shift.status}
            </Badge>
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(shift);
                }}
                aria-label="Edit shift"
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(shift);
                }}
                aria-label="Delete shift"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </TooltipTrigger>
        {hasConflicts && (
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold text-xs">Conflicts:</p>
              {conflicts.map((conflict) => (
                <p key={buildConflictKey(conflict)} className="text-xs">• {conflict.message}</p>
              ))}
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

const Scheduling = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [availabilityDialogOpen, setAvailabilityDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>();
  const [selectedShift, setSelectedShift] = useState<Shift | undefined>();
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [defaultShiftDate, setDefaultShiftDate] = useState<Date | undefined>();
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [changeLogDialogOpen, setChangeLogDialogOpen] = useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  const { employees, loading: employeesLoading } = useEmployees(restaurantId);
  const { shifts, loading: shiftsLoading } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const deleteShift = useDeleteShift();
  const publishSchedule = usePublishSchedule();
  const unpublishSchedule = useUnpublishSchedule();
  const { publication, isPublished, loading: publicationLoading } = useWeekPublicationStatus(
    restaurantId,
    currentWeekStart,
    weekEnd
  );
  const { changeLogs, loading: changeLogsLoading } = useScheduleChangeLogs(
    restaurantId,
    currentWeekStart,
    weekEnd
  );

  const activeEmployees = employees.filter(emp => emp.status === 'active');

  // Calculate labor metrics
  const calculateShiftHours = (shift: Shift) => {
    const start = new Date(shift.start_time);
    const end = new Date(shift.end_time);
    const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
    return netMinutes / 60;
  };

  const totalScheduledHours = shifts.reduce((sum, shift) => sum + calculateShiftHours(shift), 0);
  
  const totalLaborCost = shifts.reduce((sum, shift) => {
    const employee = employees.find(emp => emp.id === shift.employee_id);
    const hours = calculateShiftHours(shift);
    return sum + (employee ? (employee.hourly_rate / 100) * hours : 0);
  }, 0);

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const handleToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));
  };

  const handleEditEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEmployeeDialogOpen(true);
  };

  const handleAddEmployee = () => {
    setSelectedEmployee(undefined);
    setEmployeeDialogOpen(true);
  };

  const handleAddShift = (date?: Date) => {
    setSelectedShift(undefined);
    setDefaultShiftDate(date);
    setShiftDialogOpen(true);
  };

  const handleEditShift = (shift: Shift) => {
    setSelectedShift(shift);
    setDefaultShiftDate(undefined);
    setShiftDialogOpen(true);
  };

  const handleDeleteShift = (shift: Shift) => {
    setShiftToDelete(shift);
  };

  const confirmDeleteShift = () => {
    if (shiftToDelete && restaurantId) {
      deleteShift.mutate(
        { id: shiftToDelete.id, restaurantId },
        {
          onSuccess: () => {
            setShiftToDelete(null);
          },
        }
      );
    }
  };

  const handlePublishSchedule = (notes?: string) => {
    if (restaurantId) {
      publishSchedule.mutate(
        {
          restaurantId,
          weekStart: currentWeekStart,
          weekEnd,
          notes,
        },
        {
          onSuccess: () => {
            setPublishDialogOpen(false);
          },
        }
      );
    }
  };

  const handleUnpublishSchedule = () => {
    if (restaurantId) {
      unpublishSchedule.mutate(
        {
          restaurantId,
          weekStart: currentWeekStart,
          weekEnd,
          reason: 'Schedule unpublished for corrections',
        },
        {
          onSuccess: () => {
            setUnpublishDialogOpen(false);
          },
        }
      );
    }
  };

  // Get unique employees scheduled this week
  const scheduledEmployeeIds = new Set(shifts.map(shift => shift.employee_id));
  const scheduledEmployeeCount = scheduledEmployeeIds.size;

  const getShiftsForDay = (day: Date) => {
    return shifts.filter(shift => isSameDay(parseISO(shift.start_time), day));
  };

  const getShiftsForEmployee = (employeeId: string, day: Date) => {
    return shifts.filter(
      shift => shift.employee_id === employeeId && isSameDay(parseISO(shift.start_time), day)
    );
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant to view schedules.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Scheduling
              </CardTitle>
              <CardDescription>Manage employee schedules and labor costs</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Metrics Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Employees</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {employeesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{activeEmployees.length}</div>
            )}
            <p className="text-xs text-muted-foreground">Ready to be scheduled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {shiftsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{totalScheduledHours.toFixed(1)}</div>
            )}
            <p className="text-xs text-muted-foreground">Scheduled this week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Labor Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {shiftsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">${totalLaborCost.toFixed(2)}</div>
            )}
            <p className="text-xs text-muted-foreground">Estimated weekly cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Schedule, Time-Off, and Availability */}
      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList>
          <TabsTrigger value="schedule">
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="timeoff">
            <CalendarX className="h-4 w-4 mr-2" />
            Time-Off
          </TabsTrigger>
          <TabsTrigger value="availability">
            <CalendarClock className="h-4 w-4 mr-2" />
            Availability
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule">
          {/* Week Navigation */}
          <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePreviousWeek} aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={handleToday}>
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={handleNextWeek} aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="ml-4 text-lg font-semibold">
                {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              </div>
              {!publicationLoading && (
                <div className="ml-4">
                  <ScheduleStatusBadge
                    isPublished={isPublished}
                    publishedAt={publication?.published_at}
                    locked={isPublished}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {/* Publishing buttons */}
              {isPublished ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChangeLogDialogOpen(true)}
                  >
                    <History className="h-4 w-4 mr-2" />
                    View Changes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUnpublishDialogOpen(true)}
                  >
                    <Unlock className="h-4 w-4 mr-2" />
                    Unpublish
                  </Button>
                </>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setPublishDialogOpen(true)}
                  disabled={shifts.length === 0}
                  className="bg-gradient-to-r from-primary to-accent"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Publish Schedule
                </Button>
              )}
              <Button variant="outline" onClick={handleAddEmployee}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Employee
              </Button>
              <Button onClick={() => handleAddShift()}>
                <Plus className="h-4 w-4 mr-2" />
                Create Shift
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {employeesLoading || shiftsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No employees yet</h3>
              <p className="text-muted-foreground mb-4">Get started by adding your first employee.</p>
              <Button onClick={handleAddEmployee}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Employee
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium sticky left-0 bg-background">Employee</th>
                    {weekDays.map((day) => (
                      <th key={day.toISOString()} className="text-center p-2 font-medium min-w-[120px]">
                        <div>{format(day, 'EEE')}</div>
                        <div className="text-sm text-muted-foreground">{format(day, 'MMM d')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map((employee) => (
                    <tr key={employee.id} className="border-b hover:bg-muted/50 group">
                      <td className="p-2 sticky left-0 bg-background">
                        <div className="flex items-center gap-2 justify-between">
                          <div>
                            <div className="font-medium">{employee.name}</div>
                            <div className="text-sm text-muted-foreground">{employee.position}</div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditEmployee(employee)}
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Edit ${employee.name}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                      {weekDays.map((day) => {
                        const dayShifts = getShiftsForEmployee(employee.id, day);
                        return (
                          <td key={day.toISOString()} className="p-2 align-top">
                            <div className="space-y-1">
                              {dayShifts.map((shift) => (
                                <ShiftCard
                                  key={shift.id}
                                  shift={shift}
                                  onEdit={handleEditShift}
                                  onDelete={handleDeleteShift}
                                />
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => handleAddShift(day)}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add
                              </Button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* Time-Off Tab */}
        <TabsContent value="timeoff">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Time-Off Requests</CardTitle>
                <Button onClick={() => setTimeOffDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {restaurantId && <TimeOffList restaurantId={restaurantId} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Employee Availability</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setExceptionDialogOpen(true)}>
                    <CalendarX className="h-4 w-4 mr-2" />
                    Add Exception
                  </Button>
                  <Button onClick={() => setAvailabilityDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Set Availability
                  </Button>
                </div>
              </div>
              <CardDescription>
                Manage recurring weekly availability and one-time exceptions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Set employee availability preferences to automatically detect scheduling conflicts.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {restaurantId && (
        <>
          <EmployeeDialog
            open={employeeDialogOpen}
            onOpenChange={setEmployeeDialogOpen}
            employee={selectedEmployee}
            restaurantId={restaurantId}
          />
          <ShiftDialog
            open={shiftDialogOpen}
            onOpenChange={setShiftDialogOpen}
            shift={selectedShift}
            restaurantId={restaurantId}
            defaultDate={defaultShiftDate}
          />
          <TimeOffRequestDialog
            open={timeOffDialogOpen}
            onOpenChange={setTimeOffDialogOpen}
            restaurantId={restaurantId}
          />
          <AvailabilityDialog
            open={availabilityDialogOpen}
            onOpenChange={setAvailabilityDialogOpen}
            restaurantId={restaurantId}
          />
          <AvailabilityExceptionDialog
            open={exceptionDialogOpen}
            onOpenChange={setExceptionDialogOpen}
            restaurantId={restaurantId}
          />
        </>
      )}

      {/* Publish Schedule Dialog */}
      <PublishScheduleDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        weekStart={currentWeekStart}
        weekEnd={weekEnd}
        shiftCount={shifts.length}
        employeeCount={scheduledEmployeeCount}
        totalHours={totalScheduledHours}
        onConfirm={handlePublishSchedule}
        isPublishing={publishSchedule.isPending}
      />

      {/* Change Log Dialog */}
      <ChangeLogDialog
        open={changeLogDialogOpen}
        onOpenChange={setChangeLogDialogOpen}
        changeLogs={changeLogs}
        loading={changeLogsLoading}
      />

      {/* Unpublish Confirmation Dialog */}
      <AlertDialog open={unpublishDialogOpen} onOpenChange={setUnpublishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unpublish this schedule? This will unlock all shifts for editing
              and notify employees that the schedule has changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublishSchedule}
              className="bg-gradient-to-r from-primary to-accent"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!shiftToDelete} onOpenChange={() => setShiftToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this shift? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteShift} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Scheduling;
