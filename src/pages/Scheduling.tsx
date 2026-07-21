import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay } from '@dnd-kit/core';
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
import { useTimeOffRequests } from '@/hooks/useTimeOffRequests';
import { TimeOffTabBadge } from './SchedulingTimeOffTabBadge';
import { ScheduleDayHeaderContent, TODAY_HEADER_CAP_RULE_CLASS } from './SchedulingDayHeaderContent';
import { SchedulingTimeOffCellContent } from './SchedulingTimeOffCellContent';
import { WeeklyAvailabilityChip } from './SchedulingWeeklyAvailabilityChip';
import { ShiftCard } from './SchedulingShiftCard';
import { WeekScheduleMobile } from '@/components/scheduling/WeekScheduleMobile';
import { usePublishSchedule, useUnpublishSchedule, useWeekPublicationStatus } from '@/hooks/useSchedulePublish';
import { useScheduleChangeLogs } from '@/hooks/useScheduleChangeLogs';
import { useScheduledLaborCosts } from '@/hooks/useScheduledLaborCosts';
import { useEmployeeLaborCosts } from '@/hooks/useEmployeeLaborCosts';
import { EmployeeDialog } from '@/components/EmployeeDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEmployeePositions } from '@/hooks/useEmployeePositions';
import { useEmployeeAreas } from '@/hooks/useEmployeeAreas';
import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';
import { groupEmployees, type GroupByMode } from '@/lib/scheduleGrouping';
import { calculateShiftHours } from '@/lib/scheduleRoster';
import {
  buildActiveShiftEmployeeIds,
  filterEmployeesForScheduleView,
} from '@/lib/scheduleVisibility';
import { ShiftDialog } from '@/components/ShiftDialog';
import type { DefaultEmployee } from '@/components/ShiftDialog';
import { TimeOffRequestDialog } from '@/components/TimeOffRequestDialog';
import { TimeOffList } from '@/components/TimeOffList';
import { AvailabilityDialog } from '@/components/AvailabilityDialog';
import { AvailabilityExceptionDialog } from '@/components/AvailabilityExceptionDialog';
import { ScheduleStatusBadge } from '@/components/ScheduleStatusBadge';
import { PublishScheduleDialog } from '@/components/PublishScheduleDialog';
import { BroadcastOpenShiftsDialog } from '@/components/scheduling/BroadcastOpenShiftsDialog';
import { ChangeLogDialog } from '@/components/ChangeLogDialog';
import { TradeApprovalQueue } from '@/components/schedule/TradeApprovalQueue';
import { ScheduleMetricsRibbon } from '@/components/scheduling/ScheduleMetricsRibbon';
import { useScheduleLaborBudget } from '@/hooks/useScheduleLaborBudget';
import { ScheduleExportDialog } from '@/components/scheduling/ScheduleExportDialog';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner';
import { ShiftImportSheet } from '@/components/scheduling/ShiftImportSheet';
import { CopyWeekDialog } from '@/components/scheduling/ShiftPlanner/CopyWeekDialog';
import { AvailabilityConflictDialog } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';
import { TeamAvailabilityGrid } from '@/components/scheduling/TeamAvailabilityGrid';
import { DeleteAvailabilityDialog } from '@/components/scheduling/DeleteAvailabilityDialog';
import type { AvailabilityDeletionTarget } from '@/components/scheduling/DeleteAvailabilityDialog';
import { useShiftCopyDnd } from '@/components/scheduling/useShiftCopyDnd';
import { DraggableShiftCard } from '@/components/scheduling/DraggableShiftCard';
import { DroppableDayCell } from '@/components/scheduling/DroppableDayCell';
import { ShiftDragOverlay } from '@/components/scheduling/ShiftDragOverlay';
import { useCopyWeekShifts } from '@/hooks/useCopyWeekShifts';
import { getMondayOfWeek, computeHoursPerEmployee, buildTemplateGridData } from '@/hooks/useShiftPlanner';
import { useSharedWeek } from '@/hooks/useSharedWeek';
import { useShiftTemplates, templateAppliesToDay } from '@/hooks/useShiftTemplates';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { formatLocalDate } from '@/lib/shiftInterval';
import { capacityFloor } from '@/lib/shiftCoverage';
import { distinctAssignedCount } from '@/lib/shiftFill';
import type { ShiftTemplate } from '@/types/scheduling';
import { RecurringShiftActionDialog, RecurringActionType } from '@/components/scheduling/RecurringShiftActionDialog';
import { isRecurringShift, RecurringActionScope } from '@/utils/recurringShiftHelpers';
import { BulkActionBar } from '@/components/bulk-edit/BulkActionBar';
import { BulkEditShiftsDialog } from '@/components/scheduling/BulkEditShiftsDialog';
import { useBulkShiftActions } from '@/hooks/useBulkShiftActions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { isMinor } from '@/lib/employeeUtils';
import { buildWeekTimeOff, summarizeOff } from '@/lib/scheduleTimeOff';
import {
  computeEffectiveAvailability,
  summarizeWeekAvailability,
  TIME_OFF_CHIP_CLASSES,
  type WeekAvailabilitySummary,
} from '@/lib/effectiveAvailability';
import {
  Calendar,
  Plus,
  Users,
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
  Upload,
  LayoutGrid,
  Copy,
  Layers,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Check,
  Pencil,
  Volume2,
  CalendarOff,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, parseISO, isToday } from 'date-fns';
