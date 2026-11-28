import { describe, it, expect } from 'vitest';
import { positionFields } from '../../supabase/functions/_shared/shiftRowFields';

describe('positionFields', () => {
  it('flags two different positions and shows both values', () => {
    expect(positionFields('Server', 'Cook')).toEqual({
      position_mismatch: true,
      shift_position: 'Server',
      employee_position: 'Cook',
    });
  });

  it('ignores case and outer spaces', () => {
    expect(positionFields(' server ', 'Server')).toEqual({ position_mismatch: false });
  });

  it('gives false when one side is null or empty', () => {
    expect(positionFields(null, 'Cook')).toEqual({ position_mismatch: false });
    expect(positionFields('Cook', undefined)).toEqual({ position_mismatch: false });
    expect(positionFields('  ', 'Cook')).toEqual({ position_mismatch: false });
  });
});
