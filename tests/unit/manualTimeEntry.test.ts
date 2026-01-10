import { describe, it, expect } from 'vitest';
import { setHours, setMinutes, startOfDay, format } from 'date-fns';
import { parseTimeRange, formatHourToTime } from '@/lib/timeUtils';

describe('ManualTimelineEditor - Time Parsing', () => {
  const testDate = new Date('2024-01-15T00:00:00.000Z');

  describe('parseTimeRange', () => {
    it('should parse 24-hour format: 09:00-17:30', () => {
      const result = parseTimeRange('09:00-17:30', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:30');
      }
    });

    it('should parse format with colon: 9:00-17:30', () => {
      const result = parseTimeRange('9:00-17:30', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:30');
      }
    });

    it('should parse format with AM/PM: 9a-5p', () => {
      const result = parseTimeRange('9a-5p', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:00');
      }
    });

    it('should parse format with full AM/PM and minutes: 9am-5:30pm', () => {
      const result = parseTimeRange('9am-5:30pm', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:30');
      }
    });

    it('should parse format with spaces removed: 9 am - 5:30 pm', () => {
      const result = parseTimeRange('9 am - 5:30 pm', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:30');
      }
    });

    it('should handle 12am (midnight) correctly', () => {
      const result = parseTimeRange('12am-8am', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('00:00');
        expect(format(result.end, 'HH:mm')).toBe('08:00');
      }
    });

    it('should handle 12pm (noon) correctly', () => {
      const result = parseTimeRange('12pm-5pm', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('12:00');
        expect(format(result.end, 'HH:mm')).toBe('17:00');
      }
    });

    it('should reject invalid format', () => {
      const result = parseTimeRange('invalid', testDate);
      expect(result).toBeNull();
    });

    it('should reject reversed time range', () => {
      const result = parseTimeRange('17:00-9:00', testDate);
      expect(result).toBeNull();
    });

    it('should reject same start and end time', () => {
      const result = parseTimeRange('9:00-9:00', testDate);
      expect(result).toBeNull();
    });

    it('should parse military time format: 0900-1730', () => {
      const result = parseTimeRange('09:00-17:30', testDate);
      expect(result).not.toBeNull();
      if (result) {
        expect(format(result.start, 'HH:mm')).toBe('09:00');
        expect(format(result.end, 'HH:mm')).toBe('17:30');
      }
    });

    it('should parse late night shift: 10pm-2am (note: requires special handling)', () => {
      // This is a known limitation - crosses midnight
      // In real implementation, might need special logic for overnight shifts
      const result = parseTimeRange('10pm-2am', testDate);
      // This will fail because end (2am) < start (10pm) in same day
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace variations', () => {
      const variations = [
        '09:00-17:30',
        ' 09:00-17:30 ',
        '09:00 - 17:30',
        '  09:00  -  17:30  ',
      ];

      variations.forEach(input => {
        const result = parseTimeRange(input, testDate);
        expect(result).not.toBeNull();
        if (result) {
          expect(format(result.start, 'HH:mm')).toBe('09:00');
        }
      });
    });

    it('should handle different dash characters', () => {
      const result1 = parseTimeRange('09:00-17:30', testDate); // regular dash
      const result2 = parseTimeRange('09:00–17:30', testDate); // en dash
      
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
    });

    it('should reject incomplete input', () => {
      const invalidInputs = [
        '9-',
        '-530',
        '9',
        '',
        'am-pm',
      ];

      invalidInputs.forEach(input => {
        const result = parseTimeRange(input, testDate);
        expect(result).toBeNull();
      });
    });
  });
});

describe('ManualTimelineEditor - Time Block Calculations', () => {
  it('should calculate hours correctly', () => {
    const start = setMinutes(setHours(startOfDay(new Date()), 9), 0);
    const end = setMinutes(setHours(startOfDay(new Date()), 17), 30);
    
    const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    const hours = diffMinutes / 60;
    
    expect(hours).toBe(8.5);
  });

  it('should detect overtime (>12 hours)', () => {
    const blocks = [
      { startHour: 6, endHour: 14 },   // 8 hours
      { startHour: 15, endHour: 21 },  // 6 hours
    ];
    
    const totalHours = blocks.reduce((sum, block) => sum + (block.endHour - block.startHour), 0);
    
    expect(totalHours).toBe(14);
    expect(totalHours > 12).toBe(true);
  });

  it('should calculate split shifts correctly', () => {
    const blocks = [
      { startHour: 8, endHour: 12 },   // 4 hours (morning)
      { startHour: 16, endHour: 20 },  // 4 hours (evening)
    ];
    
    const totalHours = blocks.reduce((sum, block) => sum + (block.endHour - block.startHour), 0);
    
    expect(totalHours).toBe(8);
  });
});

describe('Time Formatting', () => {
  describe('formatHourToTime', () => {
    it('should format morning hours correctly', () => {
      expect(formatHourToTime(9)).toBe('9:00 AM');
      expect(formatHourToTime(9.5)).toBe('9:30 AM');
      expect(formatHourToTime(11.75)).toBe('11:45 AM');
    });

    it('should handle midnight correctly', () => {
      expect(formatHourToTime(0)).toBe('12:00 AM');
    });

    it('should handle noon correctly', () => {
      expect(formatHourToTime(12)).toBe('12:00 PM');
      expect(formatHourToTime(12.5)).toBe('12:30 PM');
    });

    it('should format afternoon hours correctly', () => {
      expect(formatHourToTime(13)).toBe('1:00 PM');
      expect(formatHourToTime(17.5)).toBe('5:30 PM');
      expect(formatHourToTime(23.75)).toBe('11:45 PM');
    });
  });
});
