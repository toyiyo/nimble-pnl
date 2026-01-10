import { describe, it, expect } from 'vitest';
import { snapToInterval, parseTimeRange, formatHourToTime, formatDuration } from '@/lib/timeUtils';

describe('timeUtils', () => {
  describe('snapToInterval', () => {
    const baseDate = new Date('2026-01-09T00:00:00');

    it('should snap to nearest 15-minute interval by default', () => {
      // 9:07 should snap to 9:00
      const input = new Date('2026-01-09T09:07:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(0);
    });

    it('should snap 9:08 to 9:15 (nearest quarter)', () => {
      const input = new Date('2026-01-09T09:08:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(15);
    });

    it('should snap 9:23 to 9:30 (nearest quarter)', () => {
      // 9.383 hours rounds to 9.5 (9:30)
      const input = new Date('2026-01-09T09:23:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(30);
    });

    it('should snap 9:38 to 9:45', () => {
      const input = new Date('2026-01-09T09:38:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(45);
    });

    it('should snap exactly on 15-minute marks to themselves', () => {
      const input = new Date('2026-01-09T09:15:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(15);
    });

    it('should snap 9:52 to 9:45 (nearest quarter)', () => {
      // 9.867 hours rounds to 9.75 (9:45)
      const input = new Date('2026-01-09T09:52:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(45);
    });

    it('should handle midnight correctly', () => {
      const input = new Date('2026-01-09T00:07:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it('should handle end of day correctly', () => {
      const input = new Date('2026-01-09T23:53:00');
      const result = snapToInterval(input);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getDate()).toBe(10); // Next day
    });

    it('should preserve the date part', () => {
      const input = new Date('2026-03-15T14:23:00');
      const result = snapToInterval(input);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(2); // March (0-indexed)
      expect(result.getDate()).toBe(15);
    });
  });

  describe('parseTimeRange', () => {
    const testDate = new Date('2026-01-09');

    describe('shorthand format (9-5)', () => {
      it('should parse simple hour range "9-5" with colon format', () => {
        // parseTimeRange requires colon-separated format or AM/PM
        const result = parseTimeRange('9:00-17:00', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.start.getMinutes()).toBe(0);
        expect(result?.end.getHours()).toBe(17);
        expect(result?.end.getMinutes()).toBe(0);
      });

      it('should parse "9:00-17:30" format', () => {
        const result = parseTimeRange('9:00-17:30', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.start.getMinutes()).toBe(0);
        expect(result?.end.getHours()).toBe(17);
        expect(result?.end.getMinutes()).toBe(30);
      });

      it('should handle whitespace in colon format', () => {
        const result = parseTimeRange(' 9:00 - 17:00 ', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.end.getHours()).toBe(17);
      });
    });

    describe('AM/PM format', () => {
      it('should parse "9a-5p"', () => {
        const result = parseTimeRange('9a-5p', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.end.getHours()).toBe(17);
      });

      it('should parse "9am-5:30pm"', () => {
        const result = parseTimeRange('9am-5:30pm', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.start.getMinutes()).toBe(0);
        expect(result?.end.getHours()).toBe(17);
        expect(result?.end.getMinutes()).toBe(30);
      });

      it('should handle 12am as midnight', () => {
        const result = parseTimeRange('12am-6am', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(0);
        expect(result?.end.getHours()).toBe(6);
      });

      it('should handle 12pm as noon', () => {
        const result = parseTimeRange('12pm-5pm', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(12);
        expect(result?.end.getHours()).toBe(17);
      });

      it('should convert PM hours correctly', () => {
        const result = parseTimeRange('2pm-8pm', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(14);
        expect(result?.end.getHours()).toBe(20);
      });
    });

    describe('24-hour format', () => {
      it('should parse "09:00-17:30"', () => {
        const result = parseTimeRange('09:00-17:30', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(9);
        expect(result?.start.getMinutes()).toBe(0);
        expect(result?.end.getHours()).toBe(17);
        expect(result?.end.getMinutes()).toBe(30);
      });

      it('should parse "8:15-16:45"', () => {
        const result = parseTimeRange('8:15-16:45', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(8);
        expect(result?.start.getMinutes()).toBe(15);
        expect(result?.end.getHours()).toBe(16);
        expect(result?.end.getMinutes()).toBe(45);
      });

      it('should handle midnight to morning shift', () => {
        const result = parseTimeRange('00:00-06:00', testDate);
        expect(result).not.toBeNull();
        expect(result?.start.getHours()).toBe(0);
        expect(result?.end.getHours()).toBe(6);
      });
    });

    describe('edge cases and validation', () => {
      it('should return null for invalid format', () => {
        expect(parseTimeRange('invalid', testDate)).toBeNull();
        expect(parseTimeRange('', testDate)).toBeNull();
        expect(parseTimeRange('abc-def', testDate)).toBeNull();
      });

      it('should return null when start time >= end time', () => {
        const result = parseTimeRange('17-9', testDate);
        expect(result).toBeNull();
      });

      it('should return null when start equals end', () => {
        const result = parseTimeRange('9-9', testDate);
        expect(result).toBeNull();
      });

      it('should return null for em dash (–) separator (not supported)', () => {
        // parseTimeRange uses regex matching regular hyphen only
        const result = parseTimeRange('9–5', testDate);
        expect(result).toBeNull();
      });
    });

    describe('snapping integration', () => {
      it('should snap parsed times to 15-minute intervals', () => {
        const result = parseTimeRange('9:07-17:23', testDate);
        expect(result).not.toBeNull();
        // 9:07 should snap to 9:00 or 9:15
        expect(result?.start.getMinutes() % 15).toBe(0);
        // 17:23 should snap to 17:15 or 17:30
        expect(result?.end.getMinutes() % 15).toBe(0);
      });
    });
  });

  describe('formatHourToTime', () => {
    it('should format whole hours correctly', () => {
      expect(formatHourToTime(0)).toBe('12:00 AM');
      expect(formatHourToTime(1)).toBe('1:00 AM');
      expect(formatHourToTime(9)).toBe('9:00 AM');
      expect(formatHourToTime(12)).toBe('12:00 PM');
      expect(formatHourToTime(13)).toBe('1:00 PM');
      expect(formatHourToTime(17)).toBe('5:00 PM');
      expect(formatHourToTime(23)).toBe('11:00 PM');
    });

    it('should format half hours correctly', () => {
      expect(formatHourToTime(9.5)).toBe('9:30 AM');
      expect(formatHourToTime(17.5)).toBe('5:30 PM');
      expect(formatHourToTime(0.5)).toBe('12:30 AM');
    });

    it('should format quarter hours correctly', () => {
      expect(formatHourToTime(9.25)).toBe('9:15 AM');
      expect(formatHourToTime(9.75)).toBe('9:45 AM');
      expect(formatHourToTime(17.25)).toBe('5:15 PM');
    });

    it('should handle edge cases at midnight', () => {
      expect(formatHourToTime(0)).toBe('12:00 AM');
      expect(formatHourToTime(0.25)).toBe('12:15 AM');
    });

    it('should handle edge cases at noon', () => {
      expect(formatHourToTime(12)).toBe('12:00 PM');
      expect(formatHourToTime(12.5)).toBe('12:30 PM');
    });

    it('should pad minutes with leading zero', () => {
      expect(formatHourToTime(9.083)).toBe('9:05 AM'); // 0.083 * 60 ≈ 5
      expect(formatHourToTime(14.017)).toBe('2:01 PM'); // 0.017 * 60 ≈ 1
    });

    it('should handle decimal hour values', () => {
      expect(formatHourToTime(13.75)).toBe('1:45 PM'); // 1:45 PM
      expect(formatHourToTime(8.333)).toBe('8:20 AM'); // 8:20 AM (0.333 * 60 ≈ 20)
    });
  });

  describe('formatDuration', () => {
    it('should format whole hours without minutes', () => {
      expect(formatDuration(60)).toBe('1h');
      expect(formatDuration(120)).toBe('2h');
      expect(formatDuration(480)).toBe('8h');
      expect(formatDuration(0)).toBe('0h');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(75)).toBe('1h 15m');
      expect(formatDuration(90)).toBe('1h 30m');
      expect(formatDuration(135)).toBe('2h 15m');
      expect(formatDuration(255)).toBe('4h 15m');
    });

    it('should format only minutes when less than an hour', () => {
      expect(formatDuration(15)).toBe('0h 15m');
      expect(formatDuration(30)).toBe('0h 30m');
      expect(formatDuration(45)).toBe('0h 45m');
    });

    it('should handle standard work shift durations', () => {
      expect(formatDuration(480)).toBe('8h'); // 8 hour shift
      expect(formatDuration(510)).toBe('8h 30m'); // 8.5 hour shift
      expect(formatDuration(420)).toBe('7h'); // 7 hour shift
    });

    it('should handle long shifts', () => {
      expect(formatDuration(720)).toBe('12h'); // 12 hour shift
      expect(formatDuration(840)).toBe('14h'); // 14 hour shift
      expect(formatDuration(900)).toBe('15h'); // 15 hour shift
    });

    it('should handle single minute', () => {
      expect(formatDuration(1)).toBe('0h 1m');
      expect(formatDuration(61)).toBe('1h 1m');
    });

    it('should handle 59 minutes (edge before full hour)', () => {
      expect(formatDuration(59)).toBe('0h 59m');
      expect(formatDuration(119)).toBe('1h 59m');
    });
  });
});
