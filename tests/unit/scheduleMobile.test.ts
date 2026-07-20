import { describe, it, expect } from 'vitest';
import { pickDefaultMobileDay } from '@/lib/scheduleMobile';

const weekOf = (startYear: number, startMonth: number, startDate: number): Date[] =>
  Array.from({ length: 7 }, (_, i) => new Date(startYear, startMonth, startDate + i));

describe('pickDefaultMobileDay', () => {
  it('returns the index of today when today is mid-week', () => {
    // Week of Mon Apr 6 - Sun Apr 12, 2026; today = Wed Apr 8 (index 2).
    const weekDays = weekOf(2026, 3, 6);
    const today = new Date(2026, 3, 8);
    expect(pickDefaultMobileDay(weekDays, today)).toBe(2);
  });

  it('returns 0 when today is the first day of the week', () => {
    const weekDays = weekOf(2026, 3, 6);
    const today = new Date(2026, 3, 6);
    expect(pickDefaultMobileDay(weekDays, today)).toBe(0);
  });

  it('returns the last index when today is the last day of the week', () => {
    const weekDays = weekOf(2026, 3, 6);
    const today = new Date(2026, 3, 12);
    expect(pickDefaultMobileDay(weekDays, today)).toBe(6);
  });

  it('matches by calendar day, ignoring time-of-day differences', () => {
    const weekDays = weekOf(2026, 3, 6);
    const today = new Date(2026, 3, 8, 23, 59, 59);
    expect(pickDefaultMobileDay(weekDays, today)).toBe(2);
  });

  it('falls back to 0 when today is outside the displayed week', () => {
    const weekDays = weekOf(2026, 3, 6); // Apr 6-12
    const today = new Date(2026, 3, 20); // Apr 20, a different week
    expect(pickDefaultMobileDay(weekDays, today)).toBe(0);
  });

  it('falls back to 0 for an empty week array (guard)', () => {
    const today = new Date(2026, 3, 8);
    expect(pickDefaultMobileDay([], today)).toBe(0);
  });
});
