import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { FeatureGate } from '@/components/subscription';
import { useShifts, useDeleteShift, useDeleteShiftSeries, useUpdateShiftSeries, useSeriesInfo } from '@/hooks/useShifts';
import { useShiftTrades } from '@/hooks/useShiftTrades';
import { useCheckConflicts } from '@/hooks/useConflictDetection';
import { usePublishSchedule, useUnpublishSchedule, useWeekPublicationStatus } from '@/hooks/useSchedulePublish';
import { useScheduleChangeLogs } from '@/hooks/useScheduleChangeLogs';
import { useScheduledLaborCosts } from '@/hooks/useScheduledLaborCosts';
import { useEmployeeLaborCosts } from '@/hooks/useEmployeeLaborCosts';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEmployeePositions } from '@/hooks/useEmployeePositions';
import { ShiftDialog } from '@/components/ShiftDialog';
import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';
import { TimeOffList } from '@/components/TimeOffList';
import { AvailabilityDialog } from '@/components/AvailabilityDialog';
import { AvailabilityExceptionDialog } from '@/components/AvailabilityExceptionDialog';
import { ScheduleStatusBadge } from '@/components/ScheduleStatusBadge';
import { PublishScheduleDialog } from '@/components/PublishScheduleDialog';
import { ChangeLogDialog } from '@/components/ChangeLogDialog';
import { TradeApprovalQueue } from '@/components/schedule/TradeApprovalQueue';
import { LaborCostBreakdown } from '@/components/scheduling/LaborCostBreakdown';
import { ScheduleExportDialog } from '@/components/scheduling/ScheduleExportDialog';
import { RecurringShiftActionDialog, RecurringActionType } from '@/components/scheduling/RecurringShiftActionDialog';
import { isRecurringShift, RecurringActionScope } from '@/utils/recurringShiftHelpers';
import { cn } from '@/lib/utils';
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
  Unlock,
  Send,
  History,
  Printer,
  ArrowLeftRight,
  TrendingUp,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, parseISO, isToday } from 'date-fns';
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

