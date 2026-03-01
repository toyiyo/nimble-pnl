import { describe, it, expect } from 'vitest';
import { ShiftInterval } from '@/lib/shiftInterval';

describe('ShiftInterval Value Object', () => {
  describe('creation and duration', () => {
    it('should calculate duration for standard shifts (10 AM - 4 PM)', () => {
      const interval = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      expect(interval.durationInHours).toBe(6);
      expect(interval.durationInMinutes).toBe(360);
      expect(interval.endsOnNextDay).toBe(false);
    });

    it('should handle midnight crossing (10 PM - 2 AM)', () => {
      const interval = ShiftInterval.create('2026-02-28', '22:00', '02:00');
      expect(interval.durationInHours).toBe(4);
      expect(interval.durationInMinutes).toBe(240);
      expect(interval.endsOnNextDay).toBe(true);
    });

    it('should reject shifts with zero duration', () => {
      expect(() => ShiftInterval.create('2026-02-28', '10:00', '10:00'))
        .toThrow('INVALID_DURATION');
    });

    it('should reject shifts shorter than 15 minutes', () => {
      expect(() => ShiftInterval.create('2026-02-28', '10:00', '10:10'))
        .toThrow('TOO_SHORT');
    });

    it('should reject shifts longer than 16 hours', () => {
      expect(() => ShiftInterval.create('2026-02-28', '08:00', '02:00'))
        .toThrow('MAX_ENDURANCE');
    });

    it('should accept exactly 16 hour shifts', () => {
      const interval = ShiftInterval.create('2026-02-28', '06:00', '22:00');
      expect(interval.durationInHours).toBe(16);
    });

    it('should expose startAt and endAt as Date objects', () => {
      const interval = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      expect(interval.startAt).toBeInstanceOf(Date);
      expect(interval.endAt).toBeInstanceOf(Date);
    });

    it('should set businessDate correctly', () => {
      const interval = ShiftInterval.create('2026-02-28', '22:00', '02:00');
      expect(interval.businessDate).toBe('2026-02-28');
    });
  });

  describe('fromTimestamps', () => {
    it('should create interval from ISO timestamps', () => {
      const interval = ShiftInterval.fromTimestamps(
        '2026-02-28T10:00:00',
        '2026-02-28T16:00:00',
        '2026-02-28'
      );
      expect(interval.durationInHours).toBe(6);
    });

    it('should handle midnight-crossing timestamps', () => {
      const interval = ShiftInterval.fromTimestamps(
        '2026-02-28T22:00:00',
        '2026-03-01T02:00:00',
        '2026-02-28'
      );
      expect(interval.durationInHours).toBe(4);
      expect(interval.endsOnNextDay).toBe(true);
    });
  });

  describe('overlap detection', () => {
    it('should detect overlap between intersecting shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const b = ShiftInterval.create('2026-02-28', '14:00', '20:00');
      expect(a.overlapsWith(b)).toBe(true);
      expect(b.overlapsWith(a)).toBe(true);
    });

    it('should not detect overlap for adjacent shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const b = ShiftInterval.create('2026-02-28', '16:00', '22:00');
      expect(a.overlapsWith(b)).toBe(false);
    });

    it('should detect overlap with midnight-crossing shift', () => {
      const nightShift = ShiftInterval.create('2026-02-28', '22:00', '03:00');
      const earlyMorning = ShiftInterval.create('2026-03-01', '02:00', '06:00');
      expect(nightShift.overlapsWith(earlyMorning)).toBe(true);
    });

    it('should not detect overlap for non-intersecting shifts', () => {
      const morning = ShiftInterval.create('2026-02-28', '08:00', '12:00');
      const evening = ShiftInterval.create('2026-02-28', '18:00', '22:00');
      expect(morning.overlapsWith(evening)).toBe(false);
    });
  });

  describe('rest hours calculation', () => {
    it('should calculate rest hours between consecutive shifts', () => {
      const first = ShiftInterval.create('2026-02-28', '08:00', '16:00');
      const second = ShiftInterval.create('2026-02-28', '22:00', '02:00');
      expect(first.restHoursUntil(second)).toBe(6);
    });

    it('should calculate rest hours across midnight', () => {
      const closing = ShiftInterval.create('2026-02-28', '18:00', '02:00');
      const opening = ShiftInterval.create('2026-03-01', '08:00', '14:00');
      expect(closing.restHoursUntil(opening)).toBe(6);
    });

    it('should return 0 for overlapping shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const b = ShiftInterval.create('2026-02-28', '14:00', '20:00');
      expect(a.restHoursUntil(b)).toBe(0);
    });
  });

  describe('invalid input handling', () => {
    it('should reject invalid ISO timestamps', () => {
      expect(() => ShiftInterval.fromTimestamps('garbage', '2026-02-28T16:00:00', '2026-02-28'))
        .toThrow('INVALID_DATE');
    });

    it('should reject reversed timestamps', () => {
      expect(() => ShiftInterval.fromTimestamps(
        '2026-02-28T16:00:00',
        '2026-02-28T10:00:00',
        '2026-02-28'
      )).toThrow('INVALID_DURATION');
    });
  });
});
