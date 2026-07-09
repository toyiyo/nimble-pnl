/**
 * Task 1: collaborator_operations_manager Role Core (TS permission layer)
 *
 * Verifies that 'collaborator_operations_manager' is a recognised member of
 * the Role union and that ROLE_CAPABILITIES / ROLE_METADATA / COLLABORATOR_PRESETS
 * match the approved design
 * (docs/superpowers/specs/2026-07-09-ops-manager-collaborator-design.md):
 * mirrors internal operations_manager minus team/manage-employees/edit-payroll,
 * with view:payroll and view:employees kept as read-only.
 */
import { describe, it, expect } from 'vitest';
import {
  ROLE_CAPABILITIES,
  ROLE_METADATA,
  COLLABORATOR_PRESETS,
  isCollaboratorRole,
  getCollaboratorRoles,
} from '@/lib/permissions/definitions';
import type { Role, Capability } from '@/lib/permissions/types';

// Compile-time check: assigning the literal to Role must not be a type error.
// If Role does not include 'collaborator_operations_manager' this line errors.
const _typeCheck: Role = 'collaborator_operations_manager';
void _typeCheck;

const GRANTED: Capability[] = [
  'view:dashboard',
  'view:ai_assistant',
  'view:inventory',
  'edit:inventory',
  'view:inventory_audit',
  'edit:inventory_audit',
  'view:purchase_orders',
  'edit:purchase_orders',
  'view:receipt_import',
  'edit:receipt_import',
  'view:reports',
  'view:inventory_transactions',
  'edit:inventory_transactions',
  'view:recipes',
  'edit:recipes',
  'view:prep_recipes',
  'edit:prep_recipes',
  'view:batches',
  'edit:batches',
  'view:pos_sales',
  'view:scheduling',
  'edit:scheduling',
  'view:time_punches',
  'edit:time_punches',
  'view:tips',
  'edit:tips',
  'view:payroll',
  'view:employees',
  'view:settings',
];

const DENIED: Capability[] = [
  'view:team',
  'manage:team',
  'manage:employees',
  'edit:payroll',
  'edit:settings',
  'view:integrations',
  'manage:integrations',
  'view:collaborators',
  'manage:collaborators',
  'view:transactions',
  'edit:transactions',
  'view:banking',
  'edit:banking',
  'view:expenses',
  'edit:expenses',
  'view:financial_statements',
  'view:chart_of_accounts',
  'edit:chart_of_accounts',
  'view:invoices',
  'edit:invoices',
  'view:customers',
  'edit:customers',
  'view:pending_outflows',
  'edit:pending_outflows',
  'view:financial_intelligence',
];

describe('Role union — collaborator_operations_manager', () => {
  it("'collaborator_operations_manager' is a key in ROLE_CAPABILITIES", () => {
    expect(ROLE_CAPABILITIES).toHaveProperty('collaborator_operations_manager');
  });

  it("'collaborator_operations_manager' is a key in ROLE_METADATA", () => {
    expect(ROLE_METADATA).toHaveProperty('collaborator_operations_manager');
  });
});

describe('collaborator_operations_manager capabilities', () => {
  const caps = new Set(ROLE_CAPABILITIES['collaborator_operations_manager']);

  it('includes every capability in the approved granted set', () => {
    for (const c of GRANTED) expect(caps.has(c), `missing ${c}`).toBe(true);
  });

  it('excludes every capability in the approved denied set', () => {
    for (const c of DENIED) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('has exactly the granted set (no extras)', () => {
    expect(caps.size).toBe(GRANTED.length);
  });
});

describe('collaborator_operations_manager metadata', () => {
  const meta = ROLE_METADATA['collaborator_operations_manager'];

  it('has label "Operations Manager"', () => {
    expect(meta.label).toBe('Operations Manager');
  });

  it('is categorised as collaborator', () => {
    expect(meta.category).toBe('collaborator');
  });

  it('lands on /scheduling', () => {
    expect(meta.landingPath).toBe('/scheduling');
  });

  it('uses the outline color like other collaborator roles', () => {
    expect(meta.color).toBe('outline');
  });
});

describe('collaborator_operations_manager isolation helpers', () => {
  it('isCollaboratorRole returns true', () => {
    expect(isCollaboratorRole('collaborator_operations_manager')).toBe(true);
  });

  it('getCollaboratorRoles includes it', () => {
    expect(getCollaboratorRoles()).toContain('collaborator_operations_manager');
  });
});

describe('COLLABORATOR_PRESETS', () => {
  it('has 4 entries', () => {
    expect(COLLABORATOR_PRESETS).toHaveLength(4);
  });

  it('includes an Operations Manager preset with non-empty features', () => {
    const preset = COLLABORATOR_PRESETS.find(
      (p) => p.role === 'collaborator_operations_manager'
    );
    expect(preset).toBeDefined();
    expect(preset!.title).toBe('Operations Manager');
    expect(preset!.features.length).toBeGreaterThan(0);
  });
});
