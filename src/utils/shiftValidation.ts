import { Shift, TimeOffRequest, ShiftConflict, OvertimeRules, OvertimeWarning, ShiftValidationResult, EmployeeWeeklyHours } from '@/types/scheduling';
import { parseISO, isWithinInterval, areIntervalsOverlapping, startOfDay, endOfDay, differenceInMinutes, startOfWeek, endOfWeek } from 'date-fns';

/**
 * Calculate net working minutes for a shift (total time - break duration)
 */
export const calculateShiftMinutes = (shift: Shift): number => {
  const start = parseISO(shift.start_time);
  const end = parseISO(shift.end_time);
  const totalMinutes = differenceInMinutes(end, start);
  return Math.max(totalMinutes - shift.break_duration, 0);
};

/**
 * Check if two shifts overlap in time
 * Accepts both full Shift objects and new shift data without id
 */
export const shiftsOverlap = (
  shift1: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'>,
  shift2: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'>
): boolean => {
  const start1 = parseISO(shift1.start_time);
  const end1 = parseISO(shift1.end_time);
  const start2 = parseISO(shift2.start_time);
  const end2 = parseISO(shift2.end_time);

  return areIntervalsOverlapping(
    { start: start1, end: end1 },
    { start: start2, end: end2 },
    { inclusive: false } // Don't consider touching shifts as overlapping
  );
};

/**
 * Check if a shift conflicts with approved time-off
 * Accepts both full Shift objects and new shift data without id
 */
export const shiftConflictsWithTimeOff = (
  shift: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'>,
  timeOffRequests: TimeOffRequest[]
): TimeOffRequest | null => {
  const shiftStart = parseISO(shift.start_time);
  const shiftEnd = parseISO(shift.end_time);

  // Only check approved time-off requests for the same employee
  const approvedTimeOff = timeOffRequests.filter(
    (req) => req.employee_id === shift.employee_id && req.status === 'approved'
  );

  for (const timeOff of approvedTimeOff) {
    const timeOffStart = startOfDay(parseISO(timeOff.start_date));
    const timeOffEnd = endOfDay(parseISO(timeOff.end_date));

    // Check if shift falls within time-off period
    if (
      isWithinInterval(shiftStart, { start: timeOffStart, end: timeOffEnd }) ||
      isWithinInterval(shiftEnd, { start: timeOffStart, end: timeOffEnd })
    ) {
      return timeOff;
    }
  }

  return null;
};

/**
 * Detect conflicts for a new or edited shift
 */
export const detectShiftConflicts = (
  shift: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'>,
  existingShifts: Shift[],
  timeOffRequests: TimeOffRequest[],
  excludeShiftId?: string
): ShiftConflict[] => {
  const conflicts: ShiftConflict[] = [];

  // Filter out the shift being edited and cancelled shifts
  const activeShifts = existingShifts.filter(
    (s) =>
      s.status !== 'cancelled' &&
      s.id !== excludeShiftId &&
      s.employee_id === shift.employee_id
  );

  // Check for double-booking (exact time match)
  const doubleBooked = activeShifts.find(
    (s) => s.start_time === shift.start_time && s.end_time === shift.end_time
  );

  if (doubleBooked) {
    conflicts.push({
      type: 'double_booking',
      message: `Employee is already scheduled for this exact time`,
      conflictingShift: doubleBooked,
      severity: 'error',
    });
    // If there's a double-booking, no need to check for overlapping
    return conflicts;
  }

  // Check for overlapping shifts
  const overlappingShifts = activeShifts.filter((s) => shiftsOverlap(shift, s));

  overlappingShifts.forEach((conflictingShift) => {
    conflicts.push({
      type: 'overlapping_shift',
      message: `Overlaps with another shift (${new Date(conflictingShift.start_time).toLocaleTimeString()} - ${new Date(conflictingShift.end_time).toLocaleTimeString()})`,
      conflictingShift,
      severity: 'error',
    });
  });

  // Check for time-off conflicts
  const timeOffConflict = shiftConflictsWithTimeOff(shift as Shift, timeOffRequests);
  if (timeOffConflict) {
    conflicts.push({
      type: 'time_off_conflict',
      message: `Employee has approved time-off during this period`,
      conflictingTimeOff: timeOffConflict,
      severity: 'error',
    });
  }

  return conflicts;
};

/**
 * Calculate total minutes worked by an employee in a given date range
 */
export const calculateEmployeeMinutes = (
  employeeId: string,
  shifts: Shift[],
  startDate: Date,
  endDate: Date
): number => {
  return shifts
    .filter(
      (shift) =>
        shift.employee_id === employeeId &&
        shift.status !== 'cancelled' &&
        isWithinInterval(parseISO(shift.start_time), { start: startDate, end: endDate })
    )
    .reduce((total, shift) => total + calculateShiftMinutes(shift), 0);
};

/**
 * Calculate daily overtime for a specific date
 */
export const calculateDailyOvertime = (
  employeeId: string,
  date: Date,
  shifts: Shift[],
  overtimeRules: OvertimeRules
): OvertimeWarning | null => {
  if (!overtimeRules.enabled) return null;

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const dailyMinutes = calculateEmployeeMinutes(employeeId, shifts, dayStart, dayEnd);

  if (dailyMinutes > overtimeRules.daily_threshold_minutes) {
    const overtimeMinutes = dailyMinutes - overtimeRules.daily_threshold_minutes;
    const thresholdHours = overtimeRules.daily_threshold_minutes / 60;
    const overtimeHours = overtimeMinutes / 60;

    return {
      type: 'daily',
      currentMinutes: dailyMinutes,
      thresholdMinutes: overtimeRules.daily_threshold_minutes,
      overtimeMinutes,
      message: `Daily OT: ${overtimeHours.toFixed(1)}h over ${thresholdHours}h threshold`,
      severity: overtimeMinutes > 120 ? 'error' : overtimeMinutes > 60 ? 'warning' : 'info',
    };
  }

  return null;
};

