import { describe, expect, it } from 'vitest';

import { EMPLOYEE_LABOR_COLUMNS } from '../../supabase/functions/_shared/employeeLaborColumns.ts';

describe('EMPLOYEE_LABOR_COLUMNS', () => {
  it('uses the embed-alias syntax for compensation_history', () => {
    expect(EMPLOYEE_LABOR_COLUMNS).toMatch(/compensation_history:employee_compensation_history\(/);
  });

  it('does NOT reference compensation_history as a bare column', () => {
    const bareColumnRegex = /(?:^|,\s*)compensation_history\s*(?:,|$)/;
    expect(EMPLOYEE_LABOR_COLUMNS).not.toMatch(bareColumnRegex);
  });

  it('embeds only the compensation_history columns consumed by laborCalculations', () => {
    const match = EMPLOYEE_LABOR_COLUMNS.match(
      /compensation_history:employee_compensation_history\(([^)]+)\)/,
    );
    expect(match).not.toBeNull();
    const embedded = match![1].split(',').map((c) => c.trim()).sort();
    expect(embedded).toEqual([
      'amount_cents',
      'compensation_type',
      'effective_date',
      'pay_period_type',
    ]);
  });

  it('lists only base columns that exist on the employees table', () => {
    // Split on commas that aren't inside the embed's parens.
    const topLevelTokens = EMPLOYEE_LABOR_COLUMNS.split(/,(?![^()]*\))/).map((t) => t.trim());
    const baseColumns = topLevelTokens.map((token) => token.split(':')[0].trim());
    expect(baseColumns).toEqual([
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
    ]);
  });
});
