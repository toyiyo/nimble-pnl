import { describe, it, expect, vi } from 'vitest';
import {
  getTools,
  canUseTool,
  requiredRoleFor,
  CAPABILITY_GATED_TOOLS,
  canUseCapabilityGatedTool,
  hasSchedulingOrPayrollCapability,
  hasPayRatesCapability,
  missingRequiredArgs,
  nonBooleanFlagArgs,
  type CapabilityCheckClient,
} from '../../supabase/functions/_shared/tools-registry';
import { PAY_HIDDEN_TOOL_HINT } from '../../supabase/functions/_shared/payHidden';

type RpcResult = { data: boolean | null; error: unknown };

/**
 * Copy of the supabase-js PostgREST builder shape: it has then() and no
 * catch() or finally(). A mock that returns a real Promise hides a .catch()
 * call on the builder (lesson 2026-07-29).
 */
function thenable(result: RpcResult | Error): PromiseLike<RpcResult> {
  const settled = result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  return { then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected) };
}

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

describe('tools-registry: get_operating_costs description labels the data as a budget', () => {
  it('opens with a warning that the data is the configured budget, not actual spend', () => {
    const tools = getTools('rest-1', 'manager');
    const def = tools.find((t) => t.name === 'get_operating_costs');
    expect(def).toBeDefined();
    expect(def!.description).toContain('CONFIGURED cost budget');
  });
});

