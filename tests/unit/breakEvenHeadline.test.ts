import { describe, it, expect } from 'vitest';
import { buildBreakEvenHeadline } from '@/lib/breakEvenHeadline';

describe('buildBreakEvenHeadline', () => {
  it('builds the sentence when today is above break-even', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'above',
      todayDelta: 1240,
      dailyBreakEven: 2000,
      todaySales: 3240,
    });

    expect(result.tone).toBe('positive');
    expect(result.sentence).toBe('Today is $1,240 above break-even.');
    expect(result.progressPercent).toBe(100);
  });

  it('builds the sentence when today is below break-even', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'below',
      todayDelta: -860,
      dailyBreakEven: 2000,
      todaySales: 1140,
    });

    expect(result.tone).toBe('negative');
    expect(result.sentence).toBe('You need $860 more today to break even.');
    expect(result.progressPercent).toBe(57);
  });

  it('builds the sentence when today is exactly at break-even', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'at',
      todayDelta: 0,
      dailyBreakEven: 2000,
      todaySales: 2000,
    });

    expect(result.tone).toBe('neutral');
    expect(result.sentence).toBe('Today is at break-even.');
    expect(result.progressPercent).toBe(100);
  });

  it('builds the no-target sentence when dailyBreakEven is zero', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'above',
      todayDelta: 0,
      dailyBreakEven: 0,
      todaySales: 500,
    });

    expect(result.tone).toBe('neutral');
    expect(result.sentence).toBe('Set your operating costs to see break-even.');
    expect(result.progressPercent).toBe(0);
  });

  it('builds the no-target sentence when dailyBreakEven is not finite', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'above',
      todayDelta: 0,
      dailyBreakEven: Number.NaN,
      todaySales: 500,
    });

    expect(result.tone).toBe('neutral');
    expect(result.sentence).toBe('Set your operating costs to see break-even.');
    expect(result.progressPercent).toBe(0);
  });

  it('builds the no-target sentence when data is null', () => {
    const result = buildBreakEvenHeadline(null);

    expect(result.tone).toBe('neutral');
    expect(result.sentence).toBe('Set your operating costs to see break-even.');
    expect(result.progressPercent).toBe(0);
  });

  it('caps progressPercent at 100 when sales exceed break-even', () => {
    const result = buildBreakEvenHeadline({
      todayStatus: 'above',
      todayDelta: 5000,
      dailyBreakEven: 2000,
      todaySales: 7000,
    });

    expect(result.progressPercent).toBe(100);
  });
});
