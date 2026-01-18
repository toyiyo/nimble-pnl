import { useState, useCallback, useMemo } from 'react';
import { startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import { PeriodType } from '@/components/employee/PeriodSelector';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';

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
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON })
  );

  const dateRange = useMemo(() => {
    const today = new Date();
    
    switch (periodType) {
      case 'current_week':
        return {
          start: startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
        };
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
        };
      }
      case 'last_2_weeks': {
        if (!includeLast2Weeks) {
          // Fall back to current week if not supported
          return {
            start: startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
            end: endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
          };
        }
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(subWeeks(lastWeek, 1), { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
        };
      }
      case 'custom':
        return {
          start: customStartDate,
          end: endOfWeek(customStartDate, { weekStartsOn: WEEK_STARTS_ON }),
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
        };
    }
  }, [periodType, customStartDate, includeLast2Weeks]);

  const handlePreviousWeek = useCallback(() => {
    const newDate = subWeeks(dateRange.start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
    setPeriodType('custom');
  }, [dateRange.start]);

  const handleNextWeek = useCallback(() => {
    const newDate = addWeeks(dateRange.start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
    setPeriodType('custom');
  }, [dateRange.start]);

  const handleToday = useCallback(() => {
    setCustomStartDate(startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }));
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
