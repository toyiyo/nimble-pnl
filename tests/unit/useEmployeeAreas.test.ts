import { describe, it, expect } from 'vitest';
import { DEFAULT_AREAS } from '@/hooks/useEmployeeAreas';

describe('useEmployeeAreas', () => {
  it('exports predefined DEFAULT_AREAS', () => {
    expect(DEFAULT_AREAS).toEqual([
      'Back of House',
      'Front of House',
      'Bar',
      'Management',
    ]);
  });

  it('DEFAULT_AREAS contains common restaurant zones', () => {
    expect(DEFAULT_AREAS).toContain('Back of House');
    expect(DEFAULT_AREAS).toContain('Front of House');
    expect(DEFAULT_AREAS).toContain('Bar');
    expect(DEFAULT_AREAS).toContain('Management');
  });

  it('DEFAULT_AREAS has no duplicates', () => {
    const unique = new Set(DEFAULT_AREAS);
    expect(unique.size).toBe(DEFAULT_AREAS.length);
  });
});
