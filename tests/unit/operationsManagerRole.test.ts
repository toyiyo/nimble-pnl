import { describe, it, expect } from 'vitest';
import { ROLE_CAPABILITIES, ROLE_METADATA } from '@/lib/permissions/definitions';
import type { Capability } from '@/lib/permissions/types';

const ACCOUNTING: Capability[] = [
  'view:transactions', 'edit:transactions', 'view:banking', 'edit:banking',
  'view:expenses', 'edit:expenses', 'view:financial_statements',
  'view:chart_of_accounts', 'edit:chart_of_accounts', 'view:invoices',
  'edit:invoices', 'view:customers', 'edit:customers',
  'view:financial_intelligence', 'view:pending_outflows', 'edit:pending_outflows',
];

const EXCLUDED_ADMIN: Capability[] = [
  'view:integrations', 'manage:integrations', 'edit:settings',
  'view:collaborators', 'manage:collaborators',
];

const REQUIRED: Capability[] = [
  'view:dashboard', 'view:inventory', 'edit:inventory', 'edit:recipes',
  'view:pos_sales', 'view:scheduling', 'edit:scheduling', 'view:payroll',
  'edit:payroll', 'view:tips', 'edit:tips', 'view:time_punches',
  'edit:time_punches', 'view:team', 'manage:team', 'view:employees',
  'manage:employees', 'view:settings', 'view:reports', 'edit:receipt_import',
];

describe('operations_manager capabilities', () => {
  const caps = new Set(ROLE_CAPABILITIES['operations_manager']);

  it('includes every required operational/labor capability', () => {
    for (const c of REQUIRED) expect(caps.has(c), `missing ${c}`).toBe(true);
  });

  it('excludes every accounting capability', () => {
    for (const c of ACCOUNTING) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('excludes admin capabilities beyond team/employee management', () => {
    for (const c of EXCLUDED_ADMIN) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('has internal metadata with the Operations Manager label', () => {
    expect(ROLE_METADATA['operations_manager'].label).toBe('Operations Manager');
    expect(ROLE_METADATA['operations_manager'].category).toBe('internal');
    expect(ROLE_METADATA['operations_manager'].landingPath).toBe('/');
  });
});
