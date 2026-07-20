import { useEffect, useState } from 'react';
import { format, isToday as isDateToday } from 'date-fns';
import { Edit, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isMinor } from '@/lib/employeeUtils';
import { pickDefaultMobileDay } from '@/lib/scheduleMobile';
import { weekAvailabilityChipClasses, type WeekAvailabilitySummary } from '@/lib/effectiveAvailability';
import type { EmployeeWeekTimeOff } from '@/lib/scheduleTimeOff';
import { SchedulingTimeOffCellContent } from '@/pages/SchedulingTimeOffCellContent';
import { ShiftCard } from '@/pages/SchedulingShiftCard';
import type { DefaultEmployee } from '@/components/ShiftDialog';
import type { Employee, Shift } from '@/types/scheduling';

// The time_off state of the weekly availability chip is always the muted
// family (mirrors the module-level const in Scheduling.tsx).
const TIME_OFF_CHIP_CLASSES = weekAvailabilityChipClasses('time_off')!;

export interface WeekScheduleMobileProps {
  weekDays: Date[];
  employees: Employee[];
  getShiftsForEmployee: (employeeId: string, day: Date) => Shift[];
  weekTimeOff: Map<string, EmployeeWeekTimeOff>;
  weekAvailabilityByEmployee: Map<string, WeekAvailabilitySummary>;
  hoursPerEmployee: Map<string, number>;
  selectionMode: boolean;
  selectedShiftIds: Set<string>;
  onEditEmployee: (employee: Employee) => void;
  onAddShift: (date?: Date, employee?: DefaultEmployee) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  onToggleSelectShift: (shiftId: string) => void;
}