describe('tools-registry: requiredRoleFor / canUseTool invariant', () => {
  // Whatever role requiredRoleFor returns, canUseTool MUST be true for that role
  // and false for the role one tier below it. This guards the dispatcher's
  // "what should I tell the user they need?" message against drifting from the
  // actual permission check.
  // get_labor_costs / get_schedule_overview are excluded here: they are no
  // longer role-gated (see the capability-gating describe block below), so
  // the "required role" concept does not apply to them.
  const tools = [
    'get_kpis',
    'get_inventory_status',
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

describe('tools-registry: get_labor_costs / get_schedule_overview are capability-gated, not role-gated', () => {
  // These two tools expose restaurant-wide labor/schedule data. The RLS
  // behind the tables they read is `own-row OR view:scheduling OR
  // view:payroll` (see the self-scoped-employee-data migration), so the
  // dispatcher must gate the tools on the same capability rather than a
  // second hard-coded role list that could drift from RLS.
  it('lists exactly get_labor_costs and get_schedule_overview as capability-gated', () => {
    expect([...CAPABILITY_GATED_TOOLS].sort()).toEqual(
      ['get_labor_costs', 'get_schedule_overview'].sort(),
    );
  });

  it.each(CAPABILITY_GATED_TOOLS)(
    'canUseTool never grants %s by role alone (enforcement moved to canUseCapabilityGatedTool)',
    (toolName) => {
      for (const role of ALL_ROLES) {
        expect(canUseTool(toolName, role)).toBe(false);
      }
    },
  );

  // Deliberately a minimal `{ rpc }` shape, not a full Supabase client — the
  // functions under test only ever call `.rpc(...)`. Typed directly against
  // `CapabilityCheckClient` (the real parameter type) so no cast is needed
  // at any call site below.
  function mockSupabase(responses: Record<string, boolean | null>): CapabilityCheckClient {
    return {
      rpc: vi.fn((_fn: string, args: { p_restaurant_id: string; p_capability: string }) =>
        thenable({ data: responses[args.p_capability] ?? false, error: null }),
      ),
    };
  }

  it('grants access when the caller has view:scheduling', async () => {
    const supabase = mockSupabase({ 'view:scheduling': true, 'view:payroll': false });
    const result = await canUseCapabilityGatedTool('get_labor_costs', 'rest-1', supabase);
    expect(result).toBe(true);
  });

  it('grants access when the caller has view:payroll', async () => {
    const supabase = mockSupabase({ 'view:scheduling': false, 'view:payroll': true });
    const result = await canUseCapabilityGatedTool('get_schedule_overview', 'rest-1', supabase);
    expect(result).toBe(true);
  });

  it('denies access when the caller has neither capability', async () => {
    const supabase = mockSupabase({ 'view:scheduling': false, 'view:payroll': false });
    const result = await canUseCapabilityGatedTool('get_labor_costs', 'rest-1', supabase);
    expect(result).toBe(false);
  });

  it('denies access for a tool that is not capability-gated', async () => {
    const supabase = mockSupabase({ 'view:scheduling': true, 'view:payroll': true });
    const result = await canUseCapabilityGatedTool('get_kpis', 'rest-1', supabase);
    expect(result).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // hasSchedulingOrPayrollCapability is the underlying OR-check, reused by
  // get_kpis's labor-component gate (get_kpis itself stays a basic tool; it
  // just must not compute prime cost from an RLS-truncated labor set).
  it('hasSchedulingOrPayrollCapability: true when only scheduling is granted', async () => {
    const supabase = mockSupabase({ 'view:scheduling': true, 'view:payroll': false });
    expect(await hasSchedulingOrPayrollCapability('rest-1', supabase)).toBe(true);
  });

  it('hasSchedulingOrPayrollCapability: false when neither is granted', async () => {
    const supabase = mockSupabase({ 'view:scheduling': false, 'view:payroll': false });
    expect(await hasSchedulingOrPayrollCapability('rest-1', supabase)).toBe(false);
  });

  it('hasSchedulingOrPayrollCapability: fails closed AND logs when an RPC errors, instead of silently reporting a plain denial', async () => {
    const rpcError = new Error('connection reset');
    const supabase: CapabilityCheckClient = {
      rpc: vi.fn((_fn: string, args: { p_restaurant_id: string; p_capability: string }) =>
        args.p_capability === 'view:scheduling'
          ? thenable({ data: null, error: rpcError })
          : thenable({ data: false, error: null }),
      ),
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await hasSchedulingOrPayrollCapability('rest-1', supabase);

      // Fail closed: an infra error must not grant access.
      expect(result).toBe(false);
      // But the real cause must be logged, not swallowed — otherwise an infra
      // failure is indistinguishable from a legitimate permission denial.
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:scheduling'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('hasSchedulingOrPayrollCapability: fails closed AND logs when an RPC promise rejects (not just resolves with an error field)', async () => {
    const rpcError = new Error('network unreachable');
    const supabase: CapabilityCheckClient = {
      rpc: vi.fn((_fn: string, args: { p_restaurant_id: string; p_capability: string }) =>
        args.p_capability === 'view:scheduling'
          ? thenable(rpcError)
          : thenable({ data: false, error: null }),
      ),
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // A rejected RPC promise must not escape as an unhandled rejection —
      // it has to land in the same fail-closed/logged path as a resolved
      // `{ data: null, error }` response.
      const result = await hasSchedulingOrPayrollCapability('rest-1', supabase);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:scheduling'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('hasSchedulingOrPayrollCapability: fails closed AND logs when rpc() throws synchronously', async () => {
    const rpcError = new Error('client not ready');
    const supabase: CapabilityCheckClient = {
      rpc: vi.fn(() => {
        throw rpcError;
      }),
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await hasSchedulingOrPayrollCapability('rest-1', supabase)).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:scheduling'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('tools-registry: hasPayRatesCapability', () => {
  // employees_secure returns NULL pay unless the caller holds view:pay_rates.
  // The builtin Chef role holds view:scheduling but not view:pay_rates, so the
  // labor tools must know when a $0 cost is a masked value.
  function rpcReturning(result: { data: boolean | null; error: unknown } | Error) {
    return vi.fn((_fn: string, _args: { p_restaurant_id: string; p_capability: string }) =>
      thenable(result),
    );
  }

  it('asks user_has_capability for view:pay_rates', async () => {
    const rpc = rpcReturning({ data: true, error: null });
    await hasPayRatesCapability('rest-1', { rpc });
    expect(rpc).toHaveBeenCalledWith('user_has_capability', {
      p_restaurant_id: 'rest-1',
      p_capability: 'view:pay_rates',
    });
  });

  it('returns true when the RPC grants the flag', async () => {
    expect(await hasPayRatesCapability('rest-1', { rpc: rpcReturning({ data: true, error: null }) })).toBe(true);
  });

  it('returns false when the RPC denies the flag', async () => {
    expect(await hasPayRatesCapability('rest-1', { rpc: rpcReturning({ data: false, error: null }) })).toBe(false);
  });

  it('fails closed and logs when the RPC returns an error', async () => {
    const rpcError = new Error('connection reset');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await hasPayRatesCapability('rest-1', { rpc: rpcReturning({ data: null, error: rpcError }) });
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:pay_rates'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails closed and logs when the RPC promise rejects', async () => {
    const rpcError = new Error('network unreachable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await hasPayRatesCapability('rest-1', { rpc: rpcReturning(rpcError) });
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:pay_rates'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails closed and logs when rpc() throws synchronously', async () => {
    const rpcError = new Error('client not ready');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rpc = vi.fn(() => {
        throw rpcError;
      });
      expect(await hasPayRatesCapability('rest-1', { rpc })).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('view:pay_rates'),
        expect.objectContaining({ restaurantId: 'rest-1', error: rpcError }),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('tools-registry: labor tool descriptions explain pay_hidden', () => {
  // Without view:pay_rates the labor tools return null costs plus a
  // pay_hidden reason. The model must tell the user, not report $0.
  it.each(['get_kpis', 'get_labor_costs', 'get_schedule_overview', 'get_time_punches', 'get_payroll_summary'])(
    '%s tells the model what pay_hidden means',
    (name) => {
      const def = getTools('rest-1', 'owner').find((t) => t.name === name);
      expect(def).toBeDefined();
      expect(def!.description).toContain(PAY_HIDDEN_TOOL_HINT);
    },
  );
});

describe('tools-registry: getTools follows the scheduling/payroll capability (D9)', () => {
  // Without view:scheduling or view:payroll the dispatcher denies these two
  // tools. When the list has them, the model calls a tool that returns 403.
  it('omits the capability-gated tools when hasSchedulingOrPayroll is false', () => {
    const names = getTools('rest-1', 'staff', { hasSchedulingOrPayroll: false }).map((t) => t.name);
    for (const gated of CAPABILITY_GATED_TOOLS) {
      expect(names).not.toContain(gated);
    }
    expect(names).toContain('get_sales_summary');
  });

  it('keeps them when hasSchedulingOrPayroll is true', () => {
    const names = getTools('rest-1', 'chef', { hasSchedulingOrPayroll: true }).map((t) => t.name);
    for (const gated of CAPABILITY_GATED_TOOLS) {
      expect(names).toContain(gated);
    }
  });

  it('keeps today\'s list when the option is not given', () => {
    expect(getTools('rest-1', 'staff').map((t) => t.name)).toEqual(
      getTools('rest-1', 'staff', {}).map((t) => t.name),
    );
    expect(getTools('rest-1', 'staff').map((t) => t.name)).toEqual(
      expect.arrayContaining([...CAPABILITY_GATED_TOOLS]),
    );
  });

  it('still hides get_kpis from collaborator_operations_manager with the option set', () => {
    const names = getTools('rest-1', 'collaborator_operations_manager', { hasSchedulingOrPayroll: true }).map(
      (t) => t.name,
    );
    expect(names).not.toContain('get_kpis');
  });
});

describe('tools-registry: missingRequiredArgs (D10)', () => {
  it('lists the missing required fields', () => {
    expect(missingRequiredArgs('get_bank_transactions', {})).toEqual(['start_date', 'end_date']);
    expect(missingRequiredArgs('get_bank_transactions', { start_date: '2026-09-01' })).toEqual(['end_date']);
  });

  it('returns [] for a complete call', () => {
    expect(missingRequiredArgs('get_bank_transactions', { start_date: '2026-09-01', end_date: '2026-09-30' })).toEqual([]);
  });

  it('treats null, undefined and empty string as missing', () => {
    expect(missingRequiredArgs('navigate', { section: null })).toEqual(['section']);
    expect(missingRequiredArgs('navigate', { section: undefined })).toEqual(['section']);
    expect(missingRequiredArgs('navigate', { section: '' })).toEqual(['section']);
  });

  it('treats a whitespace-only string and an empty array as missing', () => {
    expect(missingRequiredArgs('get_bank_transactions', { start_date: '  ', end_date: '2026-09-30' })).toEqual([
      'start_date',
    ]);
    expect(missingRequiredArgs('batch_categorize_transactions', { transaction_ids: [], category_id: 'c1' })).toEqual([
      'transaction_ids',
    ]);
  });

  it('reports every required field when args is not a plain object', () => {
    // ai-chat-stream forwards the raw string when the model sends bad JSON.
    for (const args of ['{"start_date": 2026', null, undefined, 42, ['start_date']]) {
      expect(missingRequiredArgs('get_bank_transactions', args)).toEqual(['start_date', 'end_date']);
    }
  });

  it('returns [] for a tool with no required fields and for an unknown tool', () => {
    expect(missingRequiredArgs('get_inventory_status', undefined)).toEqual([]);
    expect(missingRequiredArgs('no_such_tool', {})).toEqual([]);
  });

  it('checks the full registry, not a role-filtered list', () => {
    // get_kpis is hidden from collaborator_operations_manager, but the check
    // still knows its schema.
    expect(missingRequiredArgs('create_categorization_rule', {})).toEqual([
      'rule_name', 'pattern_type', 'pattern_value', 'category_id',
    ]);
  });

  // Every handler with a period falls back to a default window
  // (calculateDateRange: last 7 days; get_kpis and get_sales_summary: month).
  // A call without period worked before this check, so it must still work.
  const periodTools = getTools('rest-1', 'owner')
    .filter((t) => t.parameters.required?.includes('period'))
    .map((t) => t.name);

  it('finds the period tools', () => {
    expect(periodTools).toEqual(expect.arrayContaining(['get_kpis', 'get_sales_summary', 'get_labor_costs', 'get_expense_health']));
  });

  it.each(periodTools)('%s does not reject a call without period', (name) => {
    expect(missingRequiredArgs(name, {})).toEqual([]);
  });

  it('still rejects the calls that gave garbage before (navigate, get_financial_intelligence)', () => {
    expect(missingRequiredArgs('navigate', {})).toEqual(['section']);
    expect(missingRequiredArgs('get_financial_intelligence', {})).toEqual(['analysis_type', 'start_date', 'end_date']);
  });

  it.each(['get_kpis', 'get_sales_summary'])('%s still tells the model that period is required', (name) => {
    const def = getTools('rest-1', 'owner').find((t) => t.name === name);
    expect(def?.parameters.required).toEqual(['period']);
  });
});

describe('tools-registry: every dispatcher case has a registry entry', () => {
  it('matches the switch in ai-execute-tool', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/ai-execute-tool/index.ts'), 'utf8');
    const switchBody = src.slice(src.indexOf('switch (tool_name) {'));
    const cases = [...switchBody.matchAll(/^\s+case '([a-z_]+)':/gm)].map((m) => m[1]);
    const registered = getTools('rest-1', 'owner').map((t) => t.name);
    expect(cases.length).toBeGreaterThan(20);
    expect([...cases].sort()).toEqual([...registered].sort());
  });
});

describe('tools-registry: nonBooleanFlagArgs', () => {
  // The write handlers read preview and confirmed. A string "true" or a 1
  // must not count as a confirm, so these flags must be real booleans.
  it('accepts true, false and absent flags', () => {
    expect(nonBooleanFlagArgs({ preview: true })).toEqual([]);
    expect(nonBooleanFlagArgs({ confirmed: false })).toEqual([]);
    expect(nonBooleanFlagArgs({})).toEqual([]);
    expect(nonBooleanFlagArgs('not an object')).toEqual([]);
  });

  it.each([['true'], [1], ['yes'], [null]])('rejects confirmed = %j', (value) => {
    expect(nonBooleanFlagArgs({ confirmed: value })).toEqual(['confirmed']);
  });

  it('rejects a non-boolean preview', () => {
    expect(nonBooleanFlagArgs({ preview: 'true', confirmed: true })).toEqual(['preview']);
  });
});
