import { useState, useCallback, useMemo } from 'react';
import { startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import { PeriodType } from '@/components/employee/PeriodSelector';

interface UsePeriodNavigationOptions {
  /** Whether to include the "last 2 weeks" period calculation */
  includeLast2Weeks?: boolean;
}

interface UsePeriodNavigationReturn {
  periodType: PeriodType;
  setPeriodType: (type: PeriodType) => void;
  startDate: Date;
  endDate: Date;
  handlePreviousWeek: () => void;
  handleNextWeek: () => void;
  handleToday: () => void;
}

/**
 * Hook for managing period/week navigation state
 * Reduces duplication across employee pages
 */
export const usePeriodNavigation = (
  options: UsePeriodNavigationOptions = {}
): UsePeriodNavigationReturn => {
  const { includeLast2Weeks = false } = options;
  
  const [periodType, setPeriodType] = useState<PeriodType>('current_week');
  const [customStartDate, setCustomStartDate] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );

  const dateRange = useMemo(() => {
    const today = new Date();
    
    switch (periodType) {
      case 'current_week':
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: 0 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 0 }),
        };
      }
      case 'last_2_weeks': {
        if (!includeLast2Weeks) {
          // Fall back to current week if not supported
          return {
            start: startOfWeek(today, { weekStartsOn: 0 }),
            end: endOfWeek(today, { weekStartsOn: 0 }),
          };
        }
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(subWeeks(lastWeek, 1), { weekStartsOn: 0 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 0 }),
        };
      }
      case 'custom':
        return {
          start: customStartDate,
          end: endOfWeek(customStartDate, { weekStartsOn: 0 }),
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
    }
  }, [periodType, customStartDate, includeLast2Weeks]);

  const handlePreviousWeek = useCallback(() => {
    const newDate = subWeeks(dateRange.start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
    setPeriodType('custom');
  }, [dateRange.start]);

  const handleNextWeek = useCallback(() => {
    const newDate = addWeeks(dateRange.start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
    setPeriodType('custom');
  }, [dateRange.start]);

  const handleToday = useCallback(() => {
    setCustomStartDate(startOfWeek(new Date(), { weekStartsOn: 0 }));
    setPeriodType('current_week');
  }, []);

  return {
    periodType,
    setPeriodType,
    startDate: dateRange.start,
    endDate: dateRange.end,
    handlePreviousWeek,
    handleNextWeek,
    handleToday,
  };
};
