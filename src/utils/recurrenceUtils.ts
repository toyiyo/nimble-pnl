import { RecurrencePattern, RecurrenceType } from '@/types/scheduling';
import { 
  addDays, 
  addWeeks, 
  addMonths, 
  addYears, 
  startOfDay,
  isBefore,
  isAfter,
  getDay,
  setDate,
  getDate,
  differenceInDays,
  parseISO,
  format,
} from 'date-fns';

/**
 * Generate recurring shift dates based on a recurrence pattern
 * @param startDate - The initial shift date
 * @param pattern - The recurrence pattern
 * @param maxOccurrences - Maximum number of occurrences to generate (safety limit)
 * @returns Array of ISO date strings for each occurrence
 */
export function generateRecurringDates(
  startDate: Date,
  pattern: RecurrencePattern,
  maxOccurrences: number = 365 // Safety limit to prevent infinite generation
): Date[] {
  const dates: Date[] = [startDate];
  const interval = pattern.interval || 1;
  let currentDate = startDate;
  let count = 1;

  // Determine end condition
  const shouldContinue = (date: Date, currentCount: number): boolean => {
    if (currentCount >= maxOccurrences) return false;
    
    if (pattern.endType === 'never') {
      return currentCount < maxOccurrences;
    } else if (pattern.endType === 'on' && pattern.endDate) {
      return isBefore(date, parseISO(pattern.endDate)) || 
             format(date, 'yyyy-MM-dd') === format(parseISO(pattern.endDate), 'yyyy-MM-dd');
    } else if (pattern.endType === 'after' && pattern.occurrences) {
      return currentCount < pattern.occurrences;
    }
    return false;
  };

  while (shouldContinue(currentDate, count)) {
    let nextDate: Date | null = null;

    switch (pattern.type) {
      case 'daily':
        nextDate = addDays(currentDate, interval);
        break;

      case 'weekday':
        // Skip weekends
        nextDate = addDays(currentDate, 1);
        while (getDay(nextDate) === 0 || getDay(nextDate) === 6) {
          nextDate = addDays(nextDate, 1);
        }
        break;

      case 'weekly':
        if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
          // Find next day of week in the pattern
          nextDate = findNextDayOfWeek(currentDate, pattern.daysOfWeek, interval);
        } else {
          nextDate = addWeeks(currentDate, interval);
        }
        break;

      case 'monthly':
        if (pattern.weekOfMonth && pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
          // "Third Sunday" pattern
          nextDate = findNthDayOfMonth(
            addMonths(currentDate, interval),
            pattern.daysOfWeek[0],
            pattern.weekOfMonth
          );
        } else {
          // Same day of month
          nextDate = addMonths(currentDate, interval);
          // Handle month overflow (e.g., Jan 31 -> Feb 28)
          const targetDay = getDate(startDate);
          try {
            nextDate = setDate(nextDate, targetDay);
          } catch {
            // If day doesn't exist in month, use last day of month
            nextDate = setDate(nextDate, 1);
            nextDate = addMonths(nextDate, 1);
            nextDate = addDays(nextDate, -1);
          }
        }
        break;

      case 'yearly':
        nextDate = addYears(currentDate, interval);
        break;

      case 'custom':
        // Custom recurrence uses the same logic as weekly if daysOfWeek is specified
        if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
          nextDate = findNextDayOfWeek(currentDate, pattern.daysOfWeek, interval);
        } else {
          nextDate = addWeeks(currentDate, interval);
        }
        break;
    }

    if (!nextDate) break;

    currentDate = nextDate;
    count++;

    if (shouldContinue(currentDate, count)) {
      dates.push(currentDate);
    }
  }

  return dates;
}

/**
 * Find the next occurrence of a day of week
 */
function findNextDayOfWeek(
  currentDate: Date,
  daysOfWeek: number[],
  weekInterval: number
): Date {
  const currentDay = getDay(currentDate);
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
  
  // Find next day in current week
  const nextDayInWeek = sortedDays.find(day => day > currentDay);
  
  if (nextDayInWeek !== undefined) {
    // Next occurrence is in the same week
    const daysToAdd = nextDayInWeek - currentDay;
    return addDays(currentDate, daysToAdd);
  } else {
    // Next occurrence is in a future week
    const daysUntilNextWeek = (7 - currentDay) + sortedDays[0];
    const weeksToAdd = weekInterval - 1; // -1 because we're already moving to next week
    return addWeeks(addDays(currentDate, daysUntilNextWeek), weeksToAdd);
  }
}

/**
 * Find the nth occurrence of a day of week in a month
 * @param date - A date in the target month
 * @param dayOfWeek - Day of week (0=Sunday, 6=Saturday)
 * @param n - Which occurrence (1=first, 2=second, etc.)
 */
function findNthDayOfMonth(date: Date, dayOfWeek: number, n: number): Date {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDayOfWeek = getDay(firstOfMonth);
  
  // Calculate days until first occurrence of target day
  let daysUntilTarget = dayOfWeek - firstDayOfWeek;
  if (daysUntilTarget < 0) {
    daysUntilTarget += 7;
  }
  
  // Add weeks to get to nth occurrence
  const targetDate = addDays(firstOfMonth, daysUntilTarget + (n - 1) * 7);
  
  // Verify it's still in the same month
  if (targetDate.getMonth() !== date.getMonth()) {
    // This can happen with "5th X" when there are only 4
    // Fall back to last occurrence
    return addDays(targetDate, -7);
  }
  
  return targetDate;
}

