import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Task 4 Step 3: four hooks read employee rows directly from the base
// `employees` table. That table now hides pay and PII columns from a
// caller without the matching flag (Task 3), but a plain SELECT still
// returns NULL for those columns rather than routing through the
// masking view. Point each read at `employees_secure` so the mask
// applies uniformly. Mutations (insert/update/delete) stay on the base
// table — the view is not writable.

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

describe('direct employees readers use employees_secure', () => {
  it('useEmployees.tsx reads the list query from employees_secure', () => {
    const source = readSource('src/hooks/useEmployees.tsx');
    expect(source).toContain("let query = supabase\n        .from('employees_secure')");
  });

  it('useEmployees.tsx still writes create/update/delete to the base table', () => {
    const source = readSource('src/hooks/useEmployees.tsx');
    const fromCalls = [...source.matchAll(/\.from\('(employees|employees_secure)'\)/g)].map(
      (m) => m[1]
    );
    // One read (employees_secure) plus three writes (employees): insert, update, delete.
    expect(fromCalls.filter((t) => t === 'employees_secure')).toHaveLength(1);
    expect(fromCalls.filter((t) => t === 'employees')).toHaveLength(3);
  });

  it('useCurrentEmployee.tsx reads from employees_secure', () => {
    const source = readSource('src/hooks/useCurrentEmployee.tsx');
    expect(source).toContain("const { data, error } = await supabase\n        .from('employees_secure')");
  });

  it('useMonthlyMetrics.tsx reads the labor employees query from employees_secure', () => {
    const source = readSource('src/hooks/useMonthlyMetrics.tsx');
    // The employees fetch runs inside a Promise.all as a named promise.
    expect(source).toContain(
      "const employeesPromise = supabase\n        .from('employees_secure')"
    );
    // Guard: the hook must not read the base employees table anywhere.
    expect(source).not.toContain(".from('employees')");
  });

  it('useTimePunches.tsx reads the employees join from employees_secure', () => {
    const source = readSource('src/hooks/useTimePunches.tsx');
    expect(source).toContain("const { data, error } = await supabase\n        .from('employees_secure')");
  });
});

// A read that names a masked column on the base table does not return NULL.
// It fails with "permission denied for table employees", because
// 20260806110000 revokes SELECT on those eight columns from `authenticated`.
// Each reader below names at least one of them, so each one breaks its page
// for every user until it moves to the view.
const MASKED_COLUMNS = [
  'hourly_rate',
  'salary_amount',
  'contractor_payment_amount',
  'daily_rate_amount',
  'daily_rate_reference_weekly',
  'email',
  'phone',
  'date_of_birth',
];

/** Every column list of a `.select(...)` that reads the base `employees` table. */
const baseTableSelects = (source: string): string[] =>
  [...source.matchAll(/\.from\('employees'\)\s*\n\s*\.select\(\s*'([^']*)'/g)].map((m) => m[1]);

describe('no base-table read names a masked column', () => {
  it.each([
    ['src/components/financial-statements/IncomeStatement.tsx'],
    ['src/hooks/useSlingEmployeeMapping.ts'],
    ['src/hooks/useAccountlessEmployees.ts'],
  ])('%s selects no masked column from employees', (path) => {
    const selected = baseTableSelects(readSource(path)).join(',');
    const named = MASKED_COLUMNS.filter((column) =>
      new RegExp(`\\b${column}\\b`).test(selected)
    );
    expect(named).toEqual([]);
  });
});

// A PostgREST embed reads the base `employees` table too, even though the
// syntax differs from a plain .from('employees').select(...). The shift-trade
// hooks embed the offerer and the claimant with `employees!<fk>(...)`. An
// embed that names a masked column breaks the same way — "permission denied
// for table employees" for every caller — but the base-table scan above does
// not see it. Scan the embed column lists as well.
const employeeEmbedColumnLists = (source: string): string[] =>
  [...source.matchAll(/employees![a-z_]+\(([^)]*)\)/g)].map((m) => m[1]);

describe('no employees embed names a masked column', () => {
  it.each([
    ['src/hooks/useShiftTrades.ts'],
    ['src/hooks/useEmployeeTips.tsx'],
    ['src/hooks/useTemplateLinkedShifts.ts'],
  ])('CRITICAL: %s embeds no masked column from employees', (path) => {
    // The guard must scan at least one embed. An empty match list would let
    // the masked-column check pass without reading anything, so a renamed hook
    // or a changed embed syntax would silently disarm the guard.
    const embeddedColumns = employeeEmbedColumnLists(readSource(path));
    expect(embeddedColumns).not.toHaveLength(0);
    const embedded = embeddedColumns.join(',');
    const named = MASKED_COLUMNS.filter((column) =>
      new RegExp(`\\b${column}\\b`).test(embedded)
    );
    expect(named).toEqual([]);
  });
});
