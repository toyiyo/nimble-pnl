import { describe, it, expect } from 'vitest';
import {
  getTools,
  canUseTool,
  requiredRoleFor,
} from '../../supabase/functions/_shared/tools-registry';

/**
 * Tests for AI chat tool registration + role gating.
 *
 * Two layers of defense are exercised here:
 *  1. `getTools()` — tool *visibility*. Tools the user can't call should not
 *     appear in the list sent to the model, so the model can't even attempt them.
 *  2. `canUseTool()` — dispatcher-level *enforcement*. Even if the model
 *     hallucinates a tool name, the dispatcher must reject it.
 *
 * The `requiredRoleFor()` helper powers the unified TOOL_PERMISSION_DENIED
 * response shape (see ai-execute-tool/index.ts).
 *
 * Scope: this file covers the edge-function tool registry only. UI capabilities
 * (`@/lib/permissions`) are exercised separately in `permissions.test.ts`.
 */

const ALL_ROLES = [
  'kiosk',
  'staff',
  'chef',
  'manager',
  'owner',
  'collaborator_accountant',
  'collaborator_inventory',
  'collaborator_chef',
  'collaborator_operations_manager',
] as const;

const MANAGER_OWNER = new Set(['manager', 'owner']);
const STAFF_AND_UP = new Set(['staff', 'chef', 'manager', 'owner']);

describe('tools-registry: get_time_punches gating', () => {
  describe('canUseTool', () => {
    it.each(ALL_ROLES)('rejects %s unless manager/owner', (role) => {
      const expected = MANAGER_OWNER.has(role);
      expect(canUseTool('get_time_punches', role)).toBe(expected);
    });
  });

  describe('getTools visibility', () => {
    it.each(ALL_ROLES)('only exposes get_time_punches to manager/owner for %s', (role) => {
      const tools = getTools('rest-1', role);
      const names = tools.map((t) => t.name);
      const expected = MANAGER_OWNER.has(role);
      expect(names.includes('get_time_punches')).toBe(expected);
    });

    it('exposes a well-formed tool definition for manager', () => {
      const tools = getTools('rest-1', 'manager');
      const def = tools.find((t) => t.name === 'get_time_punches');
      expect(def).toBeDefined();
      expect(def!.description.toLowerCase()).toContain('work period');
      expect(def!.parameters.required).toContain('period');

      const periodProp = def!.parameters.properties.period as {
        enum?: string[];
      };
      expect(periodProp.enum).toEqual(
        expect.arrayContaining(['today', 'yesterday', 'week', 'last_week', 'month', 'last_month', 'custom']),
      );
    });
  });

  describe('requiredRoleFor', () => {
    it('returns manager for get_time_punches', () => {
      expect(requiredRoleFor('get_time_punches')).toBe('manager');
    });

    it('returns staff for a basic tool like get_kpis', () => {
      expect(requiredRoleFor('get_kpis')).toBe('staff');
    });

    it('returns manager for other manager-tier tools', () => {
      expect(requiredRoleFor('get_payroll_summary')).toBe('manager');
      expect(requiredRoleFor('get_financial_intelligence')).toBe('manager');
    });

    it('returns owner for owner-only tools', () => {
      expect(requiredRoleFor('get_ai_insights')).toBe('owner');
    });
  });
});

describe('tools-registry: get_kpis is withheld from collaborator_operations_manager', () => {
  // get_kpis returns revenue, COGS, labor, prime cost, and margin/profitability
  // data — the same P&L surface collaborator_operations_manager is explicitly
  // excluded from (no view:financial_intelligence; kept off the root
  // dashboard). It remains a "staff+" basic tool for every other role.
  it('denies get_kpis for collaborator_operations_manager', () => {
    expect(canUseTool('get_kpis', 'collaborator_operations_manager')).toBe(false);
  });

  it.each(ALL_ROLES.filter((r) => r !== 'collaborator_operations_manager'))(
    'still allows get_kpis for %s (unaffected basic tool)',
    (role) => {
      expect(canUseTool('get_kpis', role)).toBe(true);
    },
  );

  it('omits get_kpis from the tool list for collaborator_operations_manager', () => {
    const tools = getTools('rest-1', 'collaborator_operations_manager');
    expect(tools.map((t) => t.name)).not.toContain('get_kpis');
  });

  it('still lists get_kpis for other roles, e.g. manager', () => {
    const tools = getTools('rest-1', 'manager');
    expect(tools.map((t) => t.name)).toContain('get_kpis');
  });
});

describe('tools-registry: get_labor_costs description signals per-employee fields', () => {
  it('mentions that include_employee_breakdown is manager+owner only', () => {
    const tools = getTools('rest-1', 'manager');
    const def = tools.find((t) => t.name === 'get_labor_costs');
    expect(def).toBeDefined();
    const desc = def!.description.toLowerCase();
    expect(desc).toContain('include_employee_breakdown');
    expect(desc).toContain('manager');
  });
});

describe('tools-registry: requiredRoleFor / canUseTool invariant', () => {
  // Whatever role requiredRoleFor returns, canUseTool MUST be true for that role
  // and false for the role one tier below it. This guards the dispatcher's
  // "what should I tell the user they need?" message against drifting from the
  // actual permission check.
  const tools = [
    'get_kpis',
    'get_inventory_status',
    'get_labor_costs',
    'get_time_punches',
    'get_payroll_summary',
    'get_financial_intelligence',
    'get_ai_insights',
  ];

  it.each(tools)('required role for %s satisfies canUseTool', (toolName) => {
    const required = requiredRoleFor(toolName);
    expect(canUseTool(toolName, required)).toBe(true);

    // Staff tools should still allow manager/owner.
    if (required === 'staff') {
      expect(STAFF_AND_UP.has('manager')).toBe(true);
      expect(canUseTool(toolName, 'manager')).toBe(true);
      expect(canUseTool(toolName, 'owner')).toBe(true);
    }

    // Manager tools should not be usable by staff/chef.
    if (required === 'manager') {
      expect(canUseTool(toolName, 'staff')).toBe(false);
      expect(canUseTool(toolName, 'chef')).toBe(false);
      expect(canUseTool(toolName, 'kiosk')).toBe(false);
      expect(canUseTool(toolName, 'collaborator_accountant')).toBe(false);
      expect(canUseTool(toolName, 'collaborator_inventory')).toBe(false);
      expect(canUseTool(toolName, 'collaborator_chef')).toBe(false);
    }

    // Owner tools should not be usable by manager.
    if (required === 'owner') {
      expect(canUseTool(toolName, 'manager')).toBe(false);
    }
  });
});
