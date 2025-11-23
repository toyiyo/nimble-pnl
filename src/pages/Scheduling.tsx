import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useShifts, useDeleteShift, useUpdateShift } from '@/hooks/useShifts';
import { useCopyPreviousWeek, useBulkDeleteShifts } from '@/hooks/useShiftTemplates';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { ShiftDialog } from '@/components/ShiftDialog';
import { ShiftTemplatesManager } from '@/components/ShiftTemplatesManager';
import { DroppableScheduleCell } from '@/components/DroppableScheduleCell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DndContext, DragEndEvent, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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
  Copy,
  LayoutTemplate,
  X,
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
  const [selectedShifts, setSelectedShifts] = useState<Set<string>>(new Set());

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  const { employees, loading: employeesLoading } = useEmployees(restaurantId);
  const { shifts, loading: shiftsLoading } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const deleteShift = useDeleteShift();
  const updateShift = useUpdateShift();
  const copyPreviousWeek = useCopyPreviousWeek();
  const bulkDeleteShifts = useBulkDeleteShifts();

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement required before drag starts
      },
    })
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

  const handleCopyPreviousWeek = () => {
    if (!restaurantId) return;
    
    copyPreviousWeek.mutate({
      restaurantId,
      targetWeekStart: currentWeekStart,
    });
  };

  const handleSelectShift = (shift: Shift, isMultiSelect: boolean) => {
    setSelectedShifts(prev => {
      const newSet = new Set(prev);
      if (isMultiSelect) {
        // Toggle selection
        if (newSet.has(shift.id)) {
          newSet.delete(shift.id);
        } else {
          newSet.add(shift.id);
        }
      } else {
        // Single selection
        newSet.clear();
        newSet.add(shift.id);
      }
      return newSet;
    });
  };

  const handleClearSelection = () => {
    setSelectedShifts(new Set());
  };

  const handleBulkDelete = () => {
    if (!restaurantId || selectedShifts.size === 0) return;
    
    bulkDeleteShifts.mutate(
      { shiftIds: Array.from(selectedShifts), restaurantId },
      {
        onSuccess: () => {
          setSelectedShifts(new Set());
        },
      }
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !restaurantId) return;

    const activeShift = shifts.find(s => s.id === active.id);
    if (!activeShift) return;

    // Parse the drop target data
    const overData = over.data.current as { employeeId: string; date: string } | undefined;
    if (!overData) return;

    const { employeeId: newEmployeeId, date: newDateStr } = overData;
    const newDate = new Date(newDateStr);

    // Check if anything changed
    const oldDate = new Date(activeShift.start_time);
    const isSameEmployee = activeShift.employee_id === newEmployeeId;
    const isSameDate = isSameDay(oldDate, newDate);

    if (isSameEmployee && isSameDate) return;

    // Calculate new start and end times
    const startTime = new Date(activeShift.start_time);
    const endTime = new Date(activeShift.end_time);
    
    const newStartTime = new Date(newDate);
    newStartTime.setHours(startTime.getHours(), startTime.getMinutes(), startTime.getSeconds());
    
    const newEndTime = new Date(newDate);
    newEndTime.setHours(endTime.getHours(), endTime.getMinutes(), endTime.getSeconds());

    // Update the shift
    updateShift.mutate({
      id: activeShift.id,
      employee_id: newEmployeeId,
      start_time: newStartTime.toISOString(),
      end_time: newEndTime.toISOString(),
      restaurant_id: activeShift.restaurant_id,
      break_duration: activeShift.break_duration,
      position: activeShift.position,
      status: activeShift.status,
      notes: activeShift.notes,
    });
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

      {/* Main Content with Tabs */}
      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList>
          <TabsTrigger value="schedule">
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="h-4 w-4 mr-2" />
            Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-4">
          {/* Week Navigation */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
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
                <div className="flex gap-2 flex-wrap">
                  {selectedShifts.size > 0 && (
                    <>
                      <Badge variant="secondary" className="flex items-center gap-2">
                        {selectedShifts.size} selected
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0 hover:bg-transparent"
                          onClick={handleClearSelection}
                          aria-label="Clear selection"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                      <Button 
                        variant="destructive"
                        size="sm"
                        onClick={handleBulkDelete}
                        disabled={bulkDeleteShifts.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Selected
                      </Button>
                    </>
                  )}
                  <Button 
                    variant="outline" 
                    onClick={handleCopyPreviousWeek}
                    disabled={copyPreviousWeek.isPending}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {copyPreviousWeek.isPending ? 'Copying...' : 'Copy Previous Week'}
                  </Button>
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
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
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
                                <DroppableScheduleCell
                                  key={day.toISOString()}
                                  employeeId={employee.id}
                                  date={day}
                                  shifts={dayShifts}
                                  onAddShift={handleAddShift}
                                  onEditShift={handleEditShift}
                                  onDeleteShift={handleDeleteShift}
                                  selectedShifts={selectedShifts}
                                  onSelectShift={handleSelectShift}
                                />
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DndContext>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          {restaurantId && <ShiftTemplatesManager restaurantId={restaurantId} />}
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
