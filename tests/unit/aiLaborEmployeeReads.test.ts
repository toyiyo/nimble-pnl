import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EMPLOYEE_LABOR_SOURCE } from '../../supabase/functions/_shared/employeeLaborColumns.ts';

/**
 * Source-contract guards for the employee reads of the AI labor tools and
 * the AI schedule generator.
 *
 * 20260806110000_employee_column_gating.sql revokes SELECT on these columns
 * of public.employees from authenticated. Both edge functions run as the
 * caller (anon key + the caller's JWT), so a read or an embed that names one
 * of them fails with "permission denied for column hourly_rate". The edge
 * entry files use Deno https imports, so Vitest reads the source.
 */

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const REVOKED_EMPLOYEE_COLUMNS = [
  'hourly_rate',
  'salary_amount',
  'contractor_payment_amount',
  'daily_rate_amount',
  'daily_rate_reference_weekly',
  'email',
  'phone',
  'date_of_birth',
];

const SOURCES = {
  'ai-execute-tool': read('supabase/functions/ai-execute-tool/index.ts'),
  'generate-schedule': read('supabase/functions/generate-schedule/index.ts'),
};

/** The body of `async function <name>(` up to the next top-level function. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const next = source.slice(start + 1).search(/\n(?:async )?function |\nserve\(|\nDeno\.serve\(/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe.each(Object.entries(SOURCES))('%s employee reads', (_name, source) => {
  it('does not read the employees base table', () => {
    expect(source).not.toMatch(/\.from\(\s*['"]employees['"]\s*\)/);
  });

  it('does not embed employees(*)', () => {
    expect(source).not.toMatch(/employees\(\s*\*\s*\)/);
  });

  it('does not embed a revoked employees column', () => {
    const embeds = source.match(/employees\([^)]*\)/g) ?? [];
    for (const embed of embeds) {
      for (const column of REVOKED_EMPLOYEE_COLUMNS) {
        expect(embed, `${embed} names ${column}`).not.toMatch(new RegExp(`\\b${column}\\b`));
      }
    }
  });
});

describe('ai-execute-tool labor reads', () => {
  const source = SOURCES['ai-execute-tool'];

  it('reads employees through fetchLaborEmployees and EMPLOYEE_LABOR_SOURCE', () => {
    const helper = functionBody(source, 'fetchLaborEmployees');
    expect(helper).toMatch(/\.from\(EMPLOYEE_LABOR_SOURCE\)/);
    expect(helper).toMatch(/\.select\(EMPLOYEE_LABOR_COLUMNS\)/);
  });

  it.each([
    'executeGetKpis',
    'executeGetLaborCosts',
    'executeGetTimePunches',
    'executeGetScheduleOverview',
    'executeGetPayrollSummary',
  ])('%s checks view:pay_rates', (name) => {
    expect(functionBody(source, name)).toMatch(/hasPayRatesCapability\(/);
  });
});

describe('generate-schedule employee read', () => {
  const source = SOURCES['generate-schedule'];

  it('reads the employees_secure view (EMPLOYEE_LABOR_SOURCE) with is_minor', () => {
    expect(EMPLOYEE_LABOR_SOURCE).toBe('employees_secure');
    expect(source).toMatch(/\.from\(EMPLOYEE_LABOR_SOURCE\)/);
    expect(source).toMatch(/\.select\("[^"]*\bis_minor\b[^"]*"\)/);
  });
});
