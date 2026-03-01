import { describe, it, expect } from 'vitest';
import { ShiftInterval } from '@/domain/scheduling/shift-interval';

describe('ShiftInterval', () => {
  describe('creation & duration', () => {
    it('calculates duration for standard daytime shift', () => {
      const interval = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      expect(interval.durationInHours).toBe(6);
      expect(interval.durationInMinutes).toBe(360);
    });

    it('handles midnight crossing (22:00 to 02:00 = 4h)', () => {
      const interval = ShiftInterval.create('2026-02-28', '22:00', '02:00');
      expect(interval.durationInHours).toBe(4);
      expect(interval.endsOnNextDay).toBe(true);
    });

    it('handles midnight crossing (20:00 to 04:00 = 8h)', () => {
      const interval = ShiftInterval.create('2026-02-28', '20:00', '04:00');
      expect(interval.durationInHours).toBe(8);
      expect(interval.endsOnNextDay).toBe(true);
    });

    it('marks endsOnNextDay false for daytime shifts', () => {
      const interval = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      expect(interval.endsOnNextDay).toBe(false);
    });

    it('rejects zero-duration shift (start == end)', () => {
      expect(() => ShiftInterval.create('2026-02-28', '09:00', '09:00'))
        .toThrow('Shift must have positive duration');
    });

    it('rejects shift exceeding max endurance (16h)', () => {
      expect(() => ShiftInterval.create('2026-02-28', '08:00', '02:00'))
        .toThrow('Shift exceeds maximum endurance limit of 16h');
    });

    it('allows exactly 16h shift', () => {
      const interval = ShiftInterval.create('2026-02-28', '06:00', '22:00');
      expect(interval.durationInHours).toBe(16);
    });
  });

  describe('overlapsWith', () => {
    it('detects overlapping day shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '14:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('returns false for non-overlapping day shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '12:00');
      const b = ShiftInterval.create('2026-02-28', '13:00', '17:00');
      expect(a.overlapsWith(b)).toBe(false);
    });

    it('returns false for adjacent shifts (end == start)', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '12:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.overlapsWith(b)).toBe(false);
    });

    it('detects identical ranges as overlapping', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      const b = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('detects overnight shifts overlapping', () => {
      const a = ShiftInterval.create('2026-02-28', '22:00', '04:00');
      const b = ShiftInterval.create('2026-02-28', '23:00', '05:00');
      expect(a.overlapsWith(b)).toBe(true);
    });

    it('detects daytime shift overlapping with overnight evening portion', () => {
      const overnight = ShiftInterval.create('2026-02-28', '20:00', '04:00');
      const evening = ShiftInterval.create('2026-02-28', '21:00', '23:00');
      expect(overnight.overlapsWith(evening)).toBe(true);
    });

    it('detects containment (one range inside another)', () => {
      const outer = ShiftInterval.create('2026-02-28', '08:00', '18:00');
      const inner = ShiftInterval.create('2026-02-28', '10:00', '14:00');
      expect(outer.overlapsWith(inner)).toBe(true);
    });
  });

  describe('restHoursBefore', () => {
    it('calculates rest hours between consecutive day shifts', () => {
      const first = ShiftInterval.create('2026-02-28', '09:00', '17:00');
      const second = ShiftInterval.create('2026-03-01', '09:00', '17:00');
      expect(first.restHoursBefore(second)).toBe(16);
    });

    it('calculates clopening rest hours (closing then opening)', () => {
      const closing = ShiftInterval.create('2026-02-28', '18:00', '02:00');
      const opening = ShiftInterval.create('2026-03-01', '08:00', '14:00');
      expect(closing.restHoursBefore(opening)).toBe(6);
    });

    it('returns 0 for overlapping shifts', () => {
      const a = ShiftInterval.create('2026-02-28', '09:00', '14:00');
      const b = ShiftInterval.create('2026-02-28', '12:00', '17:00');
      expect(a.restHoursBefore(b)).toBe(0);
    });
  });
});
