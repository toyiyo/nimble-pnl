import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useShifts, useDeleteShift } from '@/hooks/useShifts';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { ShiftDialog } from '@/components/ShiftDialog';
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
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { Employee, Shift } from '@/types/scheduling';
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

const Scheduling = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>();
  const [selectedShift, setSelectedShift] = useState<Shift | undefined>();
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [defaultShiftDate, setDefaultShiftDate] = useState<Date | undefined>();

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  const { employees, loading: employeesLoading } = useEmployees(restaurantId);
  const { shifts, loading: shiftsLoading } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const deleteShift = useDeleteShift();

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
            </div>
            <div className="flex gap-2">
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
                                <div
                                  key={shift.id}
                                  className="group relative p-2 rounded border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                                  onClick={() => handleEditShift(shift)}
                                >
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
                                        handleEditShift(shift);
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
                                        handleDeleteShift(shift);
                                      }}
                                      aria-label="Delete shift"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
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
        </>
      )}

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
