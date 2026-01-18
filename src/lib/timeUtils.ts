import { setHours, setMinutes, startOfDay } from 'date-fns';

/**
 * Snaps a time to the nearest interval
 * @param date The date to snap
 * @param snapMinutes The interval in minutes (default: 15)
 * @returns The snapped date
 */
export const snapToInterval = (date: Date, snapMinutes: number = 15): Date => {
  if (snapMinutes <= 0) {
    throw new Error('snapMinutes must be greater than 0');
  }
  
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  const snappedMinutes = Math.round(totalMinutes / snapMinutes) * snapMinutes;
  const finalHour = Math.floor(snappedMinutes / 60);
  const finalMinutes = snappedMinutes % 60;
  return setMinutes(setHours(startOfDay(date), finalHour), finalMinutes);
};

/**
 * Converts 12-hour time with AM/PM to 24-hour format
 */
const convertTo24Hour = (hour: number, period?: string): number => {
  if (!period) return hour;
  
  const isAM = period.toLowerCase().startsWith('a');
  const isPM = period.toLowerCase().startsWith('p');
  
  if (isPM && hour < 12) return hour + 12;
  if (isAM && hour === 12) return 0;
  return hour;
};

/**
 * Parses flexible time input into a time range
 * Supports formats: 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm, etc.
 * @param input The time range string to parse
 * @param date The date to use for the time range
 * @returns Object with start and end dates, or null if invalid
 */
export const parseTimeRange = (input: string, date: Date, snap: boolean = true): { start: Date; end: Date } | null => {
  // Remove whitespace
  const cleanInput = input.trim().replace(/\s+/g, '');
  
  // Pattern: 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm
  const rangePattern = /^(\d{1,2}):?(\d{2})?([ap]m?)?[-–](\d{1,2}):?(\d{2})?([ap]m?)?$/i;
  const rangeMatch = rangePattern.exec(cleanInput);
  
  if (!rangeMatch) return null;
  
  const [, startHour, startMin = '00', startPeriod, endHour, endMin = '00', endPeriod] = rangeMatch;
  
  // Convert to 24-hour format
  const startH = convertTo24Hour(Number.parseInt(startHour), startPeriod);
  const endH = convertTo24Hour(Number.parseInt(endHour), endPeriod);
  
  // Create Date objects
  const dayStart = startOfDay(date);
  const start = setMinutes(setHours(dayStart, startH), Number.parseInt(startMin));
  const end = setMinutes(setHours(dayStart, endH), Number.parseInt(endMin));
  
  // Validate range
  if (start >= end) return null;
  
  // Only snap to interval if requested (default true for backwards compatibility)
  if (snap) {
    return { start: snapToInterval(start), end: snapToInterval(end) };
  }
  return { start, end };
};

/**
 * Formats an hour value (0-24) to 12-hour time string
 * @param hour The hour value (e.g., 9.5 = 9:30)
 * @returns Formatted time string (e.g., "9:30 AM")
 */
export const formatHourToTime = (hour: number): string => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  // Format display hour
  let displayHour: number;
  if (h === 0) {
    displayHour = 12;
  } else if (h > 12) {
    displayHour = h - 12;
  } else {
    displayHour = h;
  }
  return `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
};

/**
 * Formats duration in minutes to hours and minutes string
 * @param totalMinutes The total minutes
 * @returns Formatted string (e.g., "4h 15m" or "8h")
 */
export const formatDuration = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
};
