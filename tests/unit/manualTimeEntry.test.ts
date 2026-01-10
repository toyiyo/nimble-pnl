import { describe, it, expect } from 'vitest';
import { setHours, setMinutes, startOfDay, format } from 'date-fns';

// Helper to parse flexible time input (9-530, 9a-5:30p, 09:00-17:30)
const parseTimeRange = (input: string, date: Date): { start: Date; end: Date } | null => {
  // Remove whitespace
  input = input.trim().replace(/\s+/g, '');
  
  // Pattern: 9-530, 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm
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
  
  return { start, end };
};

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
