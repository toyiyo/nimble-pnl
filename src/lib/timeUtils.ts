import { setHours, setMinutes, startOfDay } from 'date-fns';

/**
 * Snaps a time to the nearest interval (optimized for 15-min quarters)
 * @param date The date to snap
 * @param snapMinutes The interval in minutes (default: 15)
 * @returns The snapped date
 */
export const snapToInterval = (date: Date, snapMinutes: number = 15): Date => {
  const hour = date.getHours() + date.getMinutes() / 60;
  const snappedHour = Math.round(hour * 4) / 4; // Snap to quarters (15 min)
  const finalHour = Math.floor(snappedHour);
  const finalMinutes = Math.round((snappedHour - finalHour) * 60);
  return setMinutes(setHours(startOfDay(date), finalHour), finalMinutes);
};

/**
 * Parses flexible time input into a time range
 * Supports formats: 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm, etc.
 * @param input The time range string to parse
 * @param date The date to use for the time range
 * @returns Object with start and end dates, or null if invalid
 */
export const parseTimeRange = (input: string, date: Date): { start: Date; end: Date } | null => {
  // Remove whitespace
  input = input.trim().replace(/\s+/g, '');
  
  // Pattern: 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm
  const rangeMatch = input.match(/^(\d{1,2}):?(\d{2})?([ap]m?)?[-–](\d{1,2}):?(\d{2})?([ap]m?)?$/i);
  
  if (!rangeMatch) return null;
  
  const [, startHour, startMin = '00', startPeriod, endHour, endMin = '00', endPeriod] = rangeMatch;
  
  let startH = parseInt(startHour);
  let endH = parseInt(endHour);
  
  // Handle AM/PM
  if (startPeriod) {
    if (startPeriod.toLowerCase().startsWith('p') && startH < 12) startH += 12;
    if (startPeriod.toLowerCase().startsWith('a') && startH === 12) startH = 0;
  }
  if (endPeriod) {
    if (endPeriod.toLowerCase().startsWith('p') && endH < 12) endH += 12;
    if (endPeriod.toLowerCase().startsWith('a') && endH === 12) endH = 0;
  }
  
  const start = setMinutes(setHours(startOfDay(date), startH), parseInt(startMin));
  const end = setMinutes(setHours(startOfDay(date), endH), parseInt(endMin));
  
  if (start >= end) return null; // Invalid range
  
  return { start: snapToInterval(start), end: snapToInterval(end) };
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
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
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
