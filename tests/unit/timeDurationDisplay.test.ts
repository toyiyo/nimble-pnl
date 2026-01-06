/**
 * Unit Tests: Time Duration Display Calculations
 * 
 * Tests the duration calculation logic used in TimePunchesManager
 * for displaying "Open for Xh Ym" for incomplete sessions.
 * 
 * CRITICAL: Must use Math.floor() not Math.round() to avoid
 * showing incorrect hours (e.g., 1h 46m showing as 2h 46m)
 */

import { describe, it, expect } from 'vitest';
import { differenceInMinutes } from 'date-fns';

/**
 * Calculate duration display string (hours and minutes)
 * This matches the logic in TimePunchesManager.tsx line 1191
 */
const calculateDurationDisplay = (startTime: Date, currentTime: Date): string => {
  const totalMinutes = differenceInMinutes(currentTime, startTime);
  const hours = Math.max(0, Math.floor(totalMinutes / 60));
  const minutes = Math.max(0, totalMinutes % 60);
  return `${hours}h ${minutes}m`;
};

describe('Time Duration Display - Incomplete Sessions', () => {
  describe('calculateDurationDisplay', () => {
    it('should correctly calculate 1h 46m for 106 minutes', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T09:46:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('1h 46m');
    });

    it('CRITICAL: should use floor not round for hours calculation', () => {
      // 8:00 AM to 9:46 AM = 106 minutes
      // 106 / 60 = 1.767 hours
      // Math.round(1.767) = 2 ❌ WRONG
      // Math.floor(1.767) = 1 ✓ CORRECT
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T09:46:00');
      
      const totalMinutes = differenceInMinutes(current, start);
      expect(totalMinutes).toBe(106);
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('1h 46m');
      expect(result).not.toBe('2h 46m'); // Bug that was reported
    });

    it('should handle exact hour boundaries', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T10:00:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('2h 0m');
    });

    it('should handle sub-hour durations', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T08:45:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('0h 45m');
    });

    it('should handle long durations correctly', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T17:30:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('9h 30m');
    });

    it('should handle edge case: 59 minutes should show 0h 59m not 1h 59m', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T08:59:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('0h 59m');
    });

    it('should handle edge case: 1h 30m boundary', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T09:30:00');
      
      const totalMinutes = differenceInMinutes(current, start);
      expect(totalMinutes).toBe(90);
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('1h 30m');
    });

    it('should handle negative durations (future time)', () => {
      // Edge case: if clock_in is somehow in the future
      const start = new Date('2026-01-06T10:00:00');
      const current = new Date('2026-01-06T09:00:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('0h 0m'); // Math.max(0, ...) prevents negatives
    });

    it('should handle same time (0 minutes)', () => {
      const start = new Date('2026-01-06T08:00:00');
      const current = new Date('2026-01-06T08:00:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('0h 0m');
    });

    it('CRITICAL: verify reported bug scenario 8 AM to 9:46 AM', () => {
      // User reported: showing "2h 46m" when should be "1h 46m"
      const clockIn = new Date('2026-01-06T08:00:00');
      const now = new Date('2026-01-06T09:46:00');
      
      const result = calculateDurationDisplay(clockIn, now);
      
      // Should be 1 hour and 46 minutes
      expect(result).toBe('1h 46m');
      
      // Verify the intermediate calculations
      const totalMinutes = differenceInMinutes(now, clockIn);
      expect(totalMinutes).toBe(106);
      expect(Math.floor(totalMinutes / 60)).toBe(1);
      expect(totalMinutes % 60).toBe(46);
    });

    it('should handle multi-day sessions', () => {
      const start = new Date('2026-01-06T23:00:00');
      const current = new Date('2026-01-07T02:30:00');
      
      const result = calculateDurationDisplay(start, current);
      expect(result).toBe('3h 30m');
    });
  });
});
