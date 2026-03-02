import { describe, it, expect } from 'vitest';
import { jsDateToDayOfWeek, templateAppliesToDay } from '@/hooks/useShiftTemplates';

describe('useShiftTemplates helpers', () => {
  describe('jsDateToDayOfWeek', () => {
    it('should convert JS Sunday (0) to template Sunday (0)', () => {
      expect(jsDateToDayOfWeek(0)).toBe(0);
    });

    it('should convert JS Monday (1) to template Monday (1)', () => {
      expect(jsDateToDayOfWeek(1)).toBe(1);
    });

    it('should convert JS Saturday (6) to template Saturday (6)', () => {
      expect(jsDateToDayOfWeek(6)).toBe(6);
    });
  });

  describe('templateAppliesToDay', () => {
    it('should return true when day is in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(true); // Monday
    });

    it('should return false when day is not in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-01')).toBe(false); // Sunday
    });

    it('should handle weekend-only templates', () => {
      const template = { days: [0, 6] }; // Sun, Sat
      expect(templateAppliesToDay(template, '2026-02-28')).toBe(true);  // Saturday
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(false); // Monday
    });
  });
});