import { Employee, Shift, EmployeeAvailability, AvailabilityException } from '@/types/scheduling';
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

export const SKELETON_ROWS = [...new Array(4)].map((_, rowIndex) => `row-${rowIndex}`);
export const SKELETON_DAYS = [...new Array(7)].map((_, dayIndex) => `day-${dayIndex}`);

// Re-exported from scheduleVisibility for backward compatibility (tests and
// other consumers import these from '@/pages/Scheduling').
export { buildActiveShiftEmployeeIds, filterEmployeesForScheduleView };

// ShiftCard (and getShiftStatusClass) live in SchedulingShiftCard.tsx so that
// WeekScheduleMobile.tsx (Task 8) can import ShiftCard without creating a
// circular dependency with this file (Scheduling.tsx imports
// WeekScheduleMobile.tsx to render it).
export { getShiftStatusClass } from './SchedulingShiftCard';

/**
 * Pure function extracted from the openShiftCount useMemo so it can be
 * unit-tested independently of the Scheduling component.
 *
 * Rebuilt on `buildTemplateGridData` + `distinctAssignedCount` — the SAME
 * per-template bucketing that drives the grid's employee chips — instead of
 * the old whole-floor `computeSlotCoverage` position sweep. That sweep only
 * filtered by position (never `shift_template_id`), so one employee's shift
 * could satisfy every other same-position template's slot on that day,
 * producing a banner count that disagreed with what the grid showed (the bug
 * this fixes; see docs/superpowers/specs/2026-07-20-shift-fill-by-assignment-design.md).
 *
 * A template slot is filled when >= capacity DISTINCT employees are bucketed
 * under *that template* (FK match, or the legacy exact-time/position/day
 * fallback `buildTemplateGridData` already uses for null-FK shifts) —
 * regardless of whether their hours span the whole window.
 *
 * `restaurantTimezone` is passed through to `buildTemplateGridData` so day /
 * time / day-of-week bucketing all resolve in restaurant-local time — the same
 * tz the grid chips and the SQL (`… AT TIME ZONE p_tz`) use. This keeps the
 * banner, the chips, and the server in agreement even for a viewer in a
 * different timezone (a traveling manager near local midnight).
 */
export function computeOpenShiftCount(
  templates: ShiftTemplate[],
  shifts: Shift[],
  weekDayStrings: string[], // 'yyyy-MM-dd'
  restaurantTimezone: string,
): number {
  if (!templates.length || shifts === undefined) return 0;
  const grid = buildTemplateGridData(shifts, templates, weekDayStrings, restaurantTimezone);
  let total = 0;
  for (const t of templates) {
    const bucketByDay = grid.get(t.id);
    for (const dayStr of weekDayStrings) {
      if (!templateAppliesToDay(t, dayStr)) continue;
      const bucketShifts = bucketByDay?.get(dayStr) ?? [];
      const assignedCount = distinctAssignedCount(bucketShifts);
      total += Math.max(0, capacityFloor(t.capacity) - assignedCount);
    }
  }
  return total;
}

/**
 * Pure extraction of the "resolve the deletion target's personName" glue used
 * when the Remove button inside AvailabilityDialog/AvailabilityExceptionDialog
 * fires. Those editors only carry the row (no employee list of their own);
 * Scheduling.tsx already holds `allEmployees` and fills in `personName` before
 * opening the single shared DeleteAvailabilityDialog instance. Returns null if
 * the row's employee_id doesn't match any known employee (e.g. the employee
 * was removed mid-session) — callers should treat that as "nothing to delete".
 */
export function buildAvailabilityDeletionTarget(
  kind: 'availability',
  row: EmployeeAvailability,
  employees: Employee[],
): AvailabilityDeletionTarget | null;
export function buildAvailabilityDeletionTarget(
  kind: 'exception',
  row: AvailabilityException,
  employees: Employee[],
): AvailabilityDeletionTarget | null;
export function buildAvailabilityDeletionTarget(
  kind: 'availability' | 'exception',
  row: EmployeeAvailability | AvailabilityException,
  employees: Employee[],
): AvailabilityDeletionTarget | null {
  const employee = employees.find((e) => e.id === row.employee_id);
  if (!employee) return null;
  if (kind === 'availability') {
    return { kind: 'availability', row: row as EmployeeAvailability, personName: employee.name };
  }
  return { kind: 'exception', row: row as AvailabilityException, personName: employee.name };
}

