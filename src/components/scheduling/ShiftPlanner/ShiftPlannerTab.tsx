import { useState, useCallback, useMemo } from 'react';

import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, CalendarOff, Users, X } from 'lucide-react';

import { useShiftPlanner, buildTemplateGridData, getActiveDaysForWeek } from '@/hooks/useShiftPlanner';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

import type { ShiftTemplate, ConflictCheck } from '@/types/scheduling';
import type { ShiftCreateInput } from '@/hooks/useShiftPlanner';
import type { ValidationIssue } from '@/lib/shiftValidator';

import { cn } from '@/lib/utils';

import { AssignmentPopover } from './AssignmentPopover';

import { PlannerHeader } from './PlannerHeader';
import { StaffingOverlay } from './StaffingOverlay';
import { TemplateGrid } from './TemplateGrid';
import { EmployeeSidebar } from './EmployeeSidebar';
import { TemplateFormDialog } from './TemplateFormDialog';
import { DragOverlayChip } from './DragOverlayChip';
import { PlannerExportDialog } from './PlannerExportDialog';
import { AvailabilityConflictDialog } from './AvailabilityConflictDialog';
import type { ConflictDialogData } from './AvailabilityConflictDialog';
import { useGenerateSchedule } from '@/hooks/useGenerateSchedule';
import { GenerateScheduleDialog } from './GenerateScheduleDialog';

interface ShiftPlannerTabProps {
  restaurantId: string;
}

