import { memo, useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmployees } from '@/hooks/useEmployees';
import { useEmployeeAvailability, useAvailabilityExceptions } from '@/hooks/useAvailability';
import { computeEffectiveAvailability, EffectiveAvailability } from '@/lib/effectiveAvailability';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

// ─── Day column definitions (Mon–Sun order) ───────────────────────────────────

const DAY_COLUMNS = [
  { dow: 1, label: 'Mon', short: 'M' },
  { dow: 2, label: 'Tue', short: 'T' },
  { dow: 3, label: 'Wed', short: 'W' },
  { dow: 4, label: 'Thu', short: 'T' },
  { dow: 5, label: 'Fri', short: 'F' },
  { dow: 6, label: 'Sat', short: 'S' },
  { dow: 0, label: 'Sun', short: 'S' },
] as const;

// ─── Helper functions ─────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift so Monday is start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const startMonth = weekStart.toLocaleString('default', { month: 'short' });
  const endMonth = weekEnd.toLocaleString('default', { month: 'short' });
  const endYear = weekEnd.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${endYear}`;
  }
  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${weekEnd.getDate()}, ${endYear}`;
}

function getDateForDayOfWeek(weekStart: Date, dow: number): Date {
  // weekStart is a Monday (dow=1)
  // dow: 0=Sun, 1=Mon … 6=Sat
  const d = new Date(weekStart);
  const offset = dow === 0 ? 6 : dow - 1; // Mon=0 offset, Sun=6 offset
  d.setDate(d.getDate() + offset);
  return d;
}

function formatTimeShort(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const suffix = hour < 12 ? 'a' : 'p';
  const h = hour % 12 || 12;
  if (minute === 0) return `${h}${suffix}`;
  return `${h}:${minuteStr}${suffix}`;
}