/**
 * Calculate weekly overtime for an employee
 */
export const calculateWeeklyOvertime = (
  employeeId: string,
  date: Date,
  shifts: Shift[],
  overtimeRules: OvertimeRules,
  includeNewShift?: Omit<Shift, 'id' | 'created_at' | 'updated_at'>
): OvertimeWarning | null => {
  if (!overtimeRules.enabled) return null;

  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

  let weeklyMinutes = calculateEmployeeMinutes(employeeId, shifts, weekStart, weekEnd);

  // Add the new shift if provided
  if (includeNewShift && includeNewShift.employee_id === employeeId) {
    const newShiftMinutes = calculateShiftMinutes(includeNewShift as Shift);
    weeklyMinutes += newShiftMinutes;
  }

  if (weeklyMinutes > overtimeRules.weekly_threshold_minutes) {
    const overtimeMinutes = weeklyMinutes - overtimeRules.weekly_threshold_minutes;
    const thresholdHours = overtimeRules.weekly_threshold_minutes / 60;
    const overtimeHours = overtimeMinutes / 60;

    return {
      type: 'weekly',
      currentMinutes: weeklyMinutes,
      thresholdMinutes: overtimeRules.weekly_threshold_minutes,
      overtimeMinutes,
      message: `Weekly OT: ${overtimeHours.toFixed(1)}h over ${thresholdHours}h threshold`,
      severity: overtimeMinutes > 240 ? 'error' : overtimeMinutes > 120 ? 'warning' : 'info',
    };
  }

  // Also check if approaching threshold (within 2 hours)
  const remainingMinutes = overtimeRules.weekly_threshold_minutes - weeklyMinutes;
  if (remainingMinutes <= 120 && remainingMinutes > 0) {
    const remainingHours = remainingMinutes / 60;
    return {
      type: 'weekly',
      currentMinutes: weeklyMinutes,
      thresholdMinutes: overtimeRules.weekly_threshold_minutes,
      overtimeMinutes: 0,
      message: `Approaching weekly threshold: ${remainingHours.toFixed(1)}h remaining`,
      severity: 'info',
    };
  }

  return null;
};

/**
 * Validate a shift for conflicts and overtime
 */
export const validateShift = (
  shift: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'>,
  existingShifts: Shift[],
  timeOffRequests: TimeOffRequest[],
  overtimeRules: OvertimeRules,
  excludeShiftId?: string
): ShiftValidationResult => {
  const conflicts = detectShiftConflicts(shift, existingShifts, timeOffRequests, excludeShiftId);
  const overtimeWarnings: OvertimeWarning[] = [];

  // Only check overtime if no conflicts exist
  if (conflicts.length === 0 && overtimeRules.enabled) {
    const shiftDate = parseISO(shift.start_time);

    // Check daily overtime
    const dailyOT = calculateDailyOvertime(
      shift.employee_id,
      shiftDate,
      [...existingShifts, shift as Shift],
      overtimeRules
    );
    if (dailyOT) overtimeWarnings.push(dailyOT);

    // Check weekly overtime
    const weeklyOT = calculateWeeklyOvertime(
      shift.employee_id,
      shiftDate,
      existingShifts,
      overtimeRules,
      shift
    );
    if (weeklyOT) overtimeWarnings.push(weeklyOT);
  }

  return {
    isValid: conflicts.length === 0,
    conflicts,
    overtimeWarnings,
  };
};

/**
 * Calculate weekly hours for all employees
 */
export const calculateWeeklyHoursForEmployees = (
  employees: Array<{ id: string; name: string }>,
  shifts: Shift[],
  weekStart: Date,
  weekEnd: Date,
  overtimeRules: OvertimeRules
): EmployeeWeeklyHours[] => {
  return employees.map((employee) => {
    const totalMinutes = calculateEmployeeMinutes(employee.id, shifts, weekStart, weekEnd);
    const regularMinutes = Math.min(totalMinutes, overtimeRules.weekly_threshold_minutes);
    const overtimeMinutes = Math.max(totalMinutes - overtimeRules.weekly_threshold_minutes, 0);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      totalMinutes,
      regularMinutes,
      overtimeMinutes,
      projectedOvertimeMinutes: overtimeMinutes,
    };
  });
};

/**
 * Bulk validate all shifts in a schedule
 */
export const bulkValidateShifts = (
  shifts: Shift[],
  timeOffRequests: TimeOffRequest[],
  overtimeRules: OvertimeRules
): Map<string, ShiftValidationResult> => {
  const validationResults = new Map<string, ShiftValidationResult>();

  shifts.forEach((shift) => {
    // Only validate scheduled or confirmed shifts
    if (shift.status === 'scheduled' || shift.status === 'confirmed') {
      const result = validateShift(
        shift,
        shifts,
        timeOffRequests,
        overtimeRules,
        shift.id
      );
      if (!result.isValid || result.overtimeWarnings.length > 0) {
        validationResults.set(shift.id, result);
      }
    }
  });

  return validationResults;
};