const SKELETON_ROWS = ['row-0', 'row-1', 'row-2', 'row-3'];
const SKELETON_DAYS = ['day-0', 'day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'day-6'];

export const getShiftStatusClass = (status: Shift['status'], hasConflicts: boolean) => {
  if (hasConflicts) {
    return 'border-l-warning bg-warning/5 hover:bg-warning/10';
  }
  if (status === 'confirmed') {
    return 'border-l-success';
  }
  if (status === 'cancelled') {
    return 'border-l-destructive opacity-60';
  }
  return 'border-l-primary/50';
};

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
  const { fromZonedTime } = dateFnsTz;

  const formatToUTC = useCallback((isoString: string) => {
    const date = new Date(isoString);
    const converter = fromZonedTime ?? ((value: Date) => value);
    const utcDate = converter(date, restaurantTimezone);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())} ${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}:${pad(utcDate.getUTCSeconds())}`;
  }, [fromZonedTime, restaurantTimezone]);

  const conflictParams = useMemo(() => ({
    employeeId: shift.employee_id,
    restaurantId: shift.restaurant_id,
    startTime: formatToUTC(shift.start_time),
    endTime: formatToUTC(shift.end_time),
  }), [shift, restaurantTimezone, formatToUTC]);

  const { conflicts, hasConflicts } = useCheckConflicts(conflictParams);

  // Calculate shift duration for visual indicator
  const shiftStart = parseISO(shift.start_time);
  const shiftEnd = parseISO(shift.end_time);
  const durationHours = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);
  const shiftStatusClass = getShiftStatusClass(shift.status, hasConflicts);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "group relative rounded-lg border-l-4 transition-all duration-200 cursor-pointer",
              "hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5",
              "bg-gradient-to-r from-card to-card/80",
              shiftStatusClass
            )}
            onClick={() => onEdit(shift)}
          >
            {/* Time block header */}
            <div className={cn(
              "px-2.5 py-1.5 border-b border-border/50",
              hasConflicts && "bg-warning/10"
            )}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-tight text-foreground">
                  {format(shiftStart, 'h:mm')}
                  <span className="text-muted-foreground font-normal">
                    {format(shiftStart, 'a').toLowerCase()}
                  </span>
                </span>
                {hasConflicts && (
                  <AlertTriangle className="h-3 w-3 text-warning animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                <span>{durationHours.toFixed(1)}h</span>
                <span className="mx-0.5">·</span>
                <span>until {format(shiftEnd, 'h:mma').toLowerCase()}</span>
              </div>
            </div>

            {/* Position & Status */}
            <div className="px-2.5 py-2 space-y-1.5">
              <div className="text-xs font-medium text-foreground/90 truncate">
                {shift.position}
              </div>
              <Badge
                variant={
                  shift.status === 'confirmed'
                    ? 'default'
                    : shift.status === 'cancelled'
                    ? 'destructive'
                    : 'outline'
                }
                className={cn(
                  "text-[10px] h-5 font-medium",
                  shift.status === 'confirmed' && "bg-success/15 text-success border-success/30 hover:bg-success/20"
                )}
              >
                {shift.status}
              </Badge>
            </div>

            {/* Hover actions */}
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-all duration-200 flex gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background shadow-sm"
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
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive shadow-sm"
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
          <TooltipContent side="top" className="max-w-xs bg-warning/95 text-warning-foreground border-warning">
            <div className="space-y-1">
              <p className="font-semibold text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Scheduling Conflicts
              </p>
              {conflicts.map((conflict) => (
                <p key={buildConflictKey(conflict)} className="text-xs opacity-90">• {conflict.message}</p>
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

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
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
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [recurringActionDialog, setRecurringActionDialog] = useState<{
    open: boolean;
    shift: Shift | null;
    actionType: RecurringActionType;
  }>({ open: false, shift: null, actionType: 'edit' });

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  // Fetch ALL employees (including inactive) to show historical shifts
  const { employees: allEmployees, loading: employeesLoading } = useEmployees(restaurantId, { status: 'all' });
  const { shifts, loading: shiftsLoading } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const { trades: pendingTrades } = useShiftTrades(restaurantId, 'pending_approval', null);
  const deleteShift = useDeleteShift();
  const deleteShiftSeries = useDeleteShiftSeries();
  const updateShiftSeries = useUpdateShiftSeries();
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
  
  const pendingTradeCount = pendingTrades.length;

  // Separate active employees for creating new shifts
  const activeEmployees = allEmployees.filter(emp => Boolean(emp.is_active));
  const { positions, isLoading: positionsLoading } = useEmployeePositions(restaurantId);
  const [positionFilter, setPositionFilter] = useState<string>('all');

  // Calculate scheduled labor costs with breakdown
  const { breakdown: laborCostBreakdown } = useScheduledLaborCosts(
    shifts,
    currentWeekStart,
    weekEnd,
    restaurantId
  );

  // Calculate per-employee labor costs with outlier detection
  const laborCostSummary = useEmployeeLaborCosts(shifts, allEmployees);

  // Handler for clicking on an employee in the breakdown to edit them
  const handleEditEmployeeById = useCallback((employeeId: string) => {
    const employee = allEmployees.find(e => e.id === employeeId);
    if (employee) {
      setSelectedEmployee(employee);
      setEmployeeDialogOpen(true);
    }
  }, [allEmployees]);

  // Apply position filter to active employees for new shift creation
  const filteredActiveEmployees = positionFilter && positionFilter !== 'all'
    ? activeEmployees.filter(emp => emp.position === positionFilter)
    : activeEmployees;

  // For displaying shifts, include ALL employees with shifts this week (including inactive)
  // Apply position filter to all employees with shifts
  const filteredEmployeesWithShifts = useMemo(() => {
    const shiftEmployeeIds = new Set(shifts.map(s => s.employee_id));
    const employeesWithShifts = allEmployees.filter(emp => shiftEmployeeIds.has(emp.id));
    
    if (positionFilter && positionFilter !== 'all') {
      return employeesWithShifts.filter(emp => emp.position === positionFilter);
    }
    return employeesWithShifts;
  }, [allEmployees, shifts, positionFilter]);

  // Calculate labor metrics
  const calculateShiftHours = (shift: Shift) => {
    const start = new Date(shift.start_time);
    const end = new Date(shift.end_time);
    const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
    return netMinutes / 60;
  };

  // Calculate hours for all shifts (including inactive employees)
  const totalScheduledHours = shifts
    .filter(s => filteredEmployeesWithShifts.some(e => e.id === s.employee_id))
    .reduce((sum, shift) => sum + calculateShiftHours(shift), 0);

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const handleToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
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
    // If it's a recurring shift, show the scope selection dialog
    if (isRecurringShift(shift)) {
      setRecurringActionDialog({
        open: true,
        shift,
        actionType: 'edit',
      });
    } else {
      setSelectedShift(shift);
      setDefaultShiftDate(undefined);
      setShiftDialogOpen(true);
    }
  };

  const handleDeleteShift = (shift: Shift) => {
    // If it's a recurring shift, show the scope selection dialog
    if (isRecurringShift(shift)) {
      setRecurringActionDialog({
        open: true,
        shift,
        actionType: 'delete',
      });
    } else {
      setShiftToDelete(shift);
    }
  };

  // Handle recurring action dialog confirmation
  const handleRecurringActionConfirm = (scope: RecurringActionScope) => {
    const { shift, actionType } = recurringActionDialog;
    if (!shift || !restaurantId) return;

    if (actionType === 'delete') {
      // Delete with scope
      deleteShiftSeries.mutate(
        { shift, scope, restaurantId },
        {
          onSuccess: () => {
            setRecurringActionDialog({ open: false, shift: null, actionType: 'edit' });
          },
        }
      );
    } else {
      // For edit, close the dialog and open the shift editor
      // The scope will be handled by the ShiftDialog
      setRecurringActionDialog({ open: false, shift: null, actionType: 'edit' });
      setSelectedShift({ ...shift, _editScope: scope } as Shift & { _editScope: RecurringActionScope });
      setDefaultShiftDate(undefined);
      setShiftDialogOpen(true);
    }
  };

  // Fetch full series info from server (not limited to current week)
  const { seriesCount, lockedCount: seriesLockedCount } = useSeriesInfo(
    recurringActionDialog.shift,
    restaurantId
  );

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

  // Get unique employees scheduled this week (respecting position filter, including inactive)
  const scheduledEmployeeIds = new Set(
    shifts
      .filter(s => filteredEmployeesWithShifts.some(e => e.id === s.employee_id))
      .map(shift => shift.employee_id)
  );
  const scheduledEmployeeCount = scheduledEmployeeIds.size;

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
    <FeatureGate featureKey="scheduling">
    <div className="space-y-6">
      {/* Header - Professional Kitchen Aesthetic */}
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-card via-card to-muted/30">
        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                             linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px'
          }}
        />

        <div className="relative px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Icon with animated ring */}
              <div className="relative">
                <div className="absolute inset-0 rounded-xl bg-primary/20 blur-lg animate-pulse" />
                <div className="relative p-3 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25">
                  <Calendar className="h-6 w-6 text-primary-foreground" />
                </div>
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Staff Schedule
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Manage shifts, availability, and labor costs
                </p>
              </div>
            </div>

            {/* Quick stats in header */}
            <div className="hidden lg:flex items-center gap-6">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">This Week</p>
                <p className="text-lg font-semibold text-foreground">{shifts.length} shifts</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Coverage</p>
                <p className="text-lg font-semibold text-foreground">{scheduledEmployeeCount} staff</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row - Enhanced Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Active Employees Card */}
        <Card className="group relative overflow-hidden border-border/50 hover:border-primary/30 transition-colors duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Employees</CardTitle>
            <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
              <Users className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            {employeesLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{filteredActiveEmployees.length}</span>
                <span className="text-sm text-muted-foreground">staff</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span>Ready to be scheduled</span>
            </p>
          </CardContent>
        </Card>

        {/* Total Hours Card */}
        <Card className="group relative overflow-hidden border-border/50 hover:border-accent/30 transition-colors duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-accent/5 to-transparent rounded-bl-full" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Hours</CardTitle>
            <div className="p-2 rounded-lg bg-accent/10 group-hover:bg-accent/15 transition-colors">
              <Clock className="h-4 w-4 text-accent" />
            </div>
          </CardHeader>
          <CardContent>
            {shiftsLoading ? (
              <Skeleton className="h-9 w-20" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{totalScheduledHours.toFixed(1)}</span>
                <span className="text-sm text-muted-foreground">hours</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              Scheduled this week
            </p>
            {/* Mini progress bar */}
            {!shiftsLoading && totalScheduledHours > 0 && (
              <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent/70 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((totalScheduledHours / 200) * 100, 100)}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Labor Cost Card */}
        <Card className={cn(
          "group relative overflow-hidden border-border/50 transition-colors duration-300",
          laborCostSummary.isAverageHigh
            ? "border-destructive/50 hover:border-destructive/70"
            : "hover:border-success/30"
        )}>
          <div className={cn(
            "absolute top-0 right-0 w-24 h-24 rounded-bl-full",
            laborCostSummary.isAverageHigh
              ? "bg-gradient-to-bl from-destructive/10 to-transparent"
              : "bg-gradient-to-bl from-success/5 to-transparent"
          )} />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              Labor Cost
              {laborCostSummary.isAverageHigh && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" aria-label="High average rate warning" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">Average hourly rate is unusually high. Check for data entry errors in employee rates.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </CardTitle>
            <div className={cn(
              "p-2 rounded-lg transition-colors",
              laborCostSummary.isAverageHigh
                ? "bg-destructive/10 group-hover:bg-destructive/15"
                : "bg-success/10 group-hover:bg-success/15"
            )}>
              <DollarSign className={cn(
                "h-4 w-4",
                laborCostSummary.isAverageHigh ? "text-destructive" : "text-success"
              )} />
            </div>
          </CardHeader>
          <CardContent>
            {shiftsLoading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <span className="text-3xl font-bold tracking-tight">{laborCostBreakdown.total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>

                {/* Cost breakdown grid */}
                <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary/60" />
                      <span>Hourly</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      ${laborCostBreakdown.hourly.cost.toLocaleString()}
                      <span className="text-muted-foreground ml-1">
                        ({laborCostBreakdown.hourly.hours.toFixed(0)}h)
                      </span>
                    </span>
                  </div>

                  {laborCostBreakdown.hourly.hours > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className="w-3 h-3" />
                        Avg Rate
                      </span>
                      <span className={cn(
                        "font-medium tabular-nums",
                        laborCostSummary.isAverageHigh && 'text-destructive'
                      )}>
                        ${laborCostSummary.averageHourlyRate.toFixed(2)}/hr
                      </span>
                    </div>
                  )}

                  {laborCostBreakdown.salary.cost > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-accent/60" />
                        <span>Salary</span>
                      </span>
                      <span className="font-medium tabular-nums">
                        ${laborCostBreakdown.salary.cost.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {laborCostBreakdown.contractor.cost > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-warning/60" />
                        <span>Contractors</span>
                      </span>
                      <span className="font-medium tabular-nums">
                        ${laborCostBreakdown.contractor.cost.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {laborCostBreakdown.daily_rate.cost > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-info/60" />
                        <span>Daily Rate</span>
                      </span>
                      <span className="font-medium tabular-nums">
                        ${laborCostBreakdown.daily_rate.cost.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Top Earners Breakdown */}
                {laborCostSummary.employeeCosts.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <LaborCostBreakdown
                      employeeCosts={laborCostSummary.employeeCosts}
                      onEditEmployee={handleEditEmployeeById}
                      maxItems={3}
                      showViewAll={false}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Schedule, Time-Off, and Availability */}
      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList className="bg-muted/50 p-1 h-auto gap-1">
          <TabsTrigger
            value="schedule"
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2"
          >
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Schedule</span>
          </TabsTrigger>
          <TabsTrigger
            value="timeoff"
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2"
          >
            <CalendarX className="h-4 w-4" />
            <span className="hidden sm:inline">Time-Off</span>
          </TabsTrigger>
          <TabsTrigger
            value="availability"
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2"
          >
            <CalendarClock className="h-4 w-4" />
            <span className="hidden sm:inline">Availability</span>
          </TabsTrigger>
          <TabsTrigger
            value="trades"
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2 relative"
          >
            <ArrowLeftRight className="h-4 w-4" />
            <span className="hidden sm:inline">Shift Trades</span>
            {pendingTradeCount > 0 && (
              <Badge className="ml-1 h-5 min-w-5 px-1.5 bg-warning text-warning-foreground text-[10px] font-bold animate-pulse">
                {pendingTradeCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule">
          {/* Week Navigation */}
          <Card className="border-border/50 overflow-hidden">
        {/* Navigation Header */}
        <div className="bg-gradient-to-r from-muted/30 via-muted/50 to-muted/30 border-b border-border/50">
          <CardHeader className="py-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Week Navigation */}
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-background rounded-lg border border-border/50 p-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePreviousWeek}
                    aria-label="Previous week"
                    className="h-8 w-8 rounded-md hover:bg-muted"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleToday}
                    className="h-8 px-3 text-xs font-medium hover:bg-primary/10 hover:text-primary"
                  >
                    Today
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNextWeek}
                    aria-label="Next week"
                    className="h-8 w-8 rounded-md hover:bg-muted"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">
                      {format(currentWeekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Week {format(currentWeekStart, 'w')} · {shifts.length} shifts scheduled
                    </p>
                  </div>

                  {!publicationLoading && (
                    <ScheduleStatusBadge
                      isPublished={isPublished}
                      publishedAt={publication?.published_at}
                      locked={isPublished}
                    />
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Position filter */}
                <Select value={positionFilter} onValueChange={(v) => setPositionFilter(v)}>
                  <SelectTrigger
                    id="position-filter"
                    aria-label="Filter by position"
                    className="w-40 h-9 text-xs bg-background"
                  >
                    <SelectValue placeholder={positionsLoading ? 'Loading...' : 'All Positions'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Positions</SelectItem>
                    {positions.map((pos) => (
                      <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="h-6 w-px bg-border hidden sm:block" />

                {/* Publishing buttons */}
                {isPublished ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setChangeLogDialogOpen(true)}
                      className="h-9 text-xs"
                    >
                      <History className="h-3.5 w-3.5 mr-1.5" />
                      Changes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUnpublishDialogOpen(true)}
                      className="h-9 text-xs"
                    >
                      <Unlock className="h-3.5 w-3.5 mr-1.5" />
                      Unpublish
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setPublishDialogOpen(true)}
                    disabled={shifts.length === 0}
                    className="h-9 text-xs bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-sm"
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Publish
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportDialogOpen(true)}
                  disabled={shifts.length === 0}
                  className="h-9 text-xs"
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  Print
                </Button>

                <div className="h-6 w-px bg-border hidden sm:block" />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddEmployee}
                  className="h-9 text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  Employee
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleAddShift()}
                  className="h-9 text-xs shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Shift
                </Button>
              </div>
            </div>
          </CardHeader>
        </div>

        <CardContent className="p-0">
          {employeesLoading || shiftsLoading ? (
            <div className="p-6 space-y-4">
              {SKELETON_ROWS.map((rowKey) => (
                <div key={rowKey} className="flex gap-4">
                  <Skeleton className="h-14 w-48 shrink-0" />
                  {SKELETON_DAYS.map((dayKey) => (
                    <Skeleton key={dayKey} className="h-14 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl animate-pulse" />
                <div className="relative p-4 bg-muted rounded-2xl">
                  <Users className="h-10 w-10 text-muted-foreground" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mt-4 mb-2">No employees yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Get started by adding your first team member to begin creating schedules.
              </p>
              <Button onClick={handleAddEmployee} size="lg" className="shadow-sm">
                <UserPlus className="h-4 w-4 mr-2" />
                Add First Employee
              </Button>
            </div>
          ) : filteredEmployeesWithShifts.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-accent/10 rounded-full blur-xl animate-pulse" />
                <div className="relative p-4 bg-muted rounded-2xl">
                  <Calendar className="h-10 w-10 text-muted-foreground" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mt-4 mb-2">No scheduled shifts</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Create shifts to start building your weekly schedule.
              </p>
              <Button onClick={() => handleAddShift()} size="lg" className="shadow-sm">
                <Plus className="h-4 w-4 mr-2" />
                Create First Shift
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left p-3 font-medium sticky left-0 bg-muted/30 backdrop-blur-sm z-10 min-w-[180px] border-r border-border/30">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">Team Member</span>
                    </th>
                    {weekDays.map((day) => {
                      const dayIsToday = isToday(day);
                      return (
                        <th
                          key={day.toISOString()}
                          className={cn(
                            "text-center p-3 font-medium min-w-[130px] transition-colors",
                            dayIsToday && "bg-primary/5"
                          )}
                        >
                          <div className={cn(
                            "text-xs uppercase tracking-wider",
                            dayIsToday ? "text-primary font-semibold" : "text-muted-foreground"
                          )}>
                            {format(day, 'EEE')}
                          </div>
                          <div className={cn(
                            "text-sm mt-0.5",
                            dayIsToday ? "text-primary font-semibold" : "text-foreground"
                          )}>
                            {format(day, 'MMM d')}
                          </div>
                          {dayIsToday && (
                            <div className="w-1.5 h-1.5 rounded-full bg-primary mx-auto mt-1.5 animate-pulse" />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredEmployeesWithShifts.map((employee, idx) => (
                    <tr
                      key={employee.id}
                      className={cn(
                        "group transition-colors hover:bg-muted/30",
                        idx % 2 === 0 && "bg-muted/10"
                      )}
                    >
                      <td className="p-3 sticky left-0 bg-inherit backdrop-blur-sm z-10 border-r border-border/30">
                        <div className="flex items-center gap-3 justify-between">
                          <div className="flex items-center gap-3">
                            {/* Avatar placeholder */}
                            <div className={cn(
                              "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm",
                              employee.status === 'active'
                                ? "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            )}>
                              {employee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-sm flex items-center gap-2">
                                {employee.name}
                                {employee.status !== 'active' && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-muted">
                                    Inactive
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">{employee.position}</div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditEmployee(employee)}
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10"
                            aria-label={`Edit ${employee.name}`}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      {weekDays.map((day) => {
                        const dayShifts = getShiftsForEmployee(employee.id, day);
                        const dayIsToday = isToday(day);
                        return (
                          <td
                            key={day.toISOString()}
                            className={cn(
                              "p-2 align-top transition-colors",
                              dayIsToday && "bg-primary/5"
                            )}
                          >
                            <div className="space-y-1.5 min-h-[60px]">
                              {dayShifts.map((shift) => (
                                <ShiftCard
                                  key={shift.id}
                                  shift={shift}
                                  onEdit={handleEditShift}
                                  onDelete={handleDeleteShift}
                                />
                              ))}
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "w-full h-8 text-xs border border-dashed border-border/50",
                                  "opacity-0 group-hover:opacity-100 transition-all duration-200",
                                  "hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                                )}
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
          <Card className="border-border/50 overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-muted/30 via-muted/50 to-muted/30 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <CalendarX className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Time-Off Requests</CardTitle>
                    <CardDescription className="text-sm">
                      Review and manage employee time-off requests
                    </CardDescription>
                  </div>
                </div>
                <Button onClick={() => setTimeOffDialogOpen(true)} className="shadow-sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {restaurantId && <TimeOffList restaurantId={restaurantId} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability">
          <Card className="border-border/50 overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-muted/30 via-muted/50 to-muted/30 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent/10">
                    <CalendarClock className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Employee Availability</CardTitle>
                    <CardDescription className="text-sm">
                      Manage recurring weekly availability and one-time exceptions
                    </CardDescription>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setExceptionDialogOpen(true)} className="text-sm">
                    <CalendarX className="h-4 w-4 mr-2" />
                    Add Exception
                  </Button>
                  <Button onClick={() => setAvailabilityDialogOpen(true)} className="shadow-sm text-sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Set Availability
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-12">
              <div className="text-center max-w-md mx-auto">
                <div className="relative inline-block mb-4">
                  <div className="absolute inset-0 bg-accent/10 rounded-full blur-xl" />
                  <div className="relative p-4 bg-muted rounded-2xl">
                    <Clock className="h-8 w-8 text-muted-foreground" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Set employee availability preferences to automatically detect scheduling conflicts.
                  Define recurring patterns for each day of the week.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Shift Trades Tab */}
        <TabsContent value="trades">
          <Card className="border-border/50 overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-muted/30 via-muted/50 to-muted/30 border-b border-border/50 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-warning/10">
                  <ArrowLeftRight className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Shift Trade Requests
                    {pendingTradeCount > 0 && (
                      <Badge className="bg-warning/15 text-warning border border-warning/30 text-xs">
                        {pendingTradeCount} pending
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Review and approve shift swap requests from your team
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <TradeApprovalQueue />
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
        <AlertDialogContent className="border-border/50">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-warning/10">
                <Unlock className="h-5 w-5 text-warning" />
              </div>
              <AlertDialogTitle className="text-lg">Unpublish Schedule</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm leading-relaxed">
              Are you sure you want to unpublish this schedule? This will unlock all shifts for editing
              and notify employees that the schedule has changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublishSchedule}
              className="bg-warning text-warning-foreground hover:bg-warning/90 text-sm shadow-sm"
            >
              <Unlock className="h-4 w-4 mr-2" />
              Unpublish Schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!shiftToDelete} onOpenChange={() => setShiftToDelete(null)}>
        <AlertDialogContent className="border-destructive/20">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <AlertDialogTitle className="text-lg">Delete Shift</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm leading-relaxed">
              Are you sure you want to delete this shift? This action cannot be undone and the
              employee will need to be rescheduled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-sm">Keep Shift</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteShift}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm shadow-sm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recurring Shift Action Dialog */}
      <RecurringShiftActionDialog
        open={recurringActionDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setRecurringActionDialog({ open: false, shift: null, actionType: 'edit' });
          }
        }}
        actionType={recurringActionDialog.actionType}
        shift={recurringActionDialog.shift}
        seriesCount={seriesCount}
        lockedCount={seriesLockedCount}
        onConfirm={handleRecurringActionConfirm}
        isLoading={deleteShiftSeries.isPending || updateShiftSeries.isPending}
      />

      {/* Schedule Export Dialog */}
      <ScheduleExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        shifts={shifts}
        employees={allEmployees}
        weekStart={currentWeekStart}
        weekEnd={weekEnd}
        restaurantName={selectedRestaurant?.restaurant?.name}
        positionFilter={positionFilter}
      />
    </div>
    </FeatureGate>
  );
};

export default Scheduling;
