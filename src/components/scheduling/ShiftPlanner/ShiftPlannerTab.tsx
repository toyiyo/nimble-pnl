import { useState, useCallback, useMemo } from 'react';

import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

import { AlertCircle, CalendarOff, ChevronDown, EyeOff, TrendingUp, Users, X } from 'lucide-react';

import {
  useShiftPlanner,
  buildTemplateGridData,
  getActiveDaysForWeek,
  groupUnmatchedByArea,
  partitionTemplatesForDisplay,
  collectHiddenLane,
} from '@/hooks/useShiftPlanner';
import { useShiftTemplates, templateAppliesToDay } from '@/hooks/useShiftTemplates';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePlannerShiftsIndex } from '@/hooks/usePlannerShiftsIndex';

import type { Shift, ShiftTemplate, ConflictCheck, SlotCoverage, CoverageShift } from '@/types/scheduling';
import type { ShiftCreateInput } from '@/hooks/useShiftPlanner';
import type { ValidationIssue } from '@/lib/shiftValidator';

import { computeCellFill } from '@/lib/shiftFill';
import { computeLoanedOut, assignLoanedOutCell } from '@/lib/loanedOut';
import { formatLocalDateInTz } from '@/lib/shiftInterval';

import { cn } from '@/lib/utils';
import { getTemplateAreas } from '@/lib/templateAreaGrouping';
import { computeAllocationStatuses, type AllocationStatus } from '@/lib/shiftAllocation';

import { AssignmentPopover } from './AssignmentPopover';
import { AreaFilterPills } from './AreaFilterPills';
import { CoverageDetail } from './CoverageDetail';
import { CoverageStrip } from './CoverageStrip';
import { ScheduleOverviewPanel } from './ScheduleOverviewPanel';

import { PlannerHeader } from './PlannerHeader';
import { StaffingOverlay } from './StaffingOverlay';
import { LaborEfficiencyPanel } from './LaborEfficiencyPanel';
import { TemplateGrid } from './TemplateGrid';
import { EmployeeSidebar } from './EmployeeSidebar';
import { TemplateFormDialog } from './TemplateFormDialog';
import { DragOverlayChip } from './DragOverlayChip';
import { PlannerExportDialog } from './PlannerExportDialog';
import { AvailabilityConflictDialog } from './AvailabilityConflictDialog';
import type { ConflictDialogData } from './AvailabilityConflictDialog';
import { useGenerateSchedule } from '@/hooks/useGenerateSchedule';
import type { GenerateScheduleResponse } from '@/hooks/useGenerateSchedule';
import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';
import { computeEffectiveAvailability } from '@/lib/effectiveAvailability';
import { GenerateScheduleDialog } from './GenerateScheduleDialog';
import { ShiftTimelineTab } from '../ShiftTimeline/ShiftTimelineTab';

interface ShiftPlannerTabProps {
  restaurantId: string;
  weekStart: Date;
  onWeekStartChange: (next: Date) => void;
}

/** Format a template's slot label for CoverageDetail headings.
 *  e.g. "Cold Stone · Server · 10:00–16:30" or "Server · 10:00–16:30 (all areas)". */
function buildSlotLabel(t: ShiftTemplate): string {
  const timeRange = `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`;
  return t.area
    ? `${t.area} · ${t.position} · ${timeRange}`
    : `${t.position} · ${timeRange} (all areas)`;
}

/** Toolbar pill that toggles ghost-row visibility for hidden templates. */
function HiddenTemplatesToggle({
  count,
  showHidden,
  onToggle,
}: Readonly<{ count: number; showHidden: boolean; onToggle: () => void }>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={showHidden}
      aria-label={`${showHidden ? 'Hide' : 'Show'} hidden templates (${count})`}
      className={cn(
        'h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors',
        showHidden
          ? 'bg-foreground text-background hover:bg-foreground/90'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
      )}
    >
      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      Hidden
      <span className={cn(
        'text-[11px] px-1.5 py-0.5 rounded-md',
        showHidden ? 'bg-background/20' : 'bg-muted',
      )}
      >
        {count}
      </span>
    </button>
  );
}