function initialsFor(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

interface DayPickerStripProps {
  weekDays: Date[];
  selectedDayIndex: number;
  onSelect: (index: number) => void;
}

function DayPickerStrip({ weekDays, selectedDayIndex, onSelect }: Readonly<DayPickerStripProps>) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-2 py-2">
      <div className="flex gap-1.5 overflow-x-auto">
        {weekDays.map((day, index) => {
          const dayIsToday = isDateToday(day);
          const isSelected = index === selectedDayIndex;
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(index)}
              aria-pressed={isSelected}
              aria-current={dayIsToday ? 'date' : undefined}
              aria-label={format(day, 'EEE d')}
              className={cn(
                'flex flex-col items-center justify-center min-h-11 min-w-[44px] px-2 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              <span>{format(day, 'EEE')}</span>
              <span className="text-sm font-semibold">{format(day, 'd')}</span>
              {dayIsToday && (
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-primary mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface EmployeeCardHeaderProps {
  employee: Employee;
  weekAvailability: WeekAvailabilitySummary | undefined;
  hours: number;
  selectionMode: boolean;
  onEditEmployee: (employee: Employee) => void;
}

function EmployeeCardHeader({
  employee,
  weekAvailability,
  hours,
  selectionMode,
  onEditEmployee,
}: Readonly<EmployeeCardHeaderProps>) {
  const isMinorEmployee = isMinor(employee.date_of_birth);
  const isWeekOff = weekAvailability?.status === 'time_off';
  const availabilityChipClasses = weekAvailability
    ? weekAvailabilityChipClasses(weekAvailability.status)
    : null;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center text-xs font-semibold shadow-sm shrink-0',
            employee.is_active
              ? 'bg-gradient-to-br from-primary/20 to-primary/10 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {initialsFor(employee.name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">{employee.name}</span>
            {!employee.is_active && (
              <span className="text-[10px] px-1.5 py-0 rounded-md bg-muted text-muted-foreground shrink-0">
                Inactive
              </span>
            )}
            {isMinorEmployee && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-warning/10 text-warning font-medium shrink-0">
                Minor
              </span>
            )}
            {weekAvailability && availabilityChipClasses && (
              <span
                className={cn(
                  'inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0',
                  isWeekOff ? TIME_OFF_CHIP_CLASSES.bg : availabilityChipClasses.bg,
                  isWeekOff ? TIME_OFF_CHIP_CLASSES.text : availabilityChipClasses.text,
                )}
              >
                {weekAvailability.label}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {employee.position}
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
              {employee.employment_type === 'part_time' ? 'PT' : 'FT'}
            </span>
            {hours > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">{hours}h</span>
            )}
          </div>
        </div>
      </div>
      {!selectionMode && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEditEmployee(employee)}
          className="h-8 w-8 shrink-0"
          aria-label={`Edit ${employee.name}`}
        >
          <Edit className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

interface EmployeeDayCardProps {
  employee: Employee;
  day: Date;
  dayShifts: Shift[];
  isOff: boolean;
  weekAvailability: WeekAvailabilitySummary | undefined;
  hours: number;
  selectionMode: boolean;
  selectedShiftIds: Set<string>;
  onEditEmployee: (employee: Employee) => void;
  onAddShift: (date?: Date, employee?: DefaultEmployee) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  onToggleSelectShift: (shiftId: string) => void;
}

function EmployeeDayCard({
  employee,
  day,
  dayShifts,
  isOff,
  weekAvailability,
  hours,
  selectionMode,
  selectedShiftIds,
  onEditEmployee,
  onAddShift,
  onEditShift,
  onDeleteShift,
  onToggleSelectShift,
}: Readonly<EmployeeDayCardProps>) {
  const hasShift = dayShifts.some((s) => s.status !== 'cancelled');

  return (
    <div
      data-testid="week-schedule-mobile-employee-card"
      className="rounded-xl border border-border/40 bg-background p-3 space-y-3"
    >
      <EmployeeCardHeader
        employee={employee}
        weekAvailability={weekAvailability}
        hours={hours}
        selectionMode={selectionMode}
        onEditEmployee={onEditEmployee}
      />
      <SchedulingTimeOffCellContent isOff={isOff} hasShift={hasShift}>
        {dayShifts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No shift scheduled.</p>
        ) : (
          <div className="space-y-2">
            {dayShifts.map((shift) => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                onEdit={onEditShift}
                onDelete={onDeleteShift}
                isSelected={selectedShiftIds.has(shift.id)}
                selectionMode={selectionMode}
                onToggleSelect={onToggleSelectShift}
              />
            ))}
          </div>
        )}
        {!selectionMode && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full h-9 text-xs border border-dashed',
              isOff
                ? 'border-warning/50 text-warning hover:bg-warning/10'
                : 'border-border/50 hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
            )}
            aria-label={`Add shift for ${employee.name} on ${format(day, 'EEE MMM d')}${isOff ? ' despite approved time off' : ''}`}
            onClick={() => onAddShift(day, employee)}
          >
            <Plus className="h-3 w-3 mr-1" />
            {isOff ? 'Add anyway' : 'Add shift'}
          </Button>
        )}
      </SchedulingTimeOffCellContent>
    </div>
  );
}

/**
 * Mobile (`md:hidden`) day-focused schedule view — replaces the 7-column
 * table's initials-only avatar strip with a sticky day-picker strip plus
 * full-name employee cards for the selected day.
 *
 * Design: docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md
 * §4 "Mobile day-focused layout". Reuses `pickDefaultMobileDay`,
 * `SchedulingTimeOffCellContent` (time-off/conflict hatch treatment), the
 * weekly availability chip, and `ShiftCard` — no duplicate drag-and-drop
 * (mobile is tap-to-edit only).
 */
export function WeekScheduleMobile({
  weekDays,
  employees,
  getShiftsForEmployee,
  weekTimeOff,
  weekAvailabilityByEmployee,
  hoursPerEmployee,
  selectionMode,
  selectedShiftIds,
  onEditEmployee,
  onAddShift,
  onEditShift,
  onDeleteShift,
  onToggleSelectShift,
}: Readonly<WeekScheduleMobileProps>) {
  const [selectedDayIndex, setSelectedDayIndex] = useState(() =>
    pickDefaultMobileDay(weekDays, new Date()),
  );

  // Re-derive the default selected day whenever the displayed week changes
  // (prev/next week navigation), so the picker doesn't stay on a stale date.
  const weekKey = weekDays[0]?.getTime();
  useEffect(() => {
    setSelectedDayIndex(pickDefaultMobileDay(weekDays, new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- weekKey is the stable proxy for weekDays
  }, [weekKey]);

  const selectedDay = weekDays[selectedDayIndex] ?? weekDays[0];

  if (!selectedDay) {
    return null;
  }

  const selectedDayKey = format(selectedDay, 'yyyy-MM-dd');

  return (
    <div data-testid="week-schedule-mobile" className="md:hidden">
      <DayPickerStrip
        weekDays={weekDays}
        selectedDayIndex={selectedDayIndex}
        onSelect={setSelectedDayIndex}
      />
      <div className="p-3 space-y-3">
        {employees.length === 0 ? (
          <p className="text-center py-10 text-sm text-muted-foreground">
            No team members to show.
          </p>
        ) : (
          employees.map((employee) => {
            const dayShifts = getShiftsForEmployee(employee.id, selectedDay);
            const isOff = !!weekTimeOff.get(employee.id)?.offDayKeys.has(selectedDayKey);
            return (
              <EmployeeDayCard
                key={employee.id}
                employee={employee}
                day={selectedDay}
                dayShifts={dayShifts}
                isOff={isOff}
                weekAvailability={weekAvailabilityByEmployee.get(employee.id)}
                hours={hoursPerEmployee.get(employee.id) ?? 0}
                selectionMode={selectionMode}
                selectedShiftIds={selectedShiftIds}
                onEditEmployee={onEditEmployee}
                onAddShift={onAddShift}
                onEditShift={onEditShift}
                onDeleteShift={onDeleteShift}
                onToggleSelectShift={onToggleSelectShift}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