const Scheduling = () => {
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
  const { effectiveSettings: staffingSettings } = useStaffingSettings(restaurantId);

  const { weekStart: currentWeekStart, setWeekStart: setCurrentWeekStart } = useSharedWeek();
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [availabilityDialogOpen, setAvailabilityDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [gridAvailability, setGridAvailability] = useState<EmployeeAvailability | undefined>();
  const [gridDefaultEmployeeId, setGridDefaultEmployeeId] = useState<string | undefined>();
  const [gridDefaultDayOfWeek, setGridDefaultDayOfWeek] = useState<number | undefined>();
  const [gridException, setGridException] = useState<AvailabilityException | undefined>();
  const [gridDefaultDate, setGridDefaultDate] = useState<Date | undefined>();
  const [deletionTarget, setDeletionTarget] = useState<AvailabilityDeletionTarget | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>();
  const [selectedShift, setSelectedShift] = useState<Shift | undefined>();
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [defaultShiftDate, setDefaultShiftDate] = useState<Date | undefined>();
  const [defaultShiftEmployee, setDefaultShiftEmployee] = useState<DefaultEmployee | undefined>();
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [changeLogDialogOpen, setChangeLogDialogOpen] = useState(false);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [shiftImportOpen, setShiftImportOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [recurringActionDialog, setRecurringActionDialog] = useState<{
    open: boolean;
    shift: Shift | null;
    actionType: RecurringActionType;
  }>({ open: false, shift: null, actionType: 'edit' });

  // Multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkOperating, setIsBulkOperating] = useState(false);

  // Memoized so downstream hook deps (useShifts, useWeekPublicationStatus, etc.)
  // and weekDayKeys/weekTimeOff memos are stable across drag/hover/selection re-renders.
  const weekEnd = useMemo(
    () => endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
    [currentWeekStart],
  );
  const weekDays = useMemo(
    () => eachDayOfInterval({ start: currentWeekStart, end: weekEnd }),
    [currentWeekStart, weekEnd],
  );

  // Fetch ALL employees (including inactive) to show historical shifts
  const { employees: allEmployees, loading: employeesLoading, error: employeesError } = useEmployees(restaurantId, { status: 'all' });
  const { shifts, loading: shiftsLoading, error: shiftsError } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const { templates } = useShiftTemplates(restaurantId);
  const { trades: pendingTrades } = useShiftTrades(restaurantId, 'pending_approval', null);
  const { timeOffRequests } = useTimeOffRequests(restaurantId);
  const pendingTimeOffCount = timeOffRequests.filter((r) => r.status === 'pending').length;
  // Both hooks use staleTime: 30000 (per-hook default). While loading/erroring,
  // these default to [] — computeEffectiveAvailability then yields 'not-set'
  // days for every employee, summarizeWeekAvailability rolls that up to
  // 'unset', and the chip renders nothing (no page skeleton needed).
  const { availability: employeeAvailability } = useEmployeeAvailability(restaurantId);
  const { exceptions: availabilityExceptions } = useAvailabilityExceptions(restaurantId);

  // stable 'yyyy-MM-dd' keys for the 7 visualized days
  const weekDayKeys = useMemo(
    () => weekDays.map((d) => format(d, 'yyyy-MM-dd')),
    [weekDays],
  );
  // per-employee approved-time-off context for the week
  const weekTimeOff = useMemo(
    () => buildWeekTimeOff(timeOffRequests, weekDayKeys),
    [timeOffRequests, weekDayKeys],
  );

  const deleteShift = useDeleteShift();
  const deleteShiftSeries = useDeleteShiftSeries();
  const updateShiftSeries = useUpdateShiftSeries();
  const publishSchedule = usePublishSchedule();
  const unpublishSchedule = useUnpublishSchedule();
  const copyWeekMutation = useCopyWeekShifts();
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
  
  const {
    sensors,
    activeDragShift,
    highlightedCellId,
    conflictDialog,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  } = useShiftCopyDnd();

  const { toast } = useToast();
  const pendingTradeCount = pendingTrades.length;

  // Separate active employees for creating new shifts
  const activeEmployees = allEmployees.filter(emp => Boolean(emp.is_active));
  const { positions, isLoading: positionsLoading } = useEmployeePositions(restaurantId);
  const { areas } = useEmployeeAreas(restaurantId);
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [areaFilter, setAreaFilter] = useState<string>('all');

  // Reset area filter when selected value is no longer available
  useEffect(() => {
    if (areaFilter !== 'all' && !areas.includes(areaFilter)) {
      setAreaFilter('all');
    }
  }, [areaFilter, areas]);
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => {
    try {
      const saved = localStorage.getItem('schedule-group-by');
      if (saved === 'area' || saved === 'position' || saved === 'none') return saved;
    } catch { /* ignore */ }
    return 'none';
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Calculate scheduled labor costs with breakdown
  const { breakdown: laborCostBreakdown } = useScheduledLaborCosts(
    shifts,
    currentWeekStart,
    weekEnd,
    restaurantId
  );

  // Calculate per-employee labor costs with outlier detection
  const laborCostSummary = useEmployeeLaborCosts(shifts, allEmployees);

  // Calculate labor budget comparison
  const laborBudgetData = useScheduleLaborBudget(
    laborCostBreakdown.total,
    restaurantId
  );

  // Handler for clicking on an employee in the breakdown to edit them
  const handleEditEmployeeById = useCallback((employeeId: string) => {
    const employee = allEmployees.find(e => e.id === employeeId);
    if (employee) {
      setSelectedEmployee(employee);
      setEmployeeDialogOpen(true);
    }
  }, [allEmployees]);

  const handleCopyWeekConfirm = useCallback(async (targetMonday: Date) => {
    if (!restaurantId) return;
    try {
      await copyWeekMutation.mutateAsync({
        sourceShifts: shifts,
        sourceMonday: currentWeekStart,
        targetMonday,
        restaurantId,
      });
      setCopyDialogOpen(false);
      setCurrentWeekStart(getMondayOfWeek(targetMonday));
    } catch {
      // onError in useCopyWeekShifts already shows a toast
    }
  }, [copyWeekMutation, shifts, currentWeekStart, restaurantId]);

  // Apply position and area filters to active employees for new shift creation
  const filteredActiveEmployees = useMemo(() => {
    let result = activeEmployees;
    if (areaFilter && areaFilter !== 'all') {
      result = result.filter(emp => emp.area === areaFilter);
    }
    if (positionFilter && positionFilter !== 'all') {
      result = result.filter(emp => emp.position === positionFilter);
    }
    return result;
  }, [activeEmployees, areaFilter, positionFilter]);

  // For displaying the schedule grid: show active employees + inactive employees with non-cancelled shifts
  const filteredEmployeesWithShifts = useMemo(() => {
    const shiftEmployeeIds = buildActiveShiftEmployeeIds(shifts);
    return filterEmployeesForScheduleView(allEmployees, shiftEmployeeIds, positionFilter, areaFilter);
  }, [allEmployees, shifts, positionFilter, areaFilter]);

  // Stable string key (not a fresh array literal) so the effective-availability
  // memo below isn't defeated on every render by a new .map(...) reference.
  const visibleEmployeeIdsKey = useMemo(
    () => filteredEmployeesWithShifts.map((e) => e.id).join(','),
    [filteredEmployeesWithShifts],
  );
  const weekStartKey = useMemo(() => format(currentWeekStart, 'yyyy-MM-dd'), [currentWeekStart]);

  const effectiveAvailabilityByEmployee = useMemo(() => {
    const employeeIds = visibleEmployeeIdsKey ? visibleEmployeeIdsKey.split(',') : [];
    return computeEffectiveAvailability(employeeAvailability, availabilityExceptions, currentWeekStart, employeeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleEmployeeIdsKey/weekStartKey are the stable proxies for employeeIds/currentWeekStart
  }, [employeeAvailability, availabilityExceptions, visibleEmployeeIdsKey, weekStartKey]);

  // Per-employee weekly availability status (time_off > limited > available >
  // unset), combining the already-loaded time-off context with the
  // availability query result.
  const weekAvailabilityByEmployee = useMemo(() => {
    const map = new Map<string, WeekAvailabilitySummary>();
    for (const employee of filteredEmployeesWithShifts) {
      const empOff = weekTimeOff.get(employee.id);
      const off = empOff ? summarizeOff(empOff) : null;
      const week = effectiveAvailabilityByEmployee.get(employee.id);
      map.set(employee.id, summarizeWeekAvailability(week, !!off, off?.label));
    }
    return map;
  }, [filteredEmployeesWithShifts, effectiveAvailabilityByEmployee, weekTimeOff]);

  // Calculate hours for all shifts (including inactive employees)
  const totalScheduledHours = shifts
    .filter(s => filteredEmployeesWithShifts.some(e => e.id === s.employee_id))
    .reduce((sum, shift) => sum + calculateShiftHours(shift), 0);

  const hoursPerEmployee = useMemo(() => computeHoursPerEmployee(shifts), [shifts]);

  const openShiftCount = useMemo(
    () => computeOpenShiftCount(templates, shifts, weekDays.map(formatLocalDate), restaurantTimezone),
    [templates, shifts, weekDays, restaurantTimezone],
  );

  // Grouped employees for rendering
  const employeeGroups = useMemo(
    () => groupEmployees(filteredEmployeesWithShifts, groupBy),
    [filteredEmployeesWithShifts, groupBy]
  );

  const handleGroupByChange = useCallback((mode: GroupByMode) => {
    setGroupBy(mode);
    setCollapsedGroups(new Set());
    try { localStorage.setItem('schedule-group-by', mode); } catch { /* ignore */ }
  }, []);

  const toggleGroupCollapse = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  // Multi-select helpers
  const toggleShiftSelection = useCallback((shiftId: string) => {
    setSelectedShiftIds(prev => {
      const next = new Set(prev);
      if (next.has(shiftId)) next.delete(shiftId);
      else next.add(shiftId);
      return next;
    });
  }, []);

  const toggleShiftGroup = useCallback((candidateIds: string[]) => {
    setSelectedShiftIds(prev => {
      const allSelected = candidateIds.every(id => prev.has(id));
      const next = new Set(prev);
      candidateIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }, []);

  const selectShiftsForEmployee = useCallback((employeeId: string) => {
    toggleShiftGroup(shifts.filter(s => s.employee_id === employeeId).map(s => s.id));
  }, [shifts, toggleShiftGroup]);

  const selectShiftsForDay = useCallback((dayStr: string) => {
    const targetDay = parseISO(dayStr);
    toggleShiftGroup(shifts.filter(s => isSameDay(parseISO(s.start_time), targetDay)).map(s => s.id));
  }, [shifts, toggleShiftGroup]);

  const clearSelection = useCallback(() => {
    setSelectedShiftIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedShiftIds(new Set());
  }, []);

  const hasLockedInSelection = useMemo(() => {
    if (selectedShiftIds.size === 0) return false;
    const shiftMap = new Map(shifts.map(s => [s.id, s]));
    return Array.from(selectedShiftIds).some(id => shiftMap.get(id)?.locked);
  }, [selectedShiftIds, shifts]);

  // Escape key exits selection mode
  useEffect(() => {
    if (!selectionMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelectionMode();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectionMode, exitSelectionMode]);

  // Bulk shift actions
  const { bulkDelete, bulkEdit } = useBulkShiftActions(restaurantId ?? '');

  const handleBulkDelete = useCallback(async () => {
    setIsBulkOperating(true);
    try {
      await bulkDelete(Array.from(selectedShiftIds));
      clearSelection();
      setBulkDeleteDialogOpen(false);
    } catch {
      toast({
        title: 'Failed to delete shifts',
        description: 'An error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsBulkOperating(false);
    }
  }, [selectedShiftIds, bulkDelete, clearSelection, toast]);

  const handleBulkEdit = useCallback(async (changes: Record<string, unknown>) => {
    setIsBulkOperating(true);
    try {
      await bulkEdit(Array.from(selectedShiftIds), changes);
      clearSelection();
      setBulkEditDialogOpen(false);
    } catch {
      toast({
        title: 'Failed to update shifts',
        description: 'An error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsBulkOperating(false);
    }
  }, [selectedShiftIds, bulkEdit, clearSelection, toast]);

  const handleOpenAvailabilityFromGrid = useCallback((employeeId: string, dayOfWeek: number, availability?: EmployeeAvailability) => {
    setGridDefaultEmployeeId(employeeId);
    setGridDefaultDayOfWeek(dayOfWeek);
    setGridAvailability(availability);
    setAvailabilityDialogOpen(true);
  }, []);

  const handleOpenExceptionFromGrid = useCallback((employeeId: string, date: Date, exception?: AvailabilityException) => {
    setGridDefaultEmployeeId(employeeId);
    setGridDefaultDate(date);
    setGridException(exception);
    setExceptionDialogOpen(true);
  }, []);

  // Grid already resolves personName itself (it has the employee row in
  // hand), so its trash button hands up a fully-formed target directly.
  const handleRequestDeleteAvailability = useCallback((target: AvailabilityDeletionTarget) => {
    setDeletionTarget(target);
  }, []);

  // The editors (AvailabilityDialog/AvailabilityExceptionDialog) only carry
  // the row — resolve personName from allEmployees before opening the
  // shared DeleteAvailabilityDialog.
  const handleRemoveAvailability = useCallback((availability: EmployeeAvailability) => {
    const target = buildAvailabilityDeletionTarget('availability', availability, allEmployees);
    if (target) {
      setDeletionTarget(target);
    } else {
      toast({
        title: 'Unable to remove',
        description: 'This employee is no longer available.',
        variant: 'destructive',
      });
    }
  }, [allEmployees, toast]);

  const handleRemoveException = useCallback((exception: AvailabilityException) => {
    const target = buildAvailabilityDeletionTarget('exception', exception, allEmployees);
    if (target) {
      setDeletionTarget(target);
    } else {
      toast({
        title: 'Unable to remove',
        description: 'This employee is no longer available.',
        variant: 'destructive',
      });
    }
  }, [allEmployees, toast]);

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
    clearSelection();
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
    clearSelection();
  };

  const handleToday = () => {
    setCurrentWeekStart(getMondayOfWeek(new Date()));
    clearSelection();
  };

  const handleEditEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEmployeeDialogOpen(true);
  };

  const handleAddEmployee = () => {
    setSelectedEmployee(undefined);
    setEmployeeDialogOpen(true);
  };

  const handleAddShift = (date?: Date, employee?: DefaultEmployee) => {
    setSelectedShift(undefined);
    setDefaultShiftDate(date);
    setDefaultShiftEmployee(employee);
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
      setDefaultShiftEmployee(undefined);
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
        { shift, scope, restaurantId, includePublished: true },
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
        { id: shiftToDelete.id, restaurantId, shift: shiftToDelete },
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
            clearSelection();
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
            clearSelection();
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

  // Only treat a query error as fatal when there is no usable cached data to
  // show. React Query keeps the last-good data on a failed background refetch
  // (both hooks use refetchOnWindowFocus), so keying purely off error truthiness
  // would blank a valid, already-rendered schedule on a transient blip.
  const hasScheduleError =
    (Boolean(employeesError) && allEmployees.length === 0) ||
    (Boolean(shiftsError) && shifts.length === 0);

  return (
    <FeatureGate featureKey="scheduling">
    <div className="space-y-6">
      <ScheduleMetricsRibbon
        activeEmployeeCount={filteredActiveEmployees.length}
        totalScheduledHours={totalScheduledHours}
        laborCostBreakdown={laborCostBreakdown}
        laborCostSummary={laborCostSummary}
        laborBudgetData={laborBudgetData}
        shiftCount={shifts.length}
        scheduledEmployeeCount={scheduledEmployeeCount}
        isLoading={employeesLoading || shiftsLoading}
        error={hasScheduleError}
        onEditEmployee={handleEditEmployeeById}
      />

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
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2 relative"
          >
            <CalendarX className="h-4 w-4" />
            <span className="hidden sm:inline">Time-Off</span>
            <TimeOffTabBadge count={pendingTimeOffCount} />
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
          <TabsTrigger
            value="planner"
            aria-label="Planner"
            className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-2.5 gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Planner</span>
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
                {/* Selection mode toggle */}
                {selectionMode ? (
                  <Button
                    size="sm"
                    onClick={exitSelectionMode}
                    className="h-9 text-[13px] font-medium"
                    aria-label="Exit selection mode"
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Done
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectionMode(true)}
                    className="h-9 text-[13px] font-medium"
                    aria-label="Enter selection mode"
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                    Select
                  </Button>
                )}
                <div className="h-6 w-px bg-border hidden sm:block" />

                {/* Area filter */}
                {areas.length > 1 && (
                  <Select value={areaFilter} onValueChange={(v) => setAreaFilter(v)}>
                    <SelectTrigger
                      id="area-filter"
                      aria-label="Filter by area"
                      className="w-40 h-9 text-xs bg-background"
                    >
                      <SelectValue placeholder="All Areas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Areas</SelectItem>
                      {areas.map((a) => (
                        <SelectItem key={a} value={a}>{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

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

                {/* Group by */}
                <Select value={groupBy} onValueChange={(v) => handleGroupByChange(v as GroupByMode)}>
                  <SelectTrigger
                    id="group-by"
                    aria-label="Group by"
                    className="w-36 h-9 text-xs bg-background"
                  >
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Grouping</SelectItem>
                    <SelectItem value="area">Group by Area</SelectItem>
                    <SelectItem value="position">Group by Position</SelectItem>
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
                    {staffingSettings.open_shifts_enabled && openShiftCount > 0 && (
                      <Button
                        variant={publication?.open_shifts_broadcast_at ? 'ghost' : 'outline'}
                        size="sm"
                        onClick={() => setBroadcastDialogOpen(true)}
                        className={cn(
                          'h-9 text-xs',
                          publication?.open_shifts_broadcast_at && 'text-muted-foreground'
                        )}
                        aria-label="Broadcast open shifts"
                      >
                        {publication?.open_shifts_broadcast_at ? (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1.5 text-green-600" />
                            Broadcast Sent
                          </>
                        ) : (
                          <>
                            <Volume2 className="h-3.5 w-3.5 mr-1.5" />
                            Broadcast
                          </>
                        )}
                      </Button>
                    )}
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

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShiftImportOpen(true)}
                  className="h-9 text-xs"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Import
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCopyDialogOpen(true)}
                  disabled={shifts.length === 0}
                  className="h-9 text-xs"
                  aria-label="Copy week"
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copy Week
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
                {!selectionMode && (
                <Button
                  size="sm"
                  onClick={() => handleAddShift()}
                  className="h-9 text-xs shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Shift
                </Button>
                )}
              </div>
            </div>
          </CardHeader>
        </div>

        <CardContent className="p-0">
          {hasScheduleError ? (
            <div className="text-center py-16 px-6" role="alert">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-destructive/10 rounded-full blur-xl animate-pulse" />
                <div className="relative p-4 bg-muted rounded-2xl">
                  <AlertTriangle className="h-10 w-10 text-destructive" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mt-4 mb-2">Couldn't load schedule</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Something went wrong loading employees or shifts. Please try again.
              </p>
            </div>
          ) : employeesLoading || shiftsLoading ? (
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
          ) : allEmployees.length === 0 ? (
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
            <>
            {/* Desktop: 7-column grid with drag-and-drop. Hidden on mobile in favor
                of WeekScheduleMobile's day-focused layout (design doc §4) — mobile
                drops DnD in favor of tap-to-edit. */}
            <div className="hidden md:block">
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
            {/* `relative` makes this scroller the containing block for any absolutely
                positioned descendant of the table (e.g. sr-only time-off overflow spans),
                so they're clipped/scrolled here instead of leaking into document scroll
                width on mobile. Defense in depth alongside DroppableDayCell's `relative`. */}
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse min-w-[600px] md:min-w-[900px]">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left p-3 font-medium sticky left-0 bg-muted/30 backdrop-blur-sm z-10 w-[56px] md:w-auto md:min-w-[180px] border-r border-border/30">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">Team Member</span>
                    </th>
                    {weekDays.map((day) => {
                      const dayIsToday = isToday(day);
                      return (
                        <th
                          key={day.toISOString()}
                          className={cn(
                            "text-center p-2 md:p-3 font-medium min-w-[70px] md:min-w-[130px] transition-colors",
                            dayIsToday && cn("bg-primary/5", TODAY_HEADER_CAP_RULE_CLASS)
                          )}
                        >
                          {selectionMode ? (
                            <button
                              type="button"
                              onClick={() => selectShiftsForDay(format(day, 'yyyy-MM-dd'))}
                              className="w-full cursor-pointer text-primary hover:underline transition-colors"
                              aria-label={`Select all shifts for ${format(day, 'EEEE, MMMM d')}`}
                            >
                              <ScheduleDayHeaderContent day={day} isToday={dayIsToday} emphasize />
                            </button>
                          ) : (
                            <ScheduleDayHeaderContent day={day} isToday={dayIsToday} />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {employeeGroups.map((group) => {
                    const isGrouped = groupBy !== 'none';
                    const isCollapsed = isGrouped && collapsedGroups.has(group.label);

                    return (
                      <React.Fragment key={group.label || '__all'}>
                        {/* Group header row */}
                        {isGrouped && (
                          <tr
                            className="bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                            tabIndex={0}
                            role="button"
                            aria-expanded={!isCollapsed}
                            aria-label={`${group.label} group, ${group.employees.length} employees`}
                            onClick={() => toggleGroupCollapse(group.label)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleGroupCollapse(group.label);
                              }
                            }}
                          >
                            <td
                              colSpan={weekDays.length + 1}
                              className="p-2 px-3 sticky left-0"
                            >
                              <div className="flex items-center gap-2">
                                {isCollapsed ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="text-[13px] font-semibold text-foreground">
                                  {group.label}
                                </span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                  {group.employees.length}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Employee rows */}
                        {!isCollapsed && group.employees.map((employee, idx) => {
                          const empOff = weekTimeOff.get(employee.id);
                          const off = empOff ? summarizeOff(empOff) : null;
                          const isMinorEmployee = isMinor(employee.date_of_birth);
                          const weekAvailability = weekAvailabilityByEmployee.get(employee.id);
                          return (
                          <tr
                            key={employee.id}
                            className={cn(
                              "group transition-colors hover:bg-muted/30",
                              idx % 2 === 0 && "bg-muted/10"
                            )}
                          >
                            <td className="p-1 md:p-3 sticky left-0 bg-inherit backdrop-blur-sm z-10 border-r border-border/30">
                              <div className="hidden md:flex items-center gap-3 justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm",
                                    employee.is_active
                                      ? "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
                                      : "bg-muted text-muted-foreground"
                                  )}>
                                    {employee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="font-medium text-sm flex items-center gap-2">
                                      {selectionMode ? (
                                        <button
                                          type="button"
                                          onClick={() => selectShiftsForEmployee(employee.id)}
                                          className="text-primary hover:underline cursor-pointer text-left transition-colors"
                                          aria-label={`Select all shifts for ${employee.name}`}
                                        >
                                          {employee.name}
                                        </button>
                                      ) : (
                                        employee.name
                                      )}
                                      {!employee.is_active && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-muted">
                                          Inactive
                                        </Badge>
                                      )}
                                      {isMinorEmployee && (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-warning/10 text-warning font-medium shrink-0">
                                          Minor
                                        </span>
                                      )}
                                      {off ? (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                type="button"
                                                className={cn(
                                                  "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                  TIME_OFF_CHIP_CLASSES.bg,
                                                  TIME_OFF_CHIP_CLASSES.text,
                                                )}
                                              >
                                                <CalendarOff className="h-3 w-3" aria-hidden="true" />
                                                {off.label}
                                                <span className="sr-only">
                                                  {` — approved time off${off.reasons.length ? `: ${off.reasons.join(', ')}` : ''}`}
                                                </span>
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs">
                                              {off.reasons.length ? off.reasons.join(', ') : 'Approved time off'}
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      ) : (
                                        <WeeklyAvailabilityChip availability={weekAvailability} />
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      {employee.position}
                                      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                                        {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
                                      </span>
                                      {(hoursPerEmployee.get(employee.id) ?? 0) > 0 && (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                                          {hoursPerEmployee.get(employee.id)}h
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {!selectionMode && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleEditEmployee(employee)}
                                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary/10"
                                    aria-label={`Edit ${employee.name}`}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                              {/* Mobile employee presentation now lives entirely in
                                  WeekScheduleMobile (Task 8) — this <td> only ever
                                  renders on the desktop grid, which is wrapped in
                                  `hidden md:block` above, so a `md:hidden` block here
                                  could never actually render on any viewport width. */}
                            </td>
                            {weekDays.map((day) => {
                              const dayShifts = getShiftsForEmployee(employee.id, day);
                              const dayIsToday = isToday(day);
                              const dayKey = format(day, 'yyyy-MM-dd');
                              const isOff = !!empOff?.offDayKeys.has(dayKey);
                              const hasShift = dayShifts.some(s => s.status !== 'cancelled');
                              return (
                                <DroppableDayCell
                                  key={day.toISOString()}
                                  employeeId={employee.id}
                                  day={dayKey}
                                  isToday={dayIsToday}
                                  isHighlighted={highlightedCellId === `${employee.id}:${dayKey}`}
                                >
                                  <SchedulingTimeOffCellContent isOff={isOff} hasShift={hasShift}>
                                    {dayShifts.map((shift) => (
                                      selectionMode ? (
                                        <ShiftCard
                                          key={shift.id}
                                          shift={shift}
                                          onEdit={handleEditShift}
                                          onDelete={handleDeleteShift}
                                          isSelected={selectedShiftIds.has(shift.id)}
                                          selectionMode={selectionMode}
                                          onToggleSelect={toggleShiftSelection}
                                        />
                                      ) : (
                                        <DraggableShiftCard
                                          key={shift.id}
                                          shift={shift}
                                          employeeId={employee.id}
                                          day={dayKey}
                                        >
                                          <ShiftCard
                                            shift={shift}
                                            onEdit={handleEditShift}
                                            onDelete={handleDeleteShift}
                                          />
                                        </DraggableShiftCard>
                                      )
                                    ))}
                                    {!selectionMode && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className={cn(
                                          "w-full h-8 text-xs border border-dashed",
                                          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all duration-200",
                                          isOff
                                            ? "border-warning/50 text-warning hover:bg-warning/10"
                                            : "border-border/50 hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
                                        )}
                                        aria-label={`Add shift for ${employee.name} on ${format(day, 'EEE MMM d')}${isOff ? ' despite approved time off' : ''}`}
                                        onClick={() => handleAddShift(day, employee)}
                                      >
                                        <Plus className="h-3 w-3 mr-1" />
                                        {isOff ? 'Add anyway' : 'Add'}
                                      </Button>
                                    )}
                                  </SchedulingTimeOffCellContent>
                                </DroppableDayCell>
                              );
                            })}
                          </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DragOverlay dropAnimation={null}>
              {activeDragShift && <ShiftDragOverlay shift={activeDragShift} />}
            </DragOverlay>
            </DndContext>
            </div>
            <WeekScheduleMobile
              weekDays={weekDays}
              employees={filteredEmployeesWithShifts}
              getShiftsForEmployee={getShiftsForEmployee}
              weekTimeOff={weekTimeOff}
              weekAvailabilityByEmployee={weekAvailabilityByEmployee}
              hoursPerEmployee={hoursPerEmployee}
              selectionMode={selectionMode}
              selectedShiftIds={selectedShiftIds}
              onEditEmployee={handleEditEmployee}
              onAddShift={handleAddShift}
              onEditShift={handleEditShift}
              onDeleteShift={handleDeleteShift}
              onToggleSelectShift={toggleShiftSelection}
            />
            </>
          )}
          <AvailabilityConflictDialog
            open={conflictDialog.open}
            data={conflictDialog.data}
            timezone={restaurantTimezone}
            onConfirm={conflictDialog.onConfirm}
            onCancel={conflictDialog.onCancel}
          />
          {selectionMode && selectedShiftIds.size > 0 && (
            <BulkActionBar
              selectedCount={selectedShiftIds.size}
              onClose={clearSelection}
              actions={[
                { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => setBulkEditDialogOpen(true) },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => setBulkDeleteDialogOpen(true), variant: 'destructive' as const },
              ]}
            />
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
            <CardContent className="p-0">
              {restaurantId && (
                <TeamAvailabilityGrid
                  restaurantId={restaurantId}
                  onOpenAvailabilityDialog={handleOpenAvailabilityFromGrid}
                  onOpenExceptionDialog={handleOpenExceptionFromGrid}
                  onRequestDelete={handleRequestDeleteAvailability}
                />
              )}
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

        <TabsContent value="planner">
          {restaurantId && (
            <ShiftPlannerTab
              restaurantId={restaurantId}
              weekStart={currentWeekStart}
              onWeekStartChange={setCurrentWeekStart}
            />
          )}
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
            timezone={restaurantTimezone}
            defaultDate={defaultShiftDate}
            defaultEmployee={defaultShiftEmployee}
          />
          <TimeOffRequestDialog
            open={timeOffDialogOpen}
            onOpenChange={setTimeOffDialogOpen}
            restaurantId={restaurantId}
          />
          <AvailabilityDialog
            open={availabilityDialogOpen}
            onOpenChange={(open) => {
              setAvailabilityDialogOpen(open);
              if (!open) {
                setGridAvailability(undefined);
                setGridDefaultEmployeeId(undefined);
                setGridDefaultDayOfWeek(undefined);
              }
            }}
            restaurantId={restaurantId}
            availability={gridAvailability}
            defaultEmployeeId={gridDefaultEmployeeId}
            defaultDayOfWeek={gridDefaultDayOfWeek}
            onRemove={handleRemoveAvailability}
          />
          <AvailabilityExceptionDialog
            open={exceptionDialogOpen}
            onOpenChange={(open) => {
              setExceptionDialogOpen(open);
              if (!open) {
                setGridException(undefined);
                setGridDefaultEmployeeId(undefined);
                setGridDefaultDate(undefined);
              }
            }}
            restaurantId={restaurantId}
            exception={gridException}
            defaultEmployeeId={gridDefaultEmployeeId}
            defaultDate={gridDefaultDate}
            onRemove={handleRemoveException}
          />
          <DeleteAvailabilityDialog
            open={deletionTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeletionTarget(null);
            }}
            target={deletionTarget}
            restaurantId={restaurantId}
            timezone={restaurantTimezone}
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
        openShiftCount={openShiftCount}
        openShiftsEnabled={staffingSettings.open_shifts_enabled}
        broadcastDate={publication?.open_shifts_broadcast_at ?? null}
        onNavigateToSettings={() => navigate('/settings?tab=labor-planning')}
        onConfirm={handlePublishSchedule}
        isPublishing={publishSchedule.isPending}
      />

      {/* Broadcast Open Shifts Dialog */}
      <BroadcastOpenShiftsDialog
        open={broadcastDialogOpen}
        onOpenChange={setBroadcastDialogOpen}
        restaurantId={restaurantId ?? ''}
        publicationId={publication?.id ?? ''}
        weekStart={currentWeekStart}
        weekEnd={weekEnd}
        openShiftCount={openShiftCount}
        alreadyBroadcast={!!publication?.open_shifts_broadcast_at}
        broadcastDate={publication?.open_shifts_broadcast_at ?? null}
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
            <AlertDialogDescription className="text-sm leading-relaxed space-y-2">
              <span>Are you sure you want to delete this shift? This action cannot be undone and the
              employee will need to be rescheduled.</span>
              {shiftToDelete?.is_published && (
                <span className="flex items-center gap-2 text-warning font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  This shift has been published and employees may have already seen it.
                </span>
              )}
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
        areaFilter={areaFilter}
        groupBy={groupBy}
      />

      {/* Shift Import Sheet */}
      {restaurantId && (
        <ShiftImportSheet
          open={shiftImportOpen}
          onOpenChange={setShiftImportOpen}
          restaurantId={restaurantId}
          employees={allEmployees}
          timezone={restaurantTimezone}
        />
      )}

      {/* Copy Week Dialog */}
      <CopyWeekDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        sourceWeekStart={currentWeekStart}
        sourceWeekEnd={weekEnd}
        shifts={shifts}
        restaurantId={restaurantId}
        onConfirm={handleCopyWeekConfirm}
        isPending={copyWeekMutation.isPending}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedShiftIds.size} shift{selectedShiftIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This action cannot be undone.</p>
              {hasLockedInSelection && (
                <p className="flex items-center gap-2 text-warning font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Some selected shifts have been published and employees may have already seen them. They will be permanently deleted.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkOperating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={isBulkOperating} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isBulkOperating ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Edit Shifts Dialog */}
      <BulkEditShiftsDialog
        open={bulkEditDialogOpen}
        onOpenChange={setBulkEditDialogOpen}
        selectedCount={selectedShiftIds.size}
        onConfirm={handleBulkEdit}
        isUpdating={isBulkOperating}
        positions={positions}
      />
    </div>
    </FeatureGate>
  );
};

export default Scheduling;
