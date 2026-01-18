import { describe, it, expect } from 'vitest';
import type { Employee } from '@/types/scheduling';
import {
  buildTimePunchImportPreview,
  normalizeEmployeeKey,
  type TimePunchColumnMapping,
} from '@/utils/timePunchImport';

const baseMappings: TimePunchColumnMapping[] = [
  { csvColumn: 'Employee', targetField: 'employee_name', confidence: 'high' },
  { csvColumn: 'Date', targetField: 'date', confidence: 'high' },
  { csvColumn: 'Time In', targetField: 'clock_in_time', confidence: 'high' },
  { csvColumn: 'Time Out', targetField: 'clock_out_time', confidence: 'high' },
  { csvColumn: 'Cash Tips Declared', targetField: 'tips', confidence: 'high' },
];

const baseRows = [
  {
    Employee: 'Lopez, Bianca',
    Date: 'Jan 12, 2026',
    'Time In': '08:50 AM',
    'Time Out': '04:12 PM',
    'Cash Tips Declared': '12.00',
  },
];

const baseArgs = {
  rows: baseRows,
  mappings: baseMappings,
  restaurantId: 'rest-1',
  sourceLabel: 'CSV upload',
};

describe('time punch import', () => {
  it('normalizes employee keys for matching', () => {
    expect(normalizeEmployeeKey('Lopez , Bianca')).toBe('lopez bianca');
    expect(normalizeEmployeeKey('  Bianca  Lopez ')).toBe('bianca lopez');
  });

  it('flags unmatched employees and skips punches', () => {
    const preview = buildTimePunchImportPreview({
      ...baseArgs,
      employees: [],
    });

    expect(preview.totalPunches).toBe(0);
    expect(preview.missingEmployees).toBe(1);
    expect(preview.unmatchedEmployees).toEqual([{ name: 'Lopez, Bianca', count: 1 }]);
  });

  it('creates punches when employees match or are overridden', () => {
    const employees = [
      {
        id: 'emp-1',
        name: 'Bianca Lopez',
        position: 'Cashier',
      } as Employee,
    ];

    const previewMatch = buildTimePunchImportPreview({
      ...baseArgs,
      employees,
    });

    expect(previewMatch.totalPunches).toBe(2);
    expect(previewMatch.tips[0]?.tip_amount).toBe(1200);
    expect(previewMatch.tips[0]?.tip_source).toBe('cash');

    const previewOverride = buildTimePunchImportPreview({
      ...baseArgs,
      employees: [],
      employeeOverrides: {
        [normalizeEmployeeKey('Lopez, Bianca')]: 'emp-9',
      },
    });

    expect(previewOverride.totalPunches).toBe(2);
    expect(previewOverride.punches.every(punch => punch.employee_id === 'emp-9')).toBe(true);
  });
});
