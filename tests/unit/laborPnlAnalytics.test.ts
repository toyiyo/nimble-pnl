import { describe, it, expect } from 'vitest';
import { classifyBalance, LABOR_BALANCE_BAND } from '@/lib/laborPnlAnalytics';

describe('LABOR_BALANCE_BAND', () => {
  it('defaults to 6 percentage points', () => {
    expect(LABOR_BALANCE_BAND).toBe(6);
  });
});

describe('classifyBalance', () => {
  it('classifies over when labor% exceeds target+band', () => {
    expect(classifyBalance(28.01, 22, 6)).toBe('over');
  });

  it('classifies under when labor% is below target-band', () => {
    expect(classifyBalance(15.99, 22, 6)).toBe('under');
  });

  it('classifies balanced strictly within the band', () => {
    expect(classifyBalance(22, 22, 6)).toBe('balanced');
    expect(classifyBalance(25, 22, 6)).toBe('balanced');
    expect(classifyBalance(19, 22, 6)).toBe('balanced');
  });

  it('treats exactly target+band and target-band as balanced (inclusive edges)', () => {
    expect(classifyBalance(28, 22, 6)).toBe('balanced'); // target + band
    expect(classifyBalance(16, 22, 6)).toBe('balanced'); // target - band
  });

  it('defaults band to LABOR_BALANCE_BAND when omitted', () => {
    expect(classifyBalance(28, 22)).toBe('balanced');
    expect(classifyBalance(28.01, 22)).toBe('over');
  });

  it('guards targetPct<=0 as balanced regardless of laborPct', () => {
    expect(classifyBalance(50, 0)).toBe('balanced');
    expect(classifyBalance(50, -5)).toBe('balanced');
  });

  it('treats a null laborPct (no-sales bucket) as balanced, never over/under', () => {
    expect(classifyBalance(null, 22, 6)).toBe('balanced');
  });
});
