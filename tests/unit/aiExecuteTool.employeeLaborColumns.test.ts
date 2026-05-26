import { describe, expect, it } from 'vitest';

import { EMPLOYEE_LABOR_COLUMNS } from '../../supabase/functions/_shared/aiExecuteToolColumns.ts';

/**
 * Regression contract for the projection used by `ai-execute-tool`'s
 * `fetchLaborData` against the `employees` table. The projection is sent
 * verbatim to PostgREST; any token that isn't a real column on `employees`
 * (or a valid embed-alias) causes "column does not exist" → 500 → the AI
 * chat returns TOOL_ERROR.
 *
 * The historical bug: `compensation_history` was listed as a bare column,
 * but it's actually a separate table joined by FK. The projection must use
 * PostgREST's embedded-resource alias syntax instead.
 */
describe('EMPLOYEE_LABOR_COLUMNS', () => {
  const tokens = EMPLOYEE_LABOR_COLUMNS.split(',').map((t) => t.trim());

  it('uses the embed-alias syntax for compensation_history', () => {
    expect(EMPLOYEE_LABOR_COLUMNS).toContain('compensation_history:employee_compensation_history(*)');
  });

  it('does NOT reference compensation_history as a bare column', () => {
    // Match `compensation_history` only when it's followed by a comma or end
    // of string — i.e. not part of the embed alias `compensation_history:...`.
    const bareColumnRegex = /(?:^|,\s*)compensation_history\s*(?:,|$)/;
    expect(EMPLOYEE_LABOR_COLUMNS).not.toMatch(bareColumnRegex);
  });

  it('lists only base columns that exist on the employees table', () => {
    const baseColumns = tokens.map((token) => token.split(':')[0].trim());
    const expected = [
      'id',
      'name',
      'position',
      'status',
      'restaurant_id',
      'compensation_type',
      'hourly_rate',
      'salary_amount',
      'pay_period_type',
      'contractor_payment_amount',
      'contractor_payment_interval',
      'daily_rate_amount',
      'hire_date',
      'termination_date',
      'compensation_history',
    ];
    expect(baseColumns).toEqual(expected);
  });
});
