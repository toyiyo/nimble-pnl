import { describe, it, expect } from 'vitest';
import type { Employee } from '@/types/scheduling';
import {
  matchEmployees,
  type ShiftImportEmployee,
} from '@/utils/shiftEmployeeMatching';
import { normalizeEmployeeKey } from '@/utils/timePunchImport';

const makeEmployee = (id: string, name: string, position: string): Employee =>
  ({ id, name, position, status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 0 } as Employee);

describe('shiftEmployeeMatching', () => {
  const employees = [
    makeEmployee('emp-1', 'Abraham Dominguez', 'Server'),
    makeEmployee('emp-2', 'Gaspar Vidanez', 'Kitchen Manager'),
    makeEmployee('emp-3', 'Alfonso Moya', 'Owner'),
  ];

  it('matches exact names', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('matches case-insensitively with extra spaces', () => {
    const csvNames = [
      { name: 'abraham   dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('matches reversed name order', () => {
    const csvNames = [
      { name: 'Dominguez, Abraham', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('marks unmatched names with partial confidence when words match', () => {
    const csvNames = [
      { name: 'Gaspar Chef  Vidanez', position: 'Kitchen Manager' },
    ];
    const result = matchEmployees(csvNames, employees);
    // "gaspar chef vidanez" != "gaspar vidanez" — no exact match but 2 words in common
    expect(result[0].matchConfidence).toBe('partial');
    expect(result[0].matchedEmployeeId).toBeNull();
    expect(result[0].action).toBe('create');
    expect(result[0].suggestedEmployeeId).toBe('emp-2');
    expect(result[0].suggestedEmployeeName).toBe('Gaspar Vidanez');
  });

  it('reports completely unknown employees as none', () => {
    const csvNames = [
      { name: 'Totally Unknown Person', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBeNull();
    expect(result[0].matchConfidence).toBe('none');
    expect(result[0].action).toBe('create');
  });

  it('deduplicates CSV names and uses most frequent position', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Abraham Dominguez', position: 'Bartender' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result).toHaveLength(1);
    expect(result[0].csvPosition).toBe('Server');
  });

  it('sets action to link for exact matches, create for none', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Unknown Person', position: 'Cook' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result.find(r => r.csvName === 'Abraham Dominguez')?.action).toBe('link');
    expect(result.find(r => r.csvName === 'Unknown Person')?.action).toBe('create');
  });
});

describe('buildEmployeeLookup collision', () => {
  it('first employee wins when two normalize to same key', () => {
    const collisionEmployees = [
      makeEmployee('emp-first', 'John Smith', 'Server'),
      makeEmployee('emp-second', 'Smith, John', 'Cook'),
    ];
    const csvNames = [{ name: 'John Smith', position: 'Server' }];
    const result = matchEmployees(csvNames, collisionEmployees);
    expect(result[0].matchedEmployeeId).toBe('emp-first');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('does not overwrite first employee with second having same normalized name variant', () => {
    const collisionEmployees = [
      makeEmployee('emp-a', 'García López', 'Server'),
      makeEmployee('emp-b', 'Lopez, Garcia', 'Cook'),
    ];
    const csvNames = [{ name: 'Garcia Lopez', position: 'Server' }];
    const result = matchEmployees(csvNames, collisionEmployees);
    expect(result[0].matchedEmployeeId).toBe('emp-a');
  });
});

describe('partial match safety', () => {
  it('partial matches set action to create with suggestion, not link', () => {
    const emps = [
      makeEmployee('emp-2', 'Gaspar Vidanez', 'Kitchen Manager'),
    ];
    const csvNames = [
      { name: 'Gaspar Chef Vidanez', position: 'Kitchen Manager' },
    ];
    const result = matchEmployees(csvNames, emps);
    expect(result[0].matchConfidence).toBe('partial');
    expect(result[0].action).toBe('create');
    expect(result[0].matchedEmployeeId).toBeNull();
    expect(result[0].suggestedEmployeeId).toBe('emp-2');
    expect(result[0].suggestedEmployeeName).toBe('Gaspar Vidanez');
  });

  it('does not cross-match employees sharing a surname', () => {
    const employeesWithSharedSurname = [
      makeEmployee('emp-a', 'Antonio Dominguez', 'Server'),
      makeEmployee('emp-b', 'Abraham Dominguez', 'Server'),
    ];
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employeesWithSharedSurname);
    expect(result[0].matchedEmployeeId).toBe('emp-b');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('rejects low-confidence partial matches below threshold', () => {
    const threeWordEmployees = [
      makeEmployee('emp-x', 'José García López', 'Server'),
      makeEmployee('emp-y', 'María García Rodríguez', 'Server'),
    ];
    const csvNames = [
      { name: 'Carlos García López', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, threeWordEmployees);
    // 2 of 3 words match emp-x ("garcia", "lopez") = 0.67, below 0.8 threshold
    expect(result[0].matchConfidence).toBe('none');
    expect(result[0].suggestedEmployeeId).toBeUndefined();
  });

  it('does not partial-match single-word CSV names', () => {
    const emps = [
      makeEmployee('emp-1', 'Abraham Dominguez', 'Server'),
    ];
    const csvNames = [
      { name: 'Dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, emps);
    expect(result[0].matchConfidence).toBe('none');
  });
});

describe('normalizeEmployeeKey — accent handling', () => {
  it('normalizes accented characters to ASCII equivalents', () => {
    expect(normalizeEmployeeKey('García')).toBe('garcia');
    expect(normalizeEmployeeKey('José')).toBe('jose');
    expect(normalizeEmployeeKey('Müller')).toBe('muller');
    expect(normalizeEmployeeKey('François')).toBe('francois');
  });

  it('matches accented and non-accented versions of the same name', () => {
    expect(normalizeEmployeeKey('María García')).toBe(normalizeEmployeeKey('Maria Garcia'));
  });
});

describe('accented name matching (end-to-end)', () => {
  it('matches accented CSV name to non-accented DB employee', () => {
    const accentedEmployees = [
      makeEmployee('emp-accent', 'Maria Garcia', 'Server'),
    ];
    const csvNames = [{ name: 'María García', position: 'Server' }];
    const result = matchEmployees(csvNames, accentedEmployees);
    expect(result[0].matchedEmployeeId).toBe('emp-accent');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('matches non-accented CSV name to accented DB employee', () => {
    const accentedEmployees = [
      makeEmployee('emp-accent', 'José García López', 'Server'),
    ];
    const csvNames = [{ name: 'Jose Garcia Lopez', position: 'Server' }];
    const result = matchEmployees(csvNames, accentedEmployees);
    expect(result[0].matchedEmployeeId).toBe('emp-accent');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('handles empty and whitespace-only names gracefully', () => {
    const emps = [makeEmployee('emp-1', 'John Smith', 'Server')];
    const csvNames = [
      { name: '', position: 'Server' },
      { name: '   ', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, emps);
    expect(result).toHaveLength(0);
  });
});
