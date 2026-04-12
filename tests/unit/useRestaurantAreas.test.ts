import { describe, it, expect } from 'vitest';
import { mergeAreas } from '@/hooks/useEmployeeAreas';

describe('mergeAreas', () => {
  it('returns sorted unique areas from employees and templates', () => {
    const employeeAreas = ['Kitchen', 'Bar'];
    const templateAreas = ['Front of House', 'Kitchen'];
    const result = mergeAreas(employeeAreas, templateAreas);
    expect(result).toEqual(['Bar', 'Front of House', 'Kitchen']);
  });

  it('handles empty arrays', () => {
    expect(mergeAreas([], [])).toEqual([]);
  });

  it('preserves different casings as separate entries', () => {
    const result = mergeAreas(['Kitchen'], ['kitchen', 'Bar']);
    expect(result).toEqual(['Bar', 'kitchen', 'Kitchen']);
  });
});
