import { useMemo } from 'react';
import { Shift, ShiftValidationResult, EmployeeWeeklyHours } from '@/types/scheduling';
import { useShifts } from '@/hooks/useShifts';
import { useTimeOffRequests } from '@/hooks/useTimeOffRequests';
import { useOvertimeRules } from '@/hooks/useOvertimeRules';
import { validateShift, bulkValidateShifts, calculateWeeklyHoursForEmployees } from '@/utils/shiftValidation';

/**
 * Hook to validate a single shift in real-time
 */
export const useShiftValidation = (
  shift: Shift | Omit<Shift, 'id' | 'created_at' | 'updated_at'> | null,
  restaurantId: string | null,
  weekStart?: Date,
  weekEnd?: Date,
  excludeShiftId?: string
): ShiftValidationResult | null => {
  const { shifts } = useShifts(restaurantId, weekStart, weekEnd);
  const { timeOffRequests } = useTimeOffRequests(restaurantId);
  const { overtimeRules } = useOvertimeRules(restaurantId);

  return useMemo(() => {
    if (!shift || !overtimeRules) return null;

    return validateShift(
      shift,
      shifts,
      timeOffRequests,
      overtimeRules,
      excludeShiftId
    );
  }, [shift, shifts, timeOffRequests, overtimeRules, excludeShiftId]);
};

/**
 * Hook to validate all shifts in a schedule
 */
export const useBulkShiftValidation = (
  restaurantId: string | null,
  weekStart?: Date,
  weekEnd?: Date
): Map<string, ShiftValidationResult> => {
  const { shifts } = useShifts(restaurantId, weekStart, weekEnd);
  const { timeOffRequests } = useTimeOffRequests(restaurantId);
  const { overtimeRules } = useOvertimeRules(restaurantId);

  return useMemo(() => {
    if (!overtimeRules) return new Map();

    return bulkValidateShifts(shifts, timeOffRequests, overtimeRules);
  }, [shifts, timeOffRequests, overtimeRules]);
};

/**
 * Hook to calculate weekly hours and overtime for all employees
 */
export const useWeeklyOvertimeForecast = (
  restaurantId: string | null,
  employees: Array<{ id: string; name: string }>,
  weekStart: Date,
  weekEnd: Date
): EmployeeWeeklyHours[] => {
  const { shifts } = useShifts(restaurantId, weekStart, weekEnd);
  const { overtimeRules } = useOvertimeRules(restaurantId);

  return useMemo(() => {
    if (!overtimeRules) return [];

    return calculateWeeklyHoursForEmployees(
      employees,
      shifts,
      weekStart,
      weekEnd,
      overtimeRules
    );
  }, [employees, shifts, weekStart, weekEnd, overtimeRules]);
};
