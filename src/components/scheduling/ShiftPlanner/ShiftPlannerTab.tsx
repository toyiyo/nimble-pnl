import { useState, useCallback, useMemo } from 'react';

import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core';

import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, CalendarOff, Users } from 'lucide-react';

import { useShiftPlanner, buildTemplateGridData } from '@/hooks/useShiftPlanner';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { useToast } from '@/hooks/use-toast';

import type { ShiftTemplate } from '@/types/scheduling';

import { PlannerHeader } from './PlannerHeader';
import { TemplateGrid } from './TemplateGrid';
import { EmployeeSidebar } from './EmployeeSidebar';
import { TemplateFormDialog } from './TemplateFormDialog';
import { DragOverlayChip } from './DragOverlayChip';

interface ShiftPlannerTabProps {
  restaurantId: string;
}

export function ShiftPlannerTab({
  restaurantId,
}: Readonly<ShiftPlannerTabProps>) {
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

  const { toast } = useToast();
  const [highlightCellId, setHighlightCellId] = useState<string | null>(null);
  const [activeDragEmployee, setActiveDragEmployee] = useState<{ id: string; name: string } | null>(null);

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

  // DnD setup
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const employee = event.active.data.current?.employee;
    if (employee) {
      setActiveDragEmployee({ id: employee.id, name: employee.name });
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

    // over.id is "templateId:day"
    const [templateId, day] = String(over.id).split(':');
    if (!templateId || !day) return;

    // Find the template to get times and position
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
    const endHHMM = template.end_time.split(':').slice(0, 2).join(':');

    const success = await validateAndCreate({
      employeeId: employee.id,
      date: day,
      startTime: startHHMM,
      endTime: endHHMM,
      position: template.position,
      breakDuration: template.break_duration,
    });

    if (success) {
      clearValidation();

      // Cell highlight
      const cellId = `${templateId}:${day}`;
      setHighlightCellId(cellId);
      setTimeout(() => setHighlightCellId(null), 600);

      // Toast
      const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      toast({
        title: `${employee.name} assigned to ${template.name} — ${dayLabel}`,
      });
    }
  }, [templates, validateAndCreate, clearValidation, toast]);

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

      {/* Two-panel layout */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-0">
          <div className="flex-1 min-w-0">
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
              />
            )}
          </div>
          <EmployeeSidebar employees={employees} shifts={shifts} />
        </div>
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
    </div>
  );
}