export function ShiftPlannerTab({
  restaurantId,
  weekStart: externalWeekStart,
  onWeekStartChange,
}: Readonly<ShiftPlannerTabProps>) {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantName = selectedRestaurant?.restaurant?.name;
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
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
  } = useShiftPlanner(restaurantId, {
    externalWeekStart,
    onExternalWeekStartChange: onWeekStartChange,
  });

  const {
    templates: allTemplates,
    loading: templatesLoading,
    createTemplate,
    updateTemplate,
    hideTemplate,
    restoreTemplate,
  } = useShiftTemplates(restaurantId, { status: 'all' });

  // View filter — never persisted (CLAUDE.md: no manual caching). Determines whether
  // hidden (is_active === false) template rows render inline in the grid.
  const [showHidden, setShowHidden] = useState(false);

  const { activeTemplates, hiddenTemplates, displayTemplates } = useMemo(
    () => partitionTemplatesForDisplay(allTemplates, showHidden),
    [allTemplates, showHidden],
  );

  // `templates` is the math-facing name used throughout this component's existing
  // coverage/allocation/position derivations below — always active-only so hiding a
  // template can never change labor numbers or open-shift affordances.
  const templates = activeTemplates;

  const handleShowHidden = useCallback(() => setShowHidden(true), []);
  const handleToggleShowHidden = useCallback(() => setShowHidden((prev) => !prev), []);

  const { availability, loading: availabilityLoading } = useEmployeeAvailability(restaurantId);
  const { exceptions } = useAvailabilityExceptions(restaurantId);

  // Per-employee effective availability (recurring + exception overrides) for the
  // visible week — feeds the sidebar strip tint and timeline outside-availability
  // marker (Tasks 5–7). Computed once here so both consumers can't drift apart.
  const availabilityByEmployee = useMemo(
    () =>
      computeEffectiveAvailability(
        availability,
        exceptions,
        weekStart,
        employees.map((e) => e.id),
      ),
    [availability, exceptions, weekStart, employees],
  );

  // Compute template grid data — built with ALL templates (active + hidden) so a
  // hidden template's FK-linked shifts keep bucketing under it (not `__unmatched__`).
  const templateGridData = useMemo(
    () => buildTemplateGridData(shifts, allTemplates, weekDays, restaurantTimezone),
    [shifts, allTemplates, weekDays, restaurantTimezone],
  );

  // Derive coverage index for CoverageStrip and overview panel
  const { coverageByDay, overviewDays, shiftsByEmployee } = usePlannerShiftsIndex(shifts, weekDays);

  // Dialog state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | undefined>();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerateScheduleResponse | null>(null);
  const [generationError, setGenerationError] = useState<Error | null>(null);
  const generateSchedule = useGenerateSchedule();

  const { toast } = useToast();
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
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

  // Tab-level coverage Map: Map<templateId, Map<day, SlotCoverage>>
  // Per-slot try/catch so one bad row never blanks the whole grid.
  //
  // Fill (openSpots/coveragePct/segments/coveringEmployees) is computed per
  // template from its own templateGridData bucket via computeCellFill — a
  // same-position shift belonging to a *different* template can never leak
  // into this cell's count (the bug this fixes; see design doc). loanedOut
  // is computed separately via computeLoanedOut, which genuinely needs the
  // whole-floor shift set for the day (loans are only visible by comparing
  // home area against work area across all of that day's shifts).
  const coverageByTemplateDay = useMemo(() => {
    // Area source: for template-bound shifts (shift_template_id set), the template's area
    // is authoritative — an employee assigned cross-area should count toward the template's
    // area cell, not their home area. For unbound/legacy shifts, fall back to the joined
    // employee row so inactive/terminated employees' shifts still carry their area.
    const templateAreaMap = new Map<string, string | null>(
      templates.map((t) => [t.id, t.area || null]),
    );
    const toCoverageShift = (s: Shift): CoverageShift => ({
      employee_id: s.employee_id,
      employee_name: s.employee?.name ?? null,
      start_time: s.start_time,
      end_time: s.end_time,
      position: s.position,
      status: s.status,
      area: s.shift_template_id
        ? (templateAreaMap.get(s.shift_template_id) ?? s.employee?.area ?? null)
        : (s.employee?.area ?? null),
      homeArea: s.employee?.area ?? null,
    });

    // Whole-floor shifts pre-grouped by restaurant-local day, once —
    // computeLoanedOut needs the whole-floor set per day, but every template
    // on that day can reuse the same list instead of re-scanning the whole
    // week each time. Bucketed with formatLocalDateInTz (restaurant timezone),
    // not formatLocalDate (browser timezone): `day` here must line up with
    // `weekDays`/the belongs() predicate's restaurant-local calendar date, or
    // a shift near local midnight can land in the wrong day's bucket when the
    // viewer's browser timezone differs from the restaurant's.
    // Cache each shift's CoverageShift by object identity alongside it (stable
    // within this memo — templateGridData's buckets hold these same `shifts`
    // object references) so a template's bucket below reuses the conversion
    // instead of re-running toCoverageShift on the same shift a second time.
    const wholeFloorByDay = new Map<string, CoverageShift[]>();
    const shiftToCoverage = new Map<Shift, CoverageShift>();
    for (const s of shifts) {
      const dayStr = formatLocalDateInTz(new Date(s.start_time), restaurantTimezone);
      const list = wholeFloorByDay.get(dayStr);
      const cs = toCoverageShift(s);
      shiftToCoverage.set(s, cs);
      if (list) list.push(cs);
      else wholeFloorByDay.set(dayStr, [cs]);
    }

    const map = new Map<string, Map<string, SlotCoverage>>();
    for (const t of templates) {
      const inner = new Map<string, SlotCoverage>();
      const bucketByDay = templateGridData.get(t.id);
      for (const day of weekDays) {
        if (!templateAppliesToDay(t, day)) continue;
        try {
          const bucketShifts = (bucketByDay?.get(day) ?? []).map(
            (s) => shiftToCoverage.get(s) ?? toCoverageShift(s),
          );
          const fill = computeCellFill(bucketShifts, t.capacity ?? 1, {
            position: t.position,
            tz: restaurantTimezone,
            dateStr: day,
            windowStart: t.start_time,
            windowEnd: t.end_time,
          });
          const loanedOut = computeLoanedOut(wholeFloorByDay.get(day) ?? [], {
            position: t.position,
            tz: restaurantTimezone,
            dateStr: day,
            windowStart: t.start_time,
            windowEnd: t.end_time,
            area: t.area || null,
          });
          inner.set(day, { ...fill, loanedOut });
        } catch {
          // one bad row never blanks the grid
        }
      }
      map.set(t.id, inner);
    }
    return map;
  }, [shifts, templates, weekDays, restaurantTimezone, templateGridData]);

  // Ghost map: de-duped loaned-out employees keyed `${templateId}:${day}`
  const ghostByCell = useMemo(() => {
    const startById = new Map(templates.map((t) => [t.id, t.start_time]));
    return assignLoanedOutCell(coverageByTemplateDay, startById);
  }, [coverageByTemplateDay, templates]);

  // Off-template lane: unmatched shifts grouped by employee area → day
  const offTemplateByArea = useMemo(
    () => groupUnmatchedByArea(templateGridData.get('__unmatched__') ?? new Map()),
    [templateGridData],
  );

  // "From hidden templates" lane: only needed when hidden rows are NOT shown inline
  // (showHidden === false). Merges every hidden template's grid bucket into one
  // Map<day, Shift[]>, honoring the current area filter.
  const hiddenLaneByDay = useMemo(() => {
    if (showHidden) return undefined;
    return collectHiddenLane(templateGridData, hiddenTemplates, areaFilter);
  }, [showHidden, templateGridData, hiddenTemplates, areaFilter]);

  // Lifted coverage detail state — single Popover/Drawer instance (Single Dialog Pattern)
  const [coverageDetail, setCoverageDetail] = useState<{ templateId: string; day: string; anchorRect?: DOMRect } | null>(null);

  const handleCoverageClick = useCallback((templateId: string, day: string, rect?: DOMRect) => {
    setCoverageDetail({ templateId, day, anchorRect: rect });
  }, []);

  const handleCoverageClose = useCallback(() => {
    setCoverageDetail(null);
  }, []);

  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | null>(null);

  const allocationStatuses = useMemo<Map<string, AllocationStatus> | undefined>(() => {
    if (!pickedEmployeeId) return undefined;
    const employeeShifts = shiftsByEmployee.get(pickedEmployeeId) ?? [];
    return computeAllocationStatuses(employeeShifts, templates, weekDays);
  }, [pickedEmployeeId, shiftsByEmployee, templates, weekDays]);

  const pickedEmployeeName = useMemo(() => {
    if (!pickedEmployeeId) return undefined;
    return employees.find((e) => e.id === pickedEmployeeId)?.name;
  }, [pickedEmployeeId, employees]);

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

  const templateAreas = useMemo(() => getTemplateAreas(templates), [templates]);
  const hasUnassigned = useMemo(() => templates.some((t) => !t.area), [templates]);

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
      setPickedEmployeeId(employee.id);
      setMobileSidebarOpen(false);
    }
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDragEmployee(null);
    setPickedEmployeeId(null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragEmployee(null);
    setPickedEmployeeId(null);
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
    setPickedEmployeeId(employee.id);
    setMobileSidebarOpen(false);
  }, []);

  // Mobile tap-to-assign: tap a cell to assign the selected employee
  const handleMobileCellTap = useCallback((templateId: string, day: string) => {
    if (!selectedMobileEmployee) return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setPendingAssignment({ employee: selectedMobileEmployee, template, day });
    setSelectedMobileEmployee(null);
    setPickedEmployeeId(null);
  }, [selectedMobileEmployee, templates]);

  // Clear mobile selection
  const clearMobileSelection = useCallback(() => {
    setSelectedMobileEmployee(null);
    setPickedEmployeeId(null);
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
      shiftTemplateId: template.id,
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
      shiftTemplateId: template.id,
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

  // Plan | Timeline view toggle
  const [view, setView] = useState<'plan' | 'timeline'>('plan');

  // Labor efficiency (SPLH) panel — collapsed by default
  const [laborEffOpen, setLaborEffOpen] = useState(false);

  // Template CRUD handlers
  const handleAddTemplate = useCallback(() => {
    setEditingTemplate(undefined);
    setTemplateDialogOpen(true);
  }, []);

  const handleEditTemplate = useCallback((template: ShiftTemplate) => {
    setEditingTemplate(template);
    setTemplateDialogOpen(true);
  }, []);

  // Hide/restore handlers — hide computes the current week's real kept-shift count
  // from templateGridData (built with all templates) so the toast/undo description
  // reflects what's actually about to be ghosted, not a placeholder.
  const handleHideTemplate = useCallback((template: ShiftTemplate) => {
    const byDay = templateGridData.get(template.id);
    const keptShiftCount = byDay
      ? Array.from(byDay.values()).reduce((sum, dayShifts) => sum + dayShifts.length, 0)
      : 0;
    hideTemplate({ id: template.id, name: template.name, keptShiftCount });
  }, [templateGridData, hideTemplate]);

  const handleRestoreTemplate = useCallback((templateId: string) => {
    restoreTemplate(templateId);
  }, [restoreTemplate]);

  const handleTemplateSubmit = useCallback(async (data: {
    name: string;
    start_time: string;
    end_time: string;
    position: string;
    area?: string | null;
    days: number[];
    break_duration: number;
    capacity: number;
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

  const handleGenerate = useCallback((excludedEmployeeIds: string[], lockedShiftIds: string[], preferences: string) => {
    if (!restaurantId) return;
    const weekStartStr = weekDays[0];
    setGenerationResult(null);
    setGenerationError(null);
    generateSchedule.mutate(
      {
        restaurantId,
        restaurantTimezone,
        weekStart: weekStartStr,
        lockedShiftIds,
        excludedEmployeeIds,
        preferences,
      },
      {
        onSuccess: (data) => {
          if (data.shifts.length > 0) {
            // Clear state and close — don't leave stale results for next open
            setGenerationResult(null);
            setGenerationError(null);
            setGenerateDialogOpen(false);
          } else {
            setGenerationResult(data);
          }
        },
        onError: (error) => {
          setGenerationError(error);
        },
      },
    );
  }, [restaurantId, restaurantTimezone, weekDays, generateSchedule]);

  const handleGenerateDialogChange = useCallback((open: boolean) => {
    setGenerateDialogOpen(open);
    if (!open) {
      setGenerationResult(null);
      setGenerationError(null);
    }
  }, []);

  const handleGenerateRetry = useCallback(() => {
    setGenerationResult(null);
    setGenerationError(null);
  }, []);

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

  // Derived slot label for the CoverageDetail heading.
  // Prepends t.area when set (e.g. "Cold Stone · Server · 10:00–16:30");
  // appends "(all areas)" when t.area is null so managers don't mistake a
  // restaurant-wide slot for an area-scoped one.
  const coverageDetailTemplate = coverageDetail
    ? templates.find((tmpl) => tmpl.id === coverageDetail.templateId)
    : undefined;
  const coverageSlotLabel = coverageDetailTemplate
    ? buildSlotLabel(coverageDetailTemplate)
    : undefined;

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

      {/* Plan | Timeline view toggle — shared across both modes */}
      <div className="flex items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => { if (v === 'plan' || v === 'timeline') setView(v); }}
          className="h-8"
          aria-label="Schedule view"
        >
          <ToggleGroupItem value="plan" className="h-8 px-3 text-[12px]">
            Plan
          </ToggleGroupItem>
          <ToggleGroupItem value="timeline" className="h-8 px-3 text-[12px]">
            Timeline
          </ToggleGroupItem>
        </ToggleGroup>

        {hiddenTemplates.length > 0 && (
          <HiddenTemplatesToggle
            count={hiddenTemplates.length}
            showHidden={showHidden}
            onToggle={handleToggleShowHidden}
          />
        )}
      </div>

      {/* Timeline view — replaces editing tree when active */}
      {view === 'timeline' && (
        <ShiftTimelineTab
          shifts={shifts}
          employees={employees}
          weekDays={weekDays}
          restaurantId={restaurantId}
          tz={restaurantTimezone}
          loading={false}
          error={null}
          availabilityByEmployee={availabilityByEmployee}
        />
      )}

      {/* Plan view — editing tree (DnD, templates, sidebar, overlays) */}
      {view === 'plan' && (
        <>
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

      {/* Labor efficiency (SPLH) panel — collapsed by default */}
      <Collapsible open={laborEffOpen} onOpenChange={setLaborEffOpen}>
        <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
          <CollapsibleTrigger asChild>
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
              aria-label={laborEffOpen ? 'Collapse Labor efficiency' : 'Expand Labor efficiency'}
            >
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-muted/50 flex items-center justify-center">
                  <TrendingUp className="h-3.5 w-3.5 text-foreground" />
                </span>
                <span className="text-[14px] font-medium text-foreground">Labor efficiency</span>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${laborEffOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-4 pb-4">
              <LaborEfficiencyPanel restaurantId={restaurantId} />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Schedule overview panel — weekly mini-Gantt */}
      <ScheduleOverviewPanel
        overviewDays={overviewDays}
        coverageByDay={coverageByDay}
        isMobile={isMobile}
      />

      {/* Two-panel layout */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="relative flex gap-0">
          <div className="flex-1 min-w-0 overflow-x-auto">
            {displayTemplates.length === 0 && hiddenTemplates.length === 0 ? (
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
              <div className="space-y-2">
                <AreaFilterPills
                  areas={templateAreas}
                  hasUnassigned={hasUnassigned}
                  selectedArea={areaFilter}
                  onSelect={setAreaFilter}
                />
                <TemplateGrid
                  weekDays={weekDays}
                  templates={displayTemplates}
                  gridData={templateGridData}
                  onRemoveShift={deleteShift}
                  onEditTemplate={handleEditTemplate}
                  onHideTemplate={handleHideTemplate}
                  onRestoreTemplate={handleRestoreTemplate}
                  onAddTemplate={handleAddTemplate}
                  highlightCellId={highlightCellId}
                  onMobileCellTap={isMobile ? handleMobileCellTap : undefined}
                  hasMobileSelection={isMobile && !!selectedMobileEmployee}
                  areaFilter={areaFilter}
                  coverageSlot={!isMobile ? <CoverageStrip weekDays={weekDays} coverageByDay={coverageByDay} /> : undefined}
                  allocationStatuses={allocationStatuses}
                  pickedEmployeeName={pickedEmployeeName}
                  coverageByTemplateDay={coverageByTemplateDay}
                  onCoverageClick={handleCoverageClick}
                  ghostByCell={ghostByCell}
                  offTemplateByArea={offTemplateByArea}
                  hiddenLaneByDay={hiddenLaneByDay}
                  onShowHidden={handleShowHidden}
                />
              </div>
            )}
          </div>

          {/* Desktop: inline sidebar */}
          {!isMobile && (
            <EmployeeSidebar
              employees={employees}
              shifts={shifts}
              weekDays={weekDays}
              shiftsByEmployee={shiftsByEmployee}
              plannerAreaFilter={areaFilter}
              onEmployeePick={setPickedEmployeeId}
              availabilityByEmployee={availabilityByEmployee}
              timezone={restaurantTimezone}
            />
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
                <EmployeeSidebar
                  employees={employees}
                  shifts={shifts}
                  weekDays={weekDays}
                  shiftsByEmployee={shiftsByEmployee}
                  className="w-full border-l-0"
                  onEmployeeSelect={handleMobileEmployeeSelect}
                  onEmployeePick={setPickedEmployeeId}
                  plannerAreaFilter={areaFilter}
                  availabilityByEmployee={availabilityByEmployee}
                  timezone={restaurantTimezone}
                />
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
        </>
      )}

      {/* Template form dialog */}
      <TemplateFormDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        template={editingTemplate}
        onSubmit={handleTemplateSubmit}
        positions={positions}
        restaurantId={restaurantId}
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
        onOpenChange={handleGenerateDialogChange}
        restaurantId={restaurantId}
        restaurantTimezone={restaurantTimezone}
        employees={employees ?? []}
        templates={templates}
        availability={availability}
        availabilityLoading={availabilityLoading}
        existingShifts={shifts}
        weekStart={weekStart}
        weekEnd={weekEnd}
        isGenerating={generateSchedule.isPending}
        generationResult={generationResult}
        generationError={generationError}
        onGenerate={handleGenerate}
        onRetry={handleGenerateRetry}
      />

      {/* Coverage detail — ONE lifted instance (Single Dialog Pattern).
          Desktop uses Popover (anchored to cell rect when available); mobile uses Drawer. */}
      <CoverageDetail
        open={coverageDetail !== null}
        coverage={
          coverageDetail
            ? (coverageByTemplateDay.get(coverageDetail.templateId)?.get(coverageDetail.day) ?? null)
            : null
        }
        slotLabel={coverageSlotLabel}
        slotArea={coverageDetailTemplate?.area ?? null}
        anchorRect={coverageDetail?.anchorRect}
        onClose={handleCoverageClose}
      />

    </div>
  );
}
