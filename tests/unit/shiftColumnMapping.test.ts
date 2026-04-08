import { describe, it, expect } from 'vitest';
import {
  suggestShiftMappings,
  type ShiftColumnMapping,
  type ShiftTargetField,
} from '@/utils/shiftColumnMapping';

describe('shiftColumnMapping', () => {
  it('maps common shift CSV headers with high confidence', () => {
    const headers = ['Employee Name', 'Date', 'Start Time', 'End Time', 'Position', 'Break Duration'];
    const sampleData = [{ 'Employee Name': 'John', Date: '2026-02-23', 'Start Time': '9:00 AM', 'End Time': '5:00 PM', Position: 'Server', 'Break Duration': '30' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    const findMapping = (field: ShiftTargetField) => mappings.find(m => m.targetField === field);
    expect(findMapping('employee_name')?.confidence).toBe('high');
    expect(findMapping('date')?.confidence).toBe('high');
    expect(findMapping('start_time')?.confidence).toBe('high');
    expect(findMapping('end_time')?.confidence).toBe('high');
    expect(findMapping('position')?.confidence).toBe('high');
    expect(findMapping('break_duration')).toBeDefined();
  });

  it('maps aliased headers like employee_id, shift_date', () => {
    const headers = ['employee_id', 'shift_date', 'clock_in', 'clock_out'];
    const sampleData = [{ employee_id: 'emp-1', shift_date: '2026-02-23', clock_in: '09:00', clock_out: '17:00' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.targetField === 'employee_id')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'date')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'start_time')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'end_time')).toBeDefined();
  });

  it('does not map the same field twice', () => {
    const headers = ['Name', 'Employee Name', 'Date', 'Start', 'End'];
    const sampleData = [{ Name: 'John', 'Employee Name': 'John Smith', Date: '2026-02-23', Start: '9:00 AM', End: '5:00 PM' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    const employeeNameMappings = mappings.filter(m => m.targetField === 'employee_name');
    expect(employeeNameMappings).toHaveLength(1);
  });

  it('falls back to first text column for employee_name if no keyword match', () => {
    const headers = ['Col A', 'Col B', 'Col C'];
    const sampleData = [{ 'Col A': 'John Smith', 'Col B': '2026-02-23', 'Col C': '09:00' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.targetField === 'employee_name')?.csvColumn).toBe('Col A');
    expect(mappings.find(m => m.targetField === 'employee_name')?.confidence).toBe('low');
  });

  it('sets null targetField for unrecognized columns', () => {
    const headers = ['Employee Name', 'Favorite Color'];
    const sampleData = [{ 'Employee Name': 'John', 'Favorite Color': 'Blue' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.csvColumn === 'Favorite Color')?.targetField).toBeNull();
  });
});
