import { describe, it, expect } from 'vitest';
import { calculateMonthlyProgress } from '@/lib/monthlyBreakEvenProgress';

// Use UTC math to keep day-of-month deterministic across CI hosts.
function utcDate(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, 12, 0, 0));
}

describe('calculateMonthlyProgress', () => {
  it('returns no_target when monthlyBreakEven is 0', () => {
    const result = calculateMonthlyProgress({
      monthlyBreakEven: 0,
      mtdSales: 5000,
      today: utcDate(2026, 5, 15),
    });

    expect(result.status).toBe('no_target');
    expect(result.amountRemaining).toBe(0);
    expect(result.dailyNeeded).toBe(0);
  });

  it('returns no_target when monthlyBreakEven is Infinity (contribution margin <= 0)', () => {
    const result = calculateMonthlyProgress({
      monthlyBreakEven: Infinity,
      mtdSales: 5000,
      today: utcDate(2026, 5, 15),
    });

    expect(result.status).toBe('no_target');
    expect(Number.isFinite(result.projectedMonthly)).toBe(true);
  });

  it('returns no_target when monthlyBreakEven is negative', () => {
    const result = calculateMonthlyProgress({
      monthlyBreakEven: -100,
      mtdSales: 0,
      today: utcDate(2026, 5, 1),
    });

    expect(result.status).toBe('no_target');
  });

  it('day 1 of 31 with mtd=0: 3.2pp gap is inside the 5pp tolerance, so on_pace', () => {
    const result = calculateMonthlyProgress({
      monthlyBreakEven: 31000,
      mtdSales: 0,
      today: utcDate(2026, 5, 1),
    });

    expect(result.daysInMonth).toBe(31);
    expect(result.dayOfMonth).toBe(1);
    expect(result.expectedPercent).toBeCloseTo((1 / 31) * 100, 5);
    expect(result.progressPercent).toBe(0);
    expect(result.amountRemaining).toBe(31000);
    expect(result.daysRemaining).toBe(31);
    expect(result.dailyNeeded).toBeCloseTo(1000, 5);
    expect(result.status).toBe('on_pace');
  });

  it('day 7 of 31 with mtd=0: 22.6pp gap is well outside tolerance, status behind', () => {
    const result = calculateMonthlyProgress({
      monthlyBreakEven: 31000,
      mtdSales: 0,
      today: utcDate(2026, 5, 7),
    });

    expect(result.expectedPercent).toBeCloseTo((7 / 31) * 100, 5);
    expect(result.paceDelta).toBeLessThan(-5);
    expect(result.status).toBe('behind');
  });

  it('mid-month exact pace: status is on_pace', () => {
    const target = 31000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: (16 / 31) * target,
      today: utcDate(2026, 5, 16),
    });

    expect(result.progressPercent).toBeCloseTo(result.expectedPercent, 5);
    expect(Math.abs(result.paceDelta)).toBeLessThan(0.0001);
    expect(result.status).toBe('on_pace');
  });

  it('ahead by >5pp: status ahead, projection above target', () => {
    const target = 31000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: 0.7 * target,
      today: utcDate(2026, 5, 16),
    });

    expect(result.paceDelta).toBeGreaterThan(5);
    expect(result.status).toBe('ahead');
    expect(result.projectedMonthly).toBeGreaterThan(target);
    expect(result.projectedDelta).toBeGreaterThan(0);
    // dailyActual = mtdSales / dayOfMonth = 0.7 * 31000 / 16 ≈ 1356
    expect(result.dailyActual).toBeCloseTo((0.7 * target) / 16, 2);
    // projection ≈ dailyActual * daysInMonth = 1356 * 31 ≈ 42050
    expect(result.projectedMonthly).toBeCloseTo(((0.7 * target) / 16) * 31, 2);
  });

  it('behind by >5pp: status behind, projection below target', () => {
    const target = 31000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: 0.2 * target,
      today: utcDate(2026, 5, 16),
    });

    expect(result.paceDelta).toBeLessThan(-5);
    expect(result.status).toBe('behind');
    expect(result.projectedMonthly).toBeLessThan(target);
    expect(result.projectedDelta).toBeLessThan(0);
  });

  it('last day of month: daysRemaining=1 and dailyNeeded equals amountRemaining', () => {
    const target = 31000;
    const mtd = 28000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: mtd,
      today: utcDate(2026, 5, 31),
    });

    expect(result.daysInMonth).toBe(31);
    expect(result.dayOfMonth).toBe(31);
    expect(result.daysRemaining).toBe(1);
    expect(result.amountRemaining).toBe(3000);
    expect(result.dailyNeeded).toBe(3000);
  });

  it('hit the target exactly: amountRemaining=0, dailyNeeded=0, status ahead', () => {
    const target = 31000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: target,
      today: utcDate(2026, 5, 16),
    });

    expect(result.amountRemaining).toBe(0);
    expect(result.dailyNeeded).toBe(0);
    expect(result.status).toBe('ahead');
  });

  it('over the target: amountRemaining clamped to 0', () => {
    const target = 31000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: target * 1.5,
      today: utcDate(2026, 5, 16),
    });

    expect(result.amountRemaining).toBe(0);
    expect(result.dailyNeeded).toBe(0);
    expect(result.status).toBe('ahead');
    expect(result.projectedDelta).toBeGreaterThan(0);
  });

  it('30-day month (April): daysInMonth=30, dayOfMonth resolved correctly', () => {
    const target = 30000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: 20000,
      today: utcDate(2026, 4, 20),
    });

    expect(result.daysInMonth).toBe(30);
    expect(result.dayOfMonth).toBe(20);
    expect(result.daysRemaining).toBe(11);
    expect(result.dailyNeeded).toBeCloseTo((target - 20000) / 11, 5);
  });

  it('February leap year (2024): daysInMonth=29', () => {
    const target = 29000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: 14500,
      today: utcDate(2024, 2, 15),
    });

    expect(result.daysInMonth).toBe(29);
    expect(result.dayOfMonth).toBe(15);
  });

  it('comprehensive branch coverage fixture: ahead + projection-over-target + non-zero remaining', () => {
    // One fixture that exercises multiple branches in a single test to keep
    // SonarCloud branch coverage above 80% per lesson [2026-05-24].
    const target = 60000;
    const result = calculateMonthlyProgress({
      monthlyBreakEven: target,
      mtdSales: 0.45 * target, // 27000 — ahead of day-10/30 pace (33.3%) by ~11.7pp
      today: utcDate(2026, 6, 10), // June: 30 days
    });

    expect(result.daysInMonth).toBe(30);
    expect(result.dayOfMonth).toBe(10);
    expect(result.status).toBe('ahead');
    expect(result.progressPercent).toBeCloseTo(45, 1);
    expect(result.expectedPercent).toBeCloseTo(100 / 3, 1);
    expect(result.paceDelta).toBeGreaterThan(5);
    expect(result.amountRemaining).toBeCloseTo(33000, 1);
    expect(result.daysRemaining).toBe(21);
    expect(result.dailyNeeded).toBeCloseTo(33000 / 21, 2);
    expect(result.dailyActual).toBeCloseTo(2700, 2);
    expect(result.projectedMonthly).toBeCloseTo(81000, 1);
    expect(result.projectedDelta).toBeCloseTo(21000, 1);
    expect(result.monthLabel).toMatch(/June 2026/);
  });
});