function formatSlotRange(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  return `${formatTimeShort(start)}–${formatTimeShort(end)}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ─── AvailabilityCell ─────────────────────────────────────────────────────────

interface AvailabilityCellProps {
  effective: EffectiveAvailability;
  date: Date;
  employeeId: string;
  dow: number;
  availability: EmployeeAvailability[];
  exceptions: AvailabilityException[];
  onOpenAvailabilityDialog: (employeeId: string, dayOfWeek: number, availability?: EmployeeAvailability) => void;
  onOpenExceptionDialog: (employeeId: string, date: Date, exception?: AvailabilityException) => void;
  compact?: boolean;
}

const AvailabilityCell = memo(function AvailabilityCell({
  effective,
  date,
  employeeId,
  dow,
  availability,
  exceptions,
  onOpenAvailabilityDialog,
  onOpenExceptionDialog,
  compact = false,
}: AvailabilityCellProps) {
  const dateStr = toDateStr(date);

  const handleClick = useCallback(() => {
    if (effective.type === 'exception') {
      const exc = exceptions.find((e) => e.employee_id === employeeId && e.date === dateStr);
      onOpenExceptionDialog(employeeId, date, exc);
    } else if (effective.type === 'recurring') {
      const avail = availability.find(
        (a) => a.employee_id === employeeId && a.day_of_week === dow,
      );
      onOpenAvailabilityDialog(employeeId, dow, avail);
    } else {
      onOpenAvailabilityDialog(employeeId, dow, undefined);
    }
  }, [effective.type, employeeId, dow, date, dateStr, availability, exceptions, onOpenAvailabilityDialog, onOpenExceptionDialog]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  // Determine display values
  const slot = effective.slots[0];
  const isAvailable = slot?.isAvailable ?? false;
  const isException = effective.type === 'exception';
  const isExceptionAvailable = isException && isAvailable;
  const isExceptionUnavailable = isException && !isAvailable;
  const isRecurringAvailable = effective.type === 'recurring' && isAvailable;
  let bgClass = 'bg-muted/30 hover:bg-muted/50';
  let textClass = 'text-muted-foreground';
  let ariaLabel = `${dow} not set`;

  if (isRecurringAvailable || isExceptionAvailable) {
    bgClass = 'bg-emerald-500/10 hover:bg-emerald-500/20';
    textClass = 'text-emerald-700 dark:text-emerald-400';
  } else if (isExceptionUnavailable) {
    bgClass = 'bg-amber-500/10 hover:bg-amber-500/20';
    textClass = 'text-amber-700 dark:text-amber-400';
  }

  let timeDisplay = '—';
  if (isRecurringAvailable || isExceptionAvailable) {
    timeDisplay = formatSlotRange(slot?.startTime ?? null, slot?.endTime ?? null);
  } else if (isExceptionUnavailable) {
    timeDisplay = slot?.reason ? slot.reason.slice(0, 8) : 'Off';
  }

  const splitTime =
    (isRecurringAvailable || isExceptionAvailable) && slot?.startTime && slot?.endTime
      ? [formatTimeShort(slot.startTime), formatTimeShort(slot.endTime)]
      : null;

  if (isException) {
    const exc = exceptions.find((e) => e.employee_id === employeeId && e.date === dateStr);
    ariaLabel = exc
      ? `Exception on ${dateStr}: ${exc.is_available ? 'available' : 'unavailable'}${exc.reason ? ` (${exc.reason})` : ''}`
      : `Add exception for ${dateStr}`;
  } else if (effective.type === 'recurring' && slot) {
    ariaLabel = slot.isAvailable
      ? `Available ${formatSlotRange(slot.startTime, slot.endTime)}`
      : 'Unavailable (recurring)';
  } else {
    ariaLabel = 'No availability set — click to add';
  }

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`flex flex-col items-center justify-center rounded-lg border border-border/40 cursor-pointer transition-colors ${bgClass} min-h-[44px] px-1 py-1 relative`}
      >
        {isExceptionAvailable && (
          <Zap className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-500" />
        )}
        {splitTime ? (
          <>
            <span className={`text-[10px] font-medium leading-tight ${textClass}`}>{splitTime[0]}</span>
            <span className={`text-[10px] leading-tight ${textClass}`}>{splitTime[1]}</span>
          </>
        ) : (
          <span className={`text-[11px] font-medium ${textClass}`}>{timeDisplay}</span>
        )}
      </div>
    );
  }

  return (
    <td className="px-2 py-2">
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`flex flex-col items-center justify-center rounded-lg border border-border/40 cursor-pointer transition-colors ${bgClass} h-14 px-2 py-1 relative min-w-[72px]`}
      >
        {isExceptionAvailable && (
          <Zap className="absolute top-1 right-1 h-3 w-3 text-amber-500" />
        )}
        {splitTime ? (
          <>
            <span className={`text-[11px] font-medium leading-tight ${textClass}`}>{splitTime[0]}</span>
            <span className={`text-[10px] leading-tight ${textClass} opacity-80`}>{splitTime[1]}</span>
          </>
        ) : (
          <span className={`text-[12px] font-medium ${textClass}`}>{timeDisplay}</span>
        )}
      </div>
    </td>
  );
},
(prev, next) =>
  prev.effective === next.effective &&
  prev.employeeId === next.employeeId &&
  prev.dow === next.dow &&
  prev.date.getTime() === next.date.getTime() &&
  prev.compact === next.compact &&
  prev.availability === next.availability &&
  prev.exceptions === next.exceptions,
);

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TeamAvailabilityGridProps {
  restaurantId: string;
  onOpenAvailabilityDialog: (
    employeeId: string,
    dayOfWeek: number,
    availability?: EmployeeAvailability,
  ) => void;
  onOpenExceptionDialog: (
    employeeId: string,
    date: Date,
    exception?: AvailabilityException,
  ) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TeamAvailabilityGrid({
  restaurantId,
  onOpenAvailabilityDialog,
  onOpenExceptionDialog,
}: TeamAvailabilityGridProps) {
  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(today));

  // Data fetching
  const { employees, loading: employeesLoading } = useEmployees(restaurantId);
  const { availability, loading: availLoading } = useEmployeeAvailability(restaurantId);
  const { exceptions, loading: excLoading } = useAvailabilityExceptions(restaurantId);

  const isLoading = employeesLoading || availLoading || excLoading;

  // Active employees only
  const activeEmployees = useMemo(
    () => (employees ?? []).filter((e) => e.status === 'active'),
    [employees],
  );

  // Compute effective availability map for the displayed week
  const effectiveMap = useMemo(
    () =>
      computeEffectiveAvailability(
        availability,
        exceptions,
        weekStart,
        activeEmployees.map((e) => e.id),
      ),
    [availability, exceptions, weekStart, activeEmployees],
  );

  // Navigation handlers
  const goToPrevWeek = useCallback(() => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }, []);

  const goToToday = useCallback(() => {
    setWeekStart(getMondayOfWeek(new Date()));
  }, []);

  // Determine if today is in the displayed week
  const todayStr = toDateStr(today);
  const isCurrentWeek = getMondayOfWeek(today).getTime() === weekStart.getTime();

  // Pre-compute day dates for this week
  const dayDates = useMemo(
    () => DAY_COLUMNS.map((col) => getDateForDayOfWeek(weekStart, col.dow)),
    [weekStart],
  );

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevWeek}
            aria-label="Previous week"
            className="h-8 w-8 rounded-lg"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextWeek}
            aria-label="Next week"
            className="h-8 w-8 rounded-lg"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-[14px] font-medium text-foreground ml-1">
            {formatWeekRange(weekStart)}
          </span>
        </div>
        {!isCurrentWeek && (
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
            className="h-8 rounded-lg text-[13px] font-medium border-border/40"
          >
            <Calendar className="h-3.5 w-3.5 mr-1.5" />
            Today
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : activeEmployees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-border/40 bg-muted/20">
          <p className="text-[14px] font-medium text-foreground">No active employees</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Add employees to manage their availability.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop grid */}
          <div className="hidden md:block rounded-xl border border-border/40 bg-background overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border/40">
                  <th
                    className="w-40 px-4 py-3 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                    scope="col"
                  >
                    Employee
                  </th>
                  {DAY_COLUMNS.map((col, i) => {
                    const date = dayDates[i];
                    const dateStr = toDateStr(date);
                    const isToday = dateStr === todayStr;
                    return (
                      <th
                        key={col.dow}
                        scope="col"
                        className="px-2 py-3 text-center"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span
                            className={`text-[12px] font-medium uppercase tracking-wider ${isToday ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {col.label}
                          </span>
                          <span
                            className={`text-[13px] font-semibold ${isToday ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {date.getDate()}
                          </span>
                          {isToday && (
                            <div className="h-1 w-1 rounded-full bg-foreground" />
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeEmployees.map((employee) => {
                  const empEffective = effectiveMap.get(employee.id);
                  const hasAnyAvailability =
                    empEffective &&
                    [...empEffective.values()].some((ea) => ea.type !== 'not-set');

                  return (
                    <tr
                      key={employee.id}
                      className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      {/* Employee info */}
                      <td className="px-4 py-3 w-40">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {getInitials(employee.name)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">
                              {employee.name}
                            </p>
                            <p className="text-[13px] text-muted-foreground truncate">
                              {employee.position}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Day cells or "no availability" row */}
                      {!hasAnyAvailability ? (
                        <td
                          colSpan={7}
                          className="px-4 py-3 text-center"
                        >
                          <button
                            onClick={() =>
                              onOpenAvailabilityDialog(employee.id, 1, undefined)
                            }
                            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                          >
                            No availability set — Set now
                          </button>
                        </td>
                      ) : (
                        DAY_COLUMNS.map((col, i) => {
                          const date = dayDates[i];
                          const eff = empEffective?.get(col.dow) ?? {
                            type: 'not-set' as const,
                            slots: [],
                          };
                          return (
                            <AvailabilityCell
                              key={col.dow}
                              effective={eff}
                              date={date}
                              employeeId={employee.id}
                              dow={col.dow}
                              availability={availability}
                              exceptions={exceptions}
                              onOpenAvailabilityDialog={onOpenAvailabilityDialog}
                              onOpenExceptionDialog={onOpenExceptionDialog}
                            />
                          );
                        })
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {activeEmployees.map((employee) => {
              const empEffective = effectiveMap.get(employee.id);
              const hasAnyAvailability =
                empEffective &&
                [...empEffective.values()].some((ea) => ea.type !== 'not-set');

              return (
                <div
                  key={employee.id}
                  className="rounded-xl border border-border/40 bg-background p-4"
                >
                  {/* Employee header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <span className="text-[12px] font-semibold text-muted-foreground">
                        {getInitials(employee.name)}
                      </span>
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-foreground">
                        {employee.name}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {employee.position}
                      </p>
                    </div>
                  </div>

                  {!hasAnyAvailability ? (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 border border-border/40">
                      <span className="text-[13px] text-muted-foreground">
                        No availability set
                      </span>
                      <button
                        onClick={() =>
                          onOpenAvailabilityDialog(employee.id, 1, undefined)
                        }
                        className="text-[13px] font-medium text-foreground hover:underline underline-offset-2 transition-colors"
                      >
                        Set availability
                      </button>
                    </div>
                  ) : (
                    /* 7-day strip */
                    <div className="grid grid-cols-7 gap-1">
                      {DAY_COLUMNS.map((col, i) => {
                        const date = dayDates[i];
                        const dateStr = toDateStr(date);
                        const isToday = dateStr === todayStr;
                        const eff = empEffective?.get(col.dow) ?? {
                          type: 'not-set' as const,
                          slots: [],
                        };
                        return (
                          <div key={col.dow} className="flex flex-col items-center gap-1">
                            <span
                              className={`text-[10px] font-medium uppercase ${isToday ? 'text-foreground' : 'text-muted-foreground'}`}
                            >
                              {col.short}
                            </span>
                            <AvailabilityCell
                              effective={eff}
                              date={date}
                              employeeId={employee.id}
                              dow={col.dow}
                              availability={availability}
                              exceptions={exceptions}
                              onOpenAvailabilityDialog={onOpenAvailabilityDialog}
                              onOpenExceptionDialog={onOpenExceptionDialog}
                              compact
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 pt-1">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="text-[12px] text-muted-foreground">Available</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="text-[12px] text-muted-foreground">Exception</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
              <span className="text-[12px] text-muted-foreground">Unavailable</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
