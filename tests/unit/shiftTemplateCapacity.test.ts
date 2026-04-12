import { describe, it, expect } from 'vitest';
import { computeOpenSpots, classifyCapacity } from '@/lib/openShiftHelpers';

describe('computeOpenSpots', () => {
  it('returns capacity minus assigned count', () => {
    expect(computeOpenSpots(3, 1)).toBe(2);
  });

  it('returns 0 when fully staffed', () => {
    expect(computeOpenSpots(2, 2)).toBe(0);
  });

  it('returns 0 when over-staffed (clamped)', () => {
    expect(computeOpenSpots(2, 3)).toBe(0);
  });

  it('returns full capacity when nobody assigned', () => {
    expect(computeOpenSpots(3, 0)).toBe(3);
  });

  it('defaults capacity to 1 when undefined', () => {
    expect(computeOpenSpots(undefined, 0)).toBe(1);
    expect(computeOpenSpots(undefined, 1)).toBe(0);
  });
});

describe('classifyCapacity', () => {
  it('returns "full" when no open spots', () => {
    expect(classifyCapacity(3, 3)).toBe('full');
  });

  it('returns "partial" when some spots filled', () => {
    expect(classifyCapacity(3, 1)).toBe('partial');
  });

  it('returns "empty" when no spots filled', () => {
    expect(classifyCapacity(3, 0)).toBe('empty');
  });

  it('returns "full" for default capacity of 1 with 1 assigned', () => {
    expect(classifyCapacity(1, 1)).toBe('full');
  });

  it('returns "full" when over-staffed', () => {
    expect(classifyCapacity(2, 3)).toBe('full');
  });
});