export function ShiftPlannerTab({
  restaurantId,
}: Readonly<ShiftPlannerTabProps>) {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantName = selectedRestaurant?.restaurant?.name;
  const isMobile = useIsMobile();

  const {
    weekStart,
    weekEnd,
    weekDays,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    shifts,
    employees,
    isLoading,
    error,
    validateAndCreate,
    forceCreate,
    deleteShift,
    validationResult,
    clearValidation,
    totalHours,
  } = useShiftPlanner(restaurantId);

  const {
    templates,
    loading: templatesLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useShiftTemplates(restaurantId);

  // Compute template grid data
  const templateGridData = useMemo(
    () => buildTemplateGridData(shifts, templates, weekDays),
    [shifts, templates, weekDays],
  );

  // Dialog state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | undefined>();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const generateSchedule = useGenerateSchedule();

  const { toast } = useToast();
  const [highlightCellId, setHighlightCellId] = useState<string | null>(null);
  const [activeDragEmployee, setActiveDragEmployee] = useState<{ id: string; name: string } | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<{
    employee: { id: string; name: string };
    template: ShiftTemplate;
    day: string;
  } | null>(null);

  // Mobile sidebar toggle and tap-to-assign flow
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedMobileEmployee, setSelectedMobileEmployee] = useState<{ id: string; name: string } | null>(null);

  const [conflictDialogData, setConflictDialogData] = useState<ConflictDialogData | null>(null);
  const [conflictPendingInputs, setConflictPendingInputs] = useState<ShiftCreateInput[]>([]);
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';

  // Derive unique positions from employees and templates
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    for (const emp of employees) {
      if (emp.position) posSet.add(emp.position);
    }
    for (const t of templates) {
      if (t.position) posSet.add(t.position);
    }
    return Array.from(posSet).sort((a, b) => a.localeCompare(b));
  }, [employees, templates]);

  // DnD setup — PointerSensor for mouse, TouchSensor for touch devices
  // TouchSensor uses press-and-hold (200ms) to distinguish drag from scroll
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const employee = event.active.data.current?.employee;
    if (employee) {
      setActiveDragEmployee({ id: employee.id, name: employee.name });
      // Auto-close mobile sidebar so the grid is visible for dropping
      setMobileSidebarOpen(false);
    }
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDragEmployee(null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragEmployee(null);
    const { active, over } = event;
    if (!over) return;

    const employee = active.data.current?.employee;
    if (!employee) return;

    const [templateId, day] = String(over.id).split(':');
    if (!templateId || !day) return;

    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    setPendingAssignment({ employee: { id: employee.id, name: employee.name }, template, day });
  }, [templates]);

  // Mobile tap-to-assign: select employee from sidebar
  const handleMobileEmployeeSelect = useCallback((employee: { id: string; name: string }) => {
    setSelectedMobileEmployee(employee);
    setMobileSidebarOpen(false);
  }, []);

  // Mobile tap-to-assign: tap a cell to assign the selected employee
  const handleMobileCellTap = useCallback((templateId: string, day: string) => {
    if (!selectedMobileEmployee) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setPendingAssignment({ employee: selectedMobileEmployee, template, day });
    setSelectedMobileEmployee(null);
  }, [selectedMobileEmployee, templates]);

  // Clear mobile selection
  const clearMobileSelection = useCallback(() => {
    setSelectedMobileEmployee(null);
  }, []);

  const handleAssignDay = useCallback(async () => {
    if (!pendingAssignment) return;
    const { employee, template, day } = pendingAssignment;
    setPendingAssignment(null);

    const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
    const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

    const input: ShiftCreateInput = {
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
    };

    const result = await validateAndCreate(input);

    if (result.created) {
      clearValidation();
      setHighlightCellId(`${template.id}:${day}`);
      setTimeout(() => setHighlightCellId(null), 600);
      const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      toast({ title: `${employee.name} assigned to ${template.name} — ${dayLabel}` });
    } else if (result.pendingConflicts?.length || result.pendingWarnings?.length) {
      setConflictDialogData({
        employeeName: employee.name,
        conflicts: result.pendingConflicts || [],
        warnings: result.pendingWarnings || [],
      });
      setConflictPendingInputs([input]);
    }
  }, [pendingAssignment, validateAndCreate, clearValidation, toast]);

  const handleAssignAll = useCallback(async () => {
    if (!pendingAssignment) return;
    const { employee, template } = pendingAssignment;
    setPendingAssignment(null);

    const activeDays = getActiveDaysForWeek(template, weekDays);
    const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
    const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

    const allInputs: ShiftCreateInput[] = activeDays.map((day) => ({
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
    }));

    const allConflicts: ConflictCheck[] = [];
    const allWarnings: ValidationIssue[] = [];
    const conflictedInputs: ShiftCreateInput[] = [];
    let createdCount = 0;

    for (const input of allInputs) {
      const result = await validateAndCreate(input);
      if (result.created) {
        createdCount++;
      } else if (result.pendingConflicts?.length || result.pendingWarnings?.length) {
        allConflicts.push(...(result.pendingConflicts || []));
        allWarnings.push(...(result.pendingWarnings || []));
        conflictedInputs.push(input);
      }
    }

    if (conflictedInputs.length > 0) {
      setConflictDialogData({
        employeeName: employee.name,
        conflicts: allConflicts,
        warnings: allWarnings,
      });
      setConflictPendingInputs(conflictedInputs);
      if (createdCount > 0) {
        toast({ title: `${createdCount} day(s) assigned, ${conflictedInputs.length} day(s) need confirmation` });
      }
    } else {
      clearValidation();
      toast({
        title: `${employee.name} assigned to ${template.name} — ${createdCount}/${allInputs.length} days`,
      });
    }
  }, [pendingAssignment, weekDays, validateAndCreate, clearValidation, toast]);

  const handleCancelAssignment = useCallback(() => {
    setPendingAssignment(null);
  }, []);

  const handleConflictConfirm = useCallback(async () => {
    let successCount = 0;
    for (const input of conflictPendingInputs) {
      const success = await forceCreate(input);
      if (success) successCount++;
    }
    setConflictDialogData(null);
    setConflictPendingInputs([]);
    clearValidation();
    if (successCount > 0) {
      toast({ title: `${successCount} shift${successCount > 1 ? 's' : ''} assigned despite warnings` });
    }
  }, [conflictPendingInputs, forceCreate, clearValidation, toast]);

  const handleConflictCancel = useCallback(() => {
    setConflictDialogData(null);
    setConflictPendingInputs([]);
  }, []);

  const activeDayCount = useMemo(
    () => pendingAssignment ? getActiveDaysForWeek(pendingAssignment.template, weekDays).length : 0,
    [pendingAssignment, weekDays],
  );

  // Template CRUD handlers
  const handleAddTemplate = useCallback(() => {
    setEditingTemplate(undefined);
    setTemplateDialogOpen(true);
  }, []);

  const handleEditTemplate = useCallback((template: ShiftTemplate) => {
    setEditingTemplate(template);
    setTemplateDialogOpen(true);
  }, []);

  const handleTemplateSubmit = useCallback(async (data: {
    name: string;
    start_time: string;
    end_time: string;
    position: string;
    days: number[];
    break_duration: number;
  }) => {
    if (editingTemplate) {
      await updateTemplate({ id: editingTemplate.id, ...data });
    } else {
      await createTemplate({
        ...data,
        restaurant_id: restaurantId,
        is_active: true,
      });
    }
  }, [editingTemplate, createTemplate, updateTemplate, restaurantId]);

  const handleExport = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  const handleGenerate = useCallback((excludedEmployeeIds: string[], lockedShiftIds: string[]) => {
    if (!restaurantId) return;
    const weekStartStr = weekDays[0]; // Already a YYYY-MM-DD string
    generateSchedule.mutate(
      {
        restaurantId,
        restaurantTimezone,
        weekStart: weekStartStr,
        lockedShiftIds,
        excludedEmployeeIds,
      },
      {
        onSuccess: () => setGenerateDialogOpen(false),
      },
    );
  }, [restaurantId, restaurantTimezone, weekDays, generateSchedule]);

  // Loading state
  if (isLoading || templatesLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
          <CalendarOff className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-[15px] font-medium text-foreground">Failed to load schedule</p>
        <p className="text-[13px] text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  // Empty state -- no employees
  if (!employees.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-[15px] font-medium text-foreground">No employees found</p>
        <p className="text-[13px] text-muted-foreground mt-1">Add employees to start building your schedule.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PlannerHeader
        weekStart={weekStart}
        weekEnd={weekEnd}
        totalHours={totalHours}
        onPrevWeek={goToPrevWeek}
        onNextWeek={goToNextWeek}
        onToday={goToToday}
        onExport={handleExport}
        onGenerate={() => setGenerateDialogOpen(true)}
        isGenerating={generateSchedule.isPending}
      />

      {/* Validation alerts */}
      {validationResult && !validationResult.valid && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="space-y-1">
            {validationResult.errors.map((err) => (
              <p key={err.code} className="text-[13px] text-destructive">{err.message}</p>
            ))}
          </div>
        </div>
      )}

      {/* Staffing suggestions overlay */}
      <StaffingOverlay restaurantId={restaurantId} weekDays={weekDays} />

      {/* Two-panel layout */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="relative flex gap-0">
          <div className="flex-1 min-w-0 overflow-x-auto">
            {templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-border/40">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                  <CalendarOff className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-[15px] font-medium text-foreground">No shift templates yet</p>
                <p className="text-[13px] text-muted-foreground mt-1">Create templates to start building your schedule.</p>
                <button
                  onClick={handleAddTemplate}
                  className="mt-4 h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                  aria-label="Add shift template"
                >
                  Add Shift Template
                </button>
              </div>
            ) : (
              <TemplateGrid
                weekDays={weekDays}
                templates={templates}
                gridData={templateGridData}
                onRemoveShift={deleteShift}
                onEditTemplate={handleEditTemplate}
                onDeleteTemplate={deleteTemplate}
                onAddTemplate={handleAddTemplate}
                highlightCellId={highlightCellId}
                onMobileCellTap={isMobile ? handleMobileCellTap : undefined}
                hasMobileSelection={isMobile && !!selectedMobileEmployee}
              />
            )}
          </div>

          {/* Desktop: inline sidebar */}
          {!isMobile && (
            <EmployeeSidebar employees={employees} shifts={shifts} />
          )}

          {/* Mobile: slide-in sidebar panel (single instance to avoid duplicate dnd IDs) */}
          {isMobile && (
            <>
              {mobileSidebarOpen && (
                <div
                  className="fixed inset-0 z-40 bg-black/20"
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-hidden="true"
                />
              )}
              <div
                className={cn(
                  'fixed top-0 right-0 bottom-0 z-50 w-[260px] bg-background border-l border-border/40 shadow-xl transition-transform duration-200 ease-out',
                  mobileSidebarOpen ? 'translate-x-0' : 'translate-x-full',
                )}
              >
                <div className="flex items-center justify-between p-3 border-b border-border/40">
                  <h3 className="text-[13px] font-semibold text-foreground">Team</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setMobileSidebarOpen(false)}
                    aria-label="Close employee panel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <EmployeeSidebar employees={employees} shifts={shifts} className="w-full border-l-0" onEmployeeSelect={handleMobileEmployeeSelect} />
              </div>
            </>
          )}
        </div>

        {/* Mobile: selected employee banner */}
        {isMobile && selectedMobileEmployee && (
          <div className="fixed bottom-20 left-4 right-4 z-30 flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-foreground text-background shadow-lg">
            <span className="text-[13px] font-medium">
              Tap a cell to assign <strong>{selectedMobileEmployee.name}</strong>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-background hover:text-background/70 shrink-0"
              onClick={clearMobileSelection}
              aria-label="Cancel selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Mobile: floating Team button */}
        {isMobile && !mobileSidebarOpen && !selectedMobileEmployee && (
          <Button
            className="fixed bottom-20 right-4 z-30 h-12 w-12 rounded-full shadow-lg bg-foreground text-background hover:bg-foreground/90"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Show team members"
          >
            <Users className="h-5 w-5" />
          </Button>
        )}

        <DragOverlay dropAnimation={null}>
          {activeDragEmployee ? (
            <DragOverlayChip name={activeDragEmployee.name} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Template form dialog */}
      <TemplateFormDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        template={editingTemplate}
        onSubmit={handleTemplateSubmit}
        positions={positions}
      />

      {/* Assignment popover — shown after dropping an employee onto a shift cell */}
      {pendingAssignment && (
        <AssignmentPopover
          open={true}
          employeeName={pendingAssignment.employee.name}
          shiftName={pendingAssignment.template.name}
          activeDayCount={activeDayCount}
          onAssignDay={handleAssignDay}
          onAssignAll={handleAssignAll}
          onCancel={handleCancelAssignment}
        />
      )}

      {/* Export dialog */}
      <PlannerExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        shifts={shifts}
        templates={templates}
        restaurantName={restaurantName}
        weekDays={weekDays}
      />

      {/* Availability conflict confirmation dialog */}
      <AvailabilityConflictDialog
        open={conflictDialogData !== null}
        data={conflictDialogData}
        timezone={restaurantTimezone}
        onConfirm={handleConflictConfirm}
        onCancel={handleConflictCancel}
      />

      {/* Generate schedule with AI dialog */}
      <GenerateScheduleDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        employees={employees ?? []}
        existingShifts={shifts}
        weekStart={weekStart}
        weekEnd={weekEnd}
        isGenerating={generateSchedule.isPending}
        onGenerate={handleGenerate}
      />

    </div>
  );
}
