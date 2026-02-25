import { useState, useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
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

import { ArrowLeft, Trash2, UserPlus, X, Search, CalendarDays, AlertTriangle, CheckCircle2 } from 'lucide-react';

import {
  useScheduleSlots,
  useAssignEmployee,
  useUnassignEmployee,
  useDeleteGeneratedSchedule,
} from '@/hooks/useScheduleSlots';
import { useEmployees } from '@/hooks/useEmployees';
import { usePublishSchedule, useWeekPublicationStatus } from '@/hooks/useSchedulePublish';

import { ScheduleSlot, Employee } from '@/types/scheduling';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Format a date range for the header: "Feb 24 – Mar 2, 2026" */
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

/** Get the date for a specific day_of_week within the given week start (Monday). */
function dateForDay(weekStartStr: string, dayOfWeek: number): Date {
  const start = new Date(weekStartStr + 'T00:00:00');
  // weekStart is Monday (1). dayOfWeek: 0=Sun,1=Mon,...,6=Sat
  // offset: Mon=0, Tue=1, ..., Sat=5, Sun=6
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const d = new Date(start);
  d.setDate(start.getDate() + offset);
  return d;
}

// ---------------------------------------------------------------------------
// Grouped slot structure
// ---------------------------------------------------------------------------

interface SlotGroup {
  dayOfWeek: number;
  date: Date;
  shiftName: string;
  shiftColor: string;
  timeRange: string;
  position: string;
  slots: ScheduleSlot[];
}

function groupSlots(slots: ScheduleSlot[], weekStartDate: string): SlotGroup[] {
  // Build groups keyed by day + week_template_slot_id
  const groupMap = new Map<string, SlotGroup>();

  for (const slot of slots) {
    const wts = slot.week_template_slot;
    const st = wts?.shift_template;
    if (!wts || !st) continue;

    const key = `${wts.day_of_week}-${wts.id}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        dayOfWeek: wts.day_of_week,
        date: dateForDay(weekStartDate, wts.day_of_week),
        shiftName: st.name,
        shiftColor: st.color || '#3b82f6',
        timeRange: `${formatTime(st.start_time)} \u2013 ${formatTime(st.end_time)}`,
        position: wts.position || st.position || 'Any',
        slots: [],
      });
    }
    groupMap.get(key)!.slots.push(slot);
  }

  // Sort groups: by day (Mon first), then by shift name
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
  return Array.from(groupMap.values()).sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek);
    if (dayDiff !== 0) return dayDiff;
    return a.shiftName.localeCompare(b.shiftName);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduleAssignmentProps {
  restaurantId: string;
  weekStartDate: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Sub-component: Employee selector popover
// ---------------------------------------------------------------------------

/** Check if two time ranges overlap (supports overnight shifts). */
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

  // Handle overnight shifts by extending past midnight
  if (aEnd <= aStart) aEnd += 24 * 60;
  if (bEnd <= bStart) bEnd += 24 * 60;

  return aStart < bEnd && bStart < aEnd;
}

interface OverlapInfo {
  timeRange: string;
}

interface EmployeeSelectorProps {
  employees: Employee[];
  assignedIds: Set<string>;
  position: string;
  onSelect: (employeeId: string) => void;
  /** All schedule slots for this week, used to detect time overlaps */
  allSlots: ScheduleSlot[];
  /** The day_of_week and time range of the slot being assigned */
  slotDayOfWeek: number;
  slotStartTime: string;
  slotEndTime: string;
}

function EmployeeSelector({
  employees,
  assignedIds,
  position,
  onSelect,
  allSlots,
  slotDayOfWeek,
  slotStartTime,
  slotEndTime,
}: EmployeeSelectorProps) {
  const [search, setSearch] = useState('');

  // Build a map of employee_id -> overlap info for this slot
  const overlapMap = useMemo(() => {
    const map = new Map<string, OverlapInfo>();
    for (const slot of allSlots) {
      if (!slot.employee_id) continue;
      const wts = slot.week_template_slot;
      const st = wts?.shift_template;
      if (!wts || !st) continue;

      // Same day check
      if (wts.day_of_week !== slotDayOfWeek) continue;

      // Time overlap check
      if (timesOverlap(slotStartTime, slotEndTime, st.start_time, st.end_time)) {
        map.set(slot.employee_id, {
          timeRange: `${formatTime(st.start_time)} \u2013 ${formatTime(st.end_time)}`,
        });
      }
    }
    return map;
  }, [allSlots, slotDayOfWeek, slotStartTime, slotEndTime]);

  // Filter: match position (unless "Any"), then by search
  const filtered = useMemo(() => {
    let list = employees.filter((e) => e.is_active);
    if (position !== 'Any') {
      list = list.filter((e) => e.position === position);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || e.position.toLowerCase().includes(q),
      );
    }
    return list;
  }, [employees, position, search]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees..."
          className="h-8 text-[13px] pl-7 bg-muted/30 border-border/40 rounded-lg"
        />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-3">
            No matching employees
          </p>
        ) : (
          filtered.map((emp) => {
            const alreadyAssigned = assignedIds.has(emp.id);
            const overlap = overlapMap.get(emp.id);
            return (
              <button
                key={emp.id}
                onClick={() => !alreadyAssigned && onSelect(emp.id)}
                disabled={alreadyAssigned}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors',
                  alreadyAssigned
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-muted/50 cursor-pointer',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {overlap && !alreadyAssigned && (
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    )}
                    <p className="text-[13px] font-medium text-foreground truncate">{emp.name}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{emp.position}</p>
                  {overlap && !alreadyAssigned && (
                    <p className="text-[10px] text-amber-500 mt-0.5">
                      Already scheduled {overlap.timeRange}
                    </p>
                  )}
                </div>
                {alreadyAssigned && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                    Assigned
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScheduleAssignment({
  restaurantId,
  weekStartDate,
  onBack,
}: ScheduleAssignmentProps) {
  const { slots, isLoading } = useScheduleSlots(restaurantId, weekStartDate);
  const { employees } = useEmployees(restaurantId);
  const assignMutation = useAssignEmployee();
  const unassignMutation = useUnassignEmployee();
  const deleteMutation = useDeleteGeneratedSchedule();
  const publishMutation = usePublishSchedule();
  const { isPublished } = useWeekPublicationStatus(restaurantId, weekStartDate);

  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  // Group slots
  const groups = useMemo(() => groupSlots(slots, weekStartDate), [slots, weekStartDate]);

  // Stats
  const totalSlots = slots.length;
  const filledSlots = slots.filter((s) => s.status === 'assigned' || s.status === 'confirmed').length;
  const progressPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  // Set of already-assigned employee IDs (for greying out)
  const assignedEmployeeIds = useMemo(
    () => new Set(slots.filter((s) => s.employee_id).map((s) => s.employee_id!)),
    [slots],
  );

  // Handlers
  const handleAssign = useCallback(
    (slotId: string, shiftId: string | null, employeeId: string) => {
      assignMutation.mutate({ slotId, shiftId, employeeId, restaurantId, weekStartDate });
    },
    [assignMutation, restaurantId, weekStartDate],
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

  // Publish schedule
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
        <Skeleton className="h-6 w-48 rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
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
      {/* ── Header ──────────────────────────────────────────────────────── */}
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
            onClick={() => setClearDialogOpen(true)}
            className="h-9 px-3 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear Schedule
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

      {/* ── Progress ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Progress value={progressPct} className="h-2 flex-1" />
        <span className="text-[13px] font-medium text-muted-foreground shrink-0">
          {filledSlots}/{totalSlots} filled
        </span>
      </div>

      {/* ── Day groups ──────────────────────────────────────────────────── */}
      <div className="space-y-6">
        {(() => {
          // Group by day for day headers
          let currentDay = -1;
          const elements: React.ReactNode[] = [];

          for (const group of groups) {
            if (group.dayOfWeek !== currentDay) {
              currentDay = group.dayOfWeek;
              const dateStr = group.date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              elements.push(
                <h3
                  key={`day-${currentDay}`}
                  className="text-[14px] font-semibold text-foreground pt-2 first:pt-0"
                >
                  {DAY_NAMES_FULL[currentDay]}, {dateStr}
                </h3>,
              );
            }

            elements.push(
              <div
                key={`group-${group.dayOfWeek}-${group.shiftName}-${group.position}`}
                className="rounded-xl border border-border/40 overflow-hidden"
              >
                {/* Group header */}
                <div
                  className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40"
                  style={{ borderLeftWidth: 3, borderLeftColor: group.shiftColor }}
                >
                  <span className="text-[13px] font-semibold text-foreground">
                    {group.shiftName}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{group.timeRange}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                    {group.position}
                  </span>
                </div>

                {/* Slot cards */}
                <div className="divide-y divide-border/40">
                  {group.slots.map((slot) => {
                    const isFilled = !!slot.employee_id;
                    return (
                      <div
                        key={slot.id}
                        className={cn(
                          'flex items-center justify-between px-4 py-3',
                          !isFilled && 'border border-dashed border-border/60 bg-muted/10',
                        )}
                      >
                        {isFilled ? (
                          <>
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-muted/50 flex items-center justify-center text-[11px] font-semibold text-foreground">
                                {slot.employee?.name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <span className="text-[14px] font-medium text-foreground">
                                {slot.employee?.name || 'Unknown'}
                              </span>
                            </div>
                            <button
                              onClick={() => handleUnassign(slot.id, slot.shift_id ?? null)}
                              aria-label={`Unassign ${slot.employee?.name || 'employee'}`}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                              {group.position}
                            </span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className="h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground"
                                >
                                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                                  Assign
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                className="w-64 p-3"
                              >
                                <EmployeeSelector
                                  employees={employees}
                                  assignedIds={assignedEmployeeIds}
                                  position={group.position}
                                  onSelect={(empId) =>
                                    handleAssign(slot.id, slot.shift_id ?? null, empId)
                                  }
                                  allSlots={slots}
                                  slotDayOfWeek={group.dayOfWeek}
                                  slotStartTime={slot.week_template_slot?.shift_template?.start_time ?? '00:00'}
                                  slotEndTime={slot.week_template_slot?.shift_template?.end_time ?? '23:59'}
                                />
                              </PopoverContent>
                            </Popover>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>,
            );
          }

          return elements;
        })()}
      </div>

      {/* ── Clear schedule confirm ──────────────────────────────────────── */}
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
