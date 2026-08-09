import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EMPLOYEE_EMBED_COLUMNS } from '@/lib/employeeMaskedFields';

// Task 4 Step 4: a PostgREST resource embed resolves against the base
// table, not the view. `employees(*)` asks for eight revoked columns
// and fails with `permission denied for column hourly_rate`. Each
// embed must list only the columns its consumer reads.
//
// All three sites share one column list, EMPLOYEE_EMBED_COLUMNS, so this
// file pins that constant once and checks each site references it.

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

describe('employee resource embeds are narrowed to granted columns', () => {
  it('EMPLOYEE_EMBED_COLUMNS lists only the columns these three hooks read', () => {
    expect(EMPLOYEE_EMBED_COLUMNS).toBe(
      'id, name, position, area, status, is_active, employment_type, user_id'
    );
  });

  it('useShifts.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useShifts.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useShifts.tsx embeds the shared column list', () => {
    const source = readSource('src/hooks/useShifts.tsx');
    expect(source).toContain('employee:employees(${EMPLOYEE_EMBED_COLUMNS})');
  });

  it('useTimeOffRequests.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useTimeOffRequests.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useTimeOffRequests.tsx embeds the shared column list', () => {
    const source = readSource('src/hooks/useTimeOffRequests.tsx');
    expect(source).toContain('employee:employees(${EMPLOYEE_EMBED_COLUMNS})');
  });

  it('useScheduleChangeLogs.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useScheduleChangeLogs.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useScheduleChangeLogs.tsx embeds the shared column list', () => {
    const source = readSource('src/hooks/useScheduleChangeLogs.tsx');
    expect(source).toContain('employee:employees(${EMPLOYEE_EMBED_COLUMNS})');
  });
});
