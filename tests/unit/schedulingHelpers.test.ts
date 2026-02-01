import { describe, it, expect } from 'vitest';
import { getShiftStatusClass } from '@/pages/Scheduling';
import { buildShiftChangeDescription } from '@/hooks/useShifts';

describe('getShiftStatusClass', () => {
  it('returns conflict styling when conflicts are present', () => {
    expect(getShiftStatusClass('confirmed', true)).toBe('border-l-warning bg-warning/5 hover:bg-warning/10');
  });

  it('returns status styling when no conflicts', () => {
    expect(getShiftStatusClass('confirmed', false)).toBe('border-l-success');
    expect(getShiftStatusClass('cancelled', false)).toBe('border-l-destructive opacity-60');
    expect(getShiftStatusClass('scheduled', false)).toBe('border-l-primary/50');
  });
});

describe('buildShiftChangeDescription', () => {
  it('describes deleted shifts with preserved locked shifts', () => {
    expect(buildShiftChangeDescription(2, 1, 'deleted')).toBe('2 shifts deleted. 1 locked shift was preserved.');
  });

  it('describes updated shifts with unchanged locked shifts', () => {
    expect(buildShiftChangeDescription(3, 2, 'updated')).toBe('3 shifts updated. 2 locked shifts were unchanged.');
  });

  it('handles singular grammar correctly', () => {
    expect(buildShiftChangeDescription(1, 0, 'deleted')).toBe('1 shift deleted.');
    expect(buildShiftChangeDescription(1, 1, 'updated')).toBe('1 shift updated. 1 locked shift was unchanged.');
  });
});
