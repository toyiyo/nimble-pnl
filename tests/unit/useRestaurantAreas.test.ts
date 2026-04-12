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

  it('deduplicates case-sensitively', () => {
    const result = mergeAreas(['Kitchen'], ['Kitchen', 'Bar']);
    expect(result).toEqual(['Bar', 'Kitchen']);
  });
});