/**
 * Get a human-readable description of a recurrence pattern
 */
export function getRecurrenceDescription(pattern: RecurrencePattern): string {
  const { type, interval = 1, daysOfWeek, weekOfMonth, endType, endDate, occurrences } = pattern;
  
  let description = '';
  
  switch (type) {
    case 'daily':
      description = interval === 1 ? 'Daily' : `Every ${interval} days`;
      break;
    
    case 'weekday':
      description = 'Every weekday (Monday to Friday)';
      break;
    
    case 'weekly':
      if (daysOfWeek && daysOfWeek.length > 0) {
        const dayNames = daysOfWeek.map(d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]);
        description = `Weekly on ${dayNames.join(', ')}`;
      } else {
        description = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
      }
      break;
    
    case 'monthly':
      if (weekOfMonth && daysOfWeek && daysOfWeek.length > 0) {
        const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][weekOfMonth - 1];
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][daysOfWeek[0]];
        description = `Monthly on the ${ordinal} ${dayName}`;
      } else {
        description = interval === 1 ? 'Monthly' : `Every ${interval} months`;
      }
      break;
    
    case 'yearly':
      description = interval === 1 ? 'Annually' : `Every ${interval} years`;
      break;
    
    case 'custom':
      description = 'Custom recurrence';
      break;
  }
  
  // Add end condition
  if (endType === 'on' && endDate) {
    description += `, until ${format(parseISO(endDate), 'MMM d, yyyy')}`;
  } else if (endType === 'after' && occurrences) {
    description += `, ${occurrences} times`;
  }
  
  return description;
}

/**
 * Get preset recurrence options for quick selection
 * These match Google Calendar's familiar patterns
 */
export function getRecurrencePresetsForDate(date: Date): Array<{ label: string; value: RecurrenceType | 'none'; pattern?: Partial<RecurrencePattern> }> {
  const dayOfWeek = date.getDay();
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
  const monthName = format(date, 'MMMM');
  const dayOfMonth = date.getDate();
  
  // Calculate which occurrence of this weekday in the month (1st, 2nd, 3rd, etc.)
  // Count how many times this weekday has occurred up to and including this date
  let occurrenceCount = 0;
  for (let day = 1; day <= dayOfMonth; day++) {
    const testDate = new Date(date.getFullYear(), date.getMonth(), day);
    if (testDate.getDay() === dayOfWeek) {
      occurrenceCount++;
    }
  }
  
  // Calculate total occurrences of this weekday in the month
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  let totalOccurrences = 0;
  for (let day = 1; day <= lastDayOfMonth; day++) {
    const testDate = new Date(date.getFullYear(), date.getMonth(), day);
    if (testDate.getDay() === dayOfWeek) {
      totalOccurrences++;
    }
  }
  
  // Determine the ordinal string
  let ordinal: string;
  if (occurrenceCount === totalOccurrences && occurrenceCount > 1) {
    ordinal = 'last';
  } else if (occurrenceCount >= 1 && occurrenceCount <= 5) {
    ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][occurrenceCount - 1];
  } else {
    ordinal = 'last'; // Fallback for edge cases
  }
  
  const weekOfMonth = occurrenceCount;
  
  return [
    { label: 'Does not repeat', value: 'none' },
    { label: 'Daily', value: 'daily', pattern: { type: 'daily', interval: 1, endType: 'never' } },
    { label: `Weekly on ${dayName}`, value: 'weekly', pattern: { type: 'weekly', daysOfWeek: [dayOfWeek], interval: 1, endType: 'never' } },
    { label: `Monthly on the ${ordinal} ${dayName}`, value: 'monthly', pattern: { type: 'monthly', daysOfWeek: [dayOfWeek], weekOfMonth, interval: 1, endType: 'never' } },
    { label: `Annually on ${monthName} ${dayOfMonth}`, value: 'yearly', pattern: { type: 'yearly', interval: 1, endType: 'never' } },
    { label: 'Every weekday (Monday to Friday)', value: 'weekday', pattern: { type: 'weekday', endType: 'never' } },
    { label: 'Custom...', value: 'custom', pattern: { type: 'custom', interval: 1, endType: 'never' } },
  ];
}

// Legacy constant for backwards compatibility
export const RECURRENCE_PRESETS: Array<{ label: string; value: RecurrenceType | 'none'; pattern?: Partial<RecurrencePattern> }> = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Daily', value: 'daily', pattern: { type: 'daily', interval: 1, endType: 'never' } },
  { label: 'Weekly on Sunday', value: 'weekly', pattern: { type: 'weekly', daysOfWeek: [0], interval: 1, endType: 'never' } },
  { label: 'Weekly on Monday', value: 'weekly', pattern: { type: 'weekly', daysOfWeek: [1], interval: 1, endType: 'never' } },
  { label: 'Every weekday (Monday to Friday)', value: 'weekday', pattern: { type: 'weekday', endType: 'never' } },
  { label: 'Custom...', value: 'custom', pattern: { type: 'custom', interval: 1, endType: 'never' } },
];
