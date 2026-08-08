import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Task 4 Step 4: a PostgREST resource embed resolves against the base
// table, not the view. `employees(*)` asks for eight revoked columns
// and fails with `permission denied for column hourly_rate`. Each
// embed must list only the columns its consumer reads.

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

const NARROW_EMBED =
  'employee:employees(id, name, position, area, status, is_active, employment_type, user_id)';

describe('employee resource embeds are narrowed to granted columns', () => {
  it('useShifts.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useShifts.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useShifts.tsx embeds the explicit column list', () => {
    const source = readSource('src/hooks/useShifts.tsx');
    expect(source).toContain(`.select('*, ${NARROW_EMBED}')`);
  });

  it('useTimeOffRequests.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useTimeOffRequests.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useTimeOffRequests.tsx embeds the explicit column list', () => {
    const source = readSource('src/hooks/useTimeOffRequests.tsx');
    expect(source).toContain(`          ${NARROW_EMBED}`);
  });

  it('useScheduleChangeLogs.tsx no longer embeds employees(*)', () => {
    const source = readSource('src/hooks/useScheduleChangeLogs.tsx');
    expect(source).not.toContain('employee:employees(*)');
  });

  it('useScheduleChangeLogs.tsx embeds the explicit column list', () => {
    const source = readSource('src/hooks/useScheduleChangeLogs.tsx');
    expect(source).toContain(`.select('*, ${NARROW_EMBED}')`);
  });
});
