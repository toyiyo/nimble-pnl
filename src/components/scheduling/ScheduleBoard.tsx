import { useState, useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { ToastAction } from '@/components/ui/toast';

import {
  ArrowLeft,
  Trash2,
  Search,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
  X,
  Users,
} from 'lucide-react';

import {
  useScheduleSlots,
  useAssignEmployee,
  useUnassignEmployee,
  useDeleteGeneratedSchedule,
  useBulkAssignEmployee,
} from '@/hooks/useScheduleSlots';
import { useEmployees } from '@/hooks/useEmployees';
import { usePublishSchedule, useWeekPublicationStatus } from '@/hooks/useSchedulePublish';
import { useToast } from '@/hooks/use-toast';

import { ScheduleSlot, Employee } from '@/types/scheduling';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const COLUMN_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatWeekRange(weekStartStr: string): string {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const year = end.getFullYear();
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} \u2013 ${end.getDate()}, ${year}`;
  }
  return `${startMonth} ${start.getDate()} \u2013 ${endMonth} ${end.getDate()}, ${year}`;
}

function dateForDay(weekStartStr: string, dayOfWeek: number): Date {
  const start = new Date(weekStartStr + 'T00:00:00');
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const d = new Date(start);
  d.setDate(start.getDate() + offset);
  return d;
}

function timesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aStart = toMin(startA);
  let aEnd = toMin(endA);
  const bStart = toMin(startB);
  let bEnd = toMin(endB);
  if (aEnd <= aStart) aEnd += 24 * 60;
  if (bEnd <= bStart) bEnd += 24 * 60;
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// Grouped structures
// ---------------------------------------------------------------------------

interface ShiftGroup {
  key: string;
  shiftTemplateId: string;
  shiftName: string;
  shiftColor: string;
  startTime: string;
  endTime: string;
  position: string;
  slots: ScheduleSlot[];
}

interface DayColumn {
  dayOfWeek: number;
  date: Date;
  groups: ShiftGroup[];
}

function buildDayColumns(slots: ScheduleSlot[], weekStartDate: string): DayColumn[] {
  const dayGroupsMap = new Map<number, Map<string, ShiftGroup>>();

  for (const slot of slots) {
    const wts = slot.week_template_slot;
    const st = wts?.shift_template;
    if (!wts || !st) continue;

    const day = wts.day_of_week;
    if (!dayGroupsMap.has(day)) dayGroupsMap.set(day, new Map());
    const groups = dayGroupsMap.get(day)!;

    const key = wts.id;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        shiftTemplateId: wts.shift_template_id,
        shiftName: st.name,
        shiftColor: st.color || '#3b82f6',
        startTime: st.start_time,
        endTime: st.end_time,
        position: wts.position || st.position || 'Any',
        slots: [],
      });
    }
    groups.get(key)!.slots.push(slot);
  }

  return COLUMN_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    date: dateForDay(weekStartDate, dayOfWeek),
    groups: Array.from(dayGroupsMap.get(dayOfWeek)?.values() ?? []).sort((a, b) =>
      a.shiftName.localeCompare(b.shiftName),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Sub-component: role-filtered employee popover
// ---------------------------------------------------------------------------

function SlotAssignPopover({
  employees,
  position,
  onSelect,
  allSlots,
  slotDayOfWeek,
  slotStartTime,
  slotEndTime,
}: {
  employees: Employee[];
  position: string;
  onSelect: (employeeId: string) => void;
  allSlots: ScheduleSlot[];
  slotDayOfWeek: number;
  slotStartTime: string;
  slotEndTime: string;
}) {
  const [search, setSearch] = useState('');

  // Map employee → overlapping time range on same day
  const overlapMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of allSlots) {
      if (!slot.employee_id) continue;
      const wts = slot.week_template_slot;
      const st = wts?.shift_template;
      if (!wts || !st) continue;
      if (wts.day_of_week !== slotDayOfWeek) continue;
      if (timesOverlap(slotStartTime, slotEndTime, st.start_time, st.end_time)) {
        map.set(
          slot.employee_id,
          `${formatTime(st.start_time)} \u2013 ${formatTime(st.end_time)}`,
        );
      }
    }
    return map;
  }, [allSlots, slotDayOfWeek, slotStartTime, slotEndTime]);

  // Role-matched employees first, then others
  const { roleMatched, others } = useMemo(() => {
    let active = employees.filter((e) => e.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      active = active.filter(
        (e) => e.name.toLowerCase().includes(q) || e.position.toLowerCase().includes(q),
      );
    }
    if (position === 'Any') {
      return { roleMatched: active, others: [] as Employee[] };
    }
    const matched: Employee[] = [];
    const rest: Employee[] = [];
    for (const emp of active) {
      if (emp.position === position) matched.push(emp);
      else rest.push(emp);
    }
    return { roleMatched: matched, others: rest };
  }, [employees, position, search]);

  const renderRow = (emp: Employee) => {
    const overlap = overlapMap.get(emp.id);
    return (
      <button
        key={emp.id}
        onClick={() => onSelect(emp.id)}
        className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {overlap && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
            <span className="text-[12px] font-medium text-foreground truncate">{emp.name}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">{emp.position}</span>
          {overlap && (
            <p className="text-[9px] text-amber-500">Scheduled {overlap}</p>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="h-7 text-[12px] pl-6 bg-muted/30 border-border/40 rounded-lg"
          autoFocus
        />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {roleMatched.length === 0 && others.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-3">No employees found</p>
        ) : (
          <>
            {position !== 'Any' && roleMatched.length > 0 && (
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-1">
                {position}
              </p>
            )}
            {roleMatched.map(renderRow)}
            {others.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-2">
                  Other Roles
                </p>
                {others.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleBoardProps {
  restaurantId: string;
  weekStartDate: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScheduleBoard({ restaurantId, weekStartDate, onBack }: ScheduleBoardProps) {
  const { slots, isLoading } = useScheduleSlots(restaurantId, weekStartDate);
  const { employees } = useEmployees(restaurantId);
  const assignMutation = useAssignEmployee();
  const unassignMutation = useUnassignEmployee();
  const bulkAssignMutation = useBulkAssignEmployee();
  const deleteMutation = useDeleteGeneratedSchedule();
  const publishMutation = usePublishSchedule();
  const { isPublished } = useWeekPublicationStatus(restaurantId, weekStartDate);
  const { toast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  // Track which popover is open (by group key) so we can close it on select
  const [activePopover, setActivePopover] = useState<string | null>(null);

  // Day columns grouped for the grid
  const dayColumns = useMemo(() => buildDayColumns(slots, weekStartDate), [slots, weekStartDate]);

  // Progress stats
  const totalSlots = slots.length;
  const filledSlots = slots.filter(
    (s) => s.status === 'assigned' || s.status === 'confirmed',
  ).length;
  const progressPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  // Sidebar: employees grouped by position
  const employeesByPosition = useMemo(() => {
    let active = employees.filter((e) => e.is_active);
    if (sidebarSearch.trim()) {
      const q = sidebarSearch.toLowerCase();
      active = active.filter(
        (e) => e.name.toLowerCase().includes(q) || e.position.toLowerCase().includes(q),
      );
    }
    const groups = new Map<string, Employee[]>();
    for (const emp of active) {
      const pos = emp.position || 'Other';
      if (!groups.has(pos)) groups.set(pos, []);
      groups.get(pos)!.push(emp);
    }
    return groups;
  }, [employees, sidebarSearch]);

  // Weekly hours per employee (displayed in sidebar)
  const employeeWeekHours = useMemo(() => {
    const hours = new Map<string, number>();
    for (const slot of slots) {
      if (!slot.employee_id) continue;
      const st = slot.week_template_slot?.shift_template;
      if (!st) continue;
      const [sh, sm] = st.start_time.split(':').map(Number);
      const [eh, em] = st.end_time.split(':').map(Number);
      let diff = eh * 60 + em - (sh * 60 + sm);
      if (diff <= 0) diff += 24 * 60;
      const h = Math.max(0, (diff - (st.break_duration || 0)) / 60);
      hours.set(slot.employee_id, (hours.get(slot.employee_id) || 0) + h);
    }
    return hours;
  }, [slots]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleAssign = useCallback(
    async (
      slotId: string,
      shiftId: string | null,
      employeeId: string,
      shiftTemplateId: string,
      dayOfWeek: number,
    ) => {
      // Pre-calculate matching unfilled slots on other days BEFORE the assignment
      const otherDaySlots = slots.filter((s) => {
        const wts = s.week_template_slot;
        if (!wts) return false;
        return (
          wts.shift_template_id === shiftTemplateId &&
          wts.day_of_week !== dayOfWeek &&
          s.status === 'unfilled'
        );
      });

      // One unfilled slot per other day
      const perDaySlots = new Map<number, ScheduleSlot>();
      for (const s of otherDaySlots) {
        const day = s.week_template_slot!.day_of_week;
        if (!perDaySlots.has(day)) perDaySlots.set(day, s);
      }

      const assignmentsForLater = Array.from(perDaySlots.values()).map((s) => ({
        slotId: s.id,
        shiftId: s.shift_id ?? null,
        employeeId,
      }));

      // Close popover immediately
      setActivePopover(null);

      try {
        await assignMutation.mutateAsync({
          slotId,
          shiftId,
          employeeId,
          restaurantId,
          weekStartDate,
          silent: true,
        });

        const emp = employees.find((e) => e.id === employeeId);
        const empName = emp?.name || 'Employee';

        if (assignmentsForLater.length > 0) {
          toast({
            title: `Assigned ${empName}`,
            description: `Apply to ${assignmentsForLater.length} other day${assignmentsForLater.length === 1 ? '' : 's'}?`,
            action: (
              <ToastAction
                altText="Apply to all days"
                onClick={() => {
                  bulkAssignMutation.mutate({
                    assignments: assignmentsForLater,
                    restaurantId,
                    weekStartDate,
                  });
                }}
              >
                Apply All
              </ToastAction>
            ),
          });
        } else {
          toast({ title: `Assigned ${empName}` });
        }
      } catch {
        // Error toast handled by mutation's onError
      }
    },
    [assignMutation, bulkAssignMutation, employees, restaurantId, weekStartDate, slots, toast],
  );

  const handleUnassign = useCallback(
    (slotId: string, shiftId: string | null) => {
      unassignMutation.mutate({ slotId, shiftId, restaurantId, weekStartDate });
    },
    [unassignMutation, restaurantId, weekStartDate],
  );

  const handleClearSchedule = useCallback(() => {
    deleteMutation.mutate(
      { restaurantId, weekStartDate },
      {
        onSuccess: () => {
          setClearDialogOpen(false);
          onBack();
        },
      },
    );
  }, [deleteMutation, restaurantId, weekStartDate, onBack]);

  const handlePublish = useCallback(() => {
    publishMutation.mutate({ restaurantId, weekStartDate });
  }, [publishMutation, restaurantId, weekStartDate]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={onBack}
          className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Template
        </Button>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <CalendarDays className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-[14px] font-medium text-foreground">No schedule slots</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Generate a schedule from a template first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h2 className="text-[17px] font-semibold text-foreground">
            {formatWeekRange(weekStartDate)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle employee sidebar"
            className={cn(
              'h-9 w-9 p-0 rounded-lg transition-colors',
              sidebarOpen
                ? 'text-foreground bg-muted/50'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Users className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => setClearDialogOpen(true)}
            className="h-9 px-3 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
          {isPublished ? (
            <span className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Published
            </span>
          ) : (
            <Button
              onClick={handlePublish}
              disabled={filledSlots === 0 || publishMutation.isPending}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {publishMutation.isPending ? 'Publishing...' : 'Publish'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Progress value={progressPct} className="h-2 flex-1" />
        <span className="text-[13px] font-medium text-muted-foreground shrink-0">
          {filledSlots}/{totalSlots} filled
        </span>
      </div>

      {/* ── Main area: sidebar + 7-day grid ───────────────────────────────── */}
      <div className="flex gap-3">
        {/* ── Employee sidebar ───────────────────────────────────────────── */}
        {sidebarOpen && (
          <div className="w-48 shrink-0 rounded-xl border border-border/40 bg-muted/10 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/40 bg-muted/30">
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[13px] font-semibold text-foreground">Team</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted ml-auto">
                  {employees.filter((e) => e.is_active).length}
                </span>
              </div>
            </div>
            <div className="p-2">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder="Search..."
                  className="h-7 text-[12px] pl-6 bg-muted/30 border-border/40 rounded-lg"
                />
              </div>
              <div className="max-h-[500px] overflow-y-auto space-y-3">
                {Array.from(employeesByPosition.entries()).map(([position, emps]) => (
                  <div key={position}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
                      {position}
                    </p>
                    <div className="space-y-0.5">
                      {emps.map((emp) => {
                        const hours = employeeWeekHours.get(emp.id) || 0;
                        return (
                          <div
                            key={emp.id}
                            className="flex items-center justify-between px-1.5 py-1 rounded-md text-[12px]"
                          >
                            <span className="text-foreground truncate">{emp.name}</span>
                            {hours > 0 && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {Math.round(hours * 10) / 10}h
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {employeesByPosition.size === 0 && (
                  <p className="text-[12px] text-muted-foreground text-center py-4">
                    No employees found
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 7-day grid ──────────────────────────────────────────────────── */}
        <div className="flex-1 grid grid-cols-7 gap-2 min-w-0">
          {dayColumns.map((col) => {
            const dateStr = col.date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            const filledInDay = col.groups.reduce(
              (sum, g) => sum + g.slots.filter((s) => s.employee_id).length,
              0,
            );
            const totalInDay = col.groups.reduce((sum, g) => sum + g.slots.length, 0);

            return (
              <div
                key={col.dayOfWeek}
                className="flex flex-col rounded-xl border border-border/40 bg-muted/10 overflow-hidden min-w-0"
              >
                {/* Day header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/30">
                  <div className="min-w-0">
                    <span className="text-[13px] font-semibold text-foreground">
                      {DAY_SHORT[col.dayOfWeek]}
                    </span>
                    <span className="text-[11px] text-muted-foreground ml-1">
                      {dateStr.split(' ')[1]}
                    </span>
                  </div>
                  {totalInDay > 0 && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      {filledInDay}/{totalInDay}
                    </span>
                  )}
                </div>

                {/* Shift blocks */}
                <div className="flex-1 p-1.5 space-y-1.5 min-h-[120px]">
                  {col.groups.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground text-center py-6">
                      No shifts
                    </p>
                  ) : (
                    col.groups.map((group) => {
                      const filled = group.slots.filter((s) => s.employee_id);
                      const unfilled = group.slots.filter((s) => !s.employee_id);
                      const popoverKey = `${col.dayOfWeek}-${group.key}`;

                      return (
                        <div
                          key={group.key}
                          className="rounded-lg border border-border/40 bg-background overflow-hidden"
                          style={{ borderLeftWidth: 3, borderLeftColor: group.shiftColor }}
                        >
                          {/* Shift header */}
                          <div className="px-2 py-1.5 border-b border-border/20">
                            <p className="text-[11px] font-medium text-foreground leading-tight truncate">
                              {group.shiftName}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatTime(group.startTime)} &ndash;{' '}
                              {formatTime(group.endTime)}
                            </p>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                              {group.position}
                            </span>
                          </div>

                          {/* Assigned employees + unfilled button */}
                          <div className="px-2 py-1 space-y-0.5">
                            {filled.map((slot) => (
                              <div
                                key={slot.id}
                                className="group flex items-center justify-between"
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <div className="h-4 w-4 rounded-full bg-muted/50 flex items-center justify-center text-[8px] font-semibold text-foreground shrink-0">
                                    {slot.employee?.name?.charAt(0)?.toUpperCase() || '?'}
                                  </div>
                                  <span className="text-[11px] text-foreground truncate">
                                    {slot.employee?.name || 'Unknown'}
                                  </span>
                                </div>
                                <button
                                  onClick={() =>
                                    handleUnassign(slot.id, slot.shift_id ?? null)
                                  }
                                  aria-label={`Unassign ${slot.employee?.name || 'employee'}`}
                                  className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}

                            {/* Unfilled slots — click to assign */}
                            {unfilled.length > 0 && (
                              <Popover
                                open={activePopover === popoverKey}
                                onOpenChange={(open) =>
                                  setActivePopover(open ? popoverKey : null)
                                }
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    className="w-full flex items-center justify-center gap-1 py-1 rounded-md border border-dashed border-border/60 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                                    aria-label={`Assign ${unfilled.length} unfilled slot${unfilled.length > 1 ? 's' : ''} for ${group.shiftName} on ${DAY_SHORT[col.dayOfWeek]}`}
                                  >
                                    +{unfilled.length} unfilled
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-56 p-2">
                                  <SlotAssignPopover
                                    employees={employees}
                                    position={group.position}
                                    onSelect={(empId) => {
                                      const firstUnfilled = unfilled[0];
                                      handleAssign(
                                        firstUnfilled.id,
                                        firstUnfilled.shift_id ?? null,
                                        empId,
                                        group.shiftTemplateId,
                                        col.dayOfWeek,
                                      );
                                    }}
                                    allSlots={slots}
                                    slotDayOfWeek={col.dayOfWeek}
                                    slotStartTime={group.startTime}
                                    slotEndTime={group.endTime}
                                  />
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Clear schedule confirm ────────────────────────────────────────── */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear entire schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all generated shifts and slots for the week of{' '}
              {formatWeekRange(weekStartDate)}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearSchedule}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Clearing...' : 'Clear Schedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
