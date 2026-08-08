import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Task 4 Step 5: `employees_secure` masks `date_of_birth` for a caller
// without `view:employee_pii`. The four components below must read the
// server-computed `is_minor` flag instead of computing it client-side
// from a column that may not be there.

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

describe('components read is_minor from the row instead of computing it', () => {
  it('EmployeeList.tsx no longer calls isMinor(employee.date_of_birth)', () => {
    const source = readSource('src/components/EmployeeList.tsx');
    expect(source).not.toContain('isMinor(employee.date_of_birth)');
  });

  it('EmployeeList.tsx reads employee.is_minor', () => {
    const source = readSource('src/components/EmployeeList.tsx');
    expect(source).toContain('{employee.is_minor && (');
  });

  it('EmployeeList.tsx no longer imports isMinor', () => {
    const source = readSource('src/components/EmployeeList.tsx');
    expect(source).not.toContain("import { isMinor } from '@/lib/employeeUtils';");
  });

  it('WeekScheduleMobile.tsx no longer calls isMinor(employee.date_of_birth)', () => {
    const source = readSource('src/components/scheduling/WeekScheduleMobile.tsx');
    expect(source).not.toContain('isMinor(employee.date_of_birth)');
  });

  it('WeekScheduleMobile.tsx reads employee.is_minor', () => {
    const source = readSource('src/components/scheduling/WeekScheduleMobile.tsx');
    expect(source).toContain('const isMinorEmployee = employee.is_minor === true;');
  });

  it('WeekScheduleMobile.tsx no longer imports isMinor', () => {
    const source = readSource('src/components/scheduling/WeekScheduleMobile.tsx');
    expect(source).not.toContain("import { isMinor } from '@/lib/employeeUtils';");
  });

  it('Scheduling.tsx no longer calls isMinor(employee.date_of_birth)', () => {
    const source = readSource('src/pages/Scheduling.tsx');
    expect(source).not.toContain('isMinor(employee.date_of_birth)');
  });

  it('Scheduling.tsx reads employee.is_minor', () => {
    const source = readSource('src/pages/Scheduling.tsx');
    expect(source).toContain('const isMinorEmployee = employee.is_minor === true;');
  });

  it('Scheduling.tsx no longer imports isMinor', () => {
    const source = readSource('src/pages/Scheduling.tsx');
    expect(source).not.toContain("import { isMinor } from '@/lib/employeeUtils';");
  });

  it('EmployeeSidebar.tsx declares is_minor on its local Employee type', () => {
    const source = readSource('src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx');
    expect(source).toContain('is_minor?: boolean;');
  });

  it('EmployeeSidebar.tsx no longer calls isMinor(employee.date_of_birth)', () => {
    const source = readSource('src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx');
    expect(source).not.toContain('isMinor(employee.date_of_birth)');
  });

  it('EmployeeSidebar.tsx reads employee.is_minor', () => {
    const source = readSource('src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx');
    expect(source).toContain('{employee.is_minor && (');
  });

  it('EmployeeSidebar.tsx compares is_minor in its memo comparator', () => {
    const source = readSource('src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx');
    expect(source).toContain('prev.employee.is_minor === next.employee.is_minor &&');
  });

  it('EmployeeSidebar.tsx no longer imports isMinor', () => {
    const source = readSource('src/components/scheduling/ShiftPlanner/EmployeeSidebar.tsx');
    expect(source).not.toContain("import { isMinor } from '@/lib/employeeUtils';");
  });
});
