/**
 * useRoles — data-driven roles built from areas (Phase 4, task 8d)
 *
 * RED test for `src/hooks/useRoles.ts`, which does not exist yet. Contract
 * from docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md:
 *
 *   "src/hooks/useRoles.ts (new) — list/create/update/delete/copy, React
 *    Query, key ['roles', restaurantId], mutations invalidating both that
 *    key and ['restaurants'] (a role edit changes the current user's own
 *    capabilities)."
 *
 * Two things the plan states in prose are asserted literally here because
 * getting either wrong is silent:
 *
 * - **Both** invalidations fire on every mutation. Invalidating only
 *   ['roles'] leaves the editing user holding their old capability set until
 *   a reload, which is the exact staleness task 8 exists to remove.
 * - The list is the restaurant's own custom roles **plus** the global
 *   builtins (`restaurant_id IS NULL`), because the design's roles list
 *   renders builtin cards too: "Built-in cards open the editor read-only
 *   rather than not opening — seeing how Accountant is composed is how an
 *   owner learns what to put in a custom role."
 *
 * Member counts are restaurant-scoped even for a builtin. A builtin role row
 * is global, so counting `user_restaurants` by `role_id` alone would report
 * every Owner on the platform on this restaurant's Owner card.
 *
 * Builtin immutability is enforced in SQL by a BEFORE trigger (task 1) — the
 * client guard asserted below is for a usable error, not for security, and
 * the test says so rather than implying the client is the gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRoles } from '../../src/hooks/useRoles';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const RESTAURANT_ID = 'rest-123';

// A chainable stand-in for the PostgREST builder: every method records its
// call and returns the same object, and the object itself is awaitable so a
// chain can be resolved at any depth without the test having to know which
// call is terminal.
function makeChain(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {
    __calls: calls,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'upsert',
    'eq',
    'in',
    'or',
    'order',
    'single',
    'maybeSingle',
  ]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    });
  }
  return chain as Record<string, ReturnType<typeof vi.fn>> & {
    __calls: Array<[string, unknown[]]>;
    then: (r: (v: unknown) => unknown) => Promise<unknown>;
  };
}

const ROLE_ROWS = [
  {
    id: 'builtin-owner',
    restaurant_id: null,
    name: 'Owner',
    description: 'Full access',
    flavor: 'platform',
    builtin: true,
    created_at: '2026-07-01T00:00:00Z',
    role_areas: [{ area_key: 'collaborators', level: 'manage' }],
    role_flags: [{ flag: 'view:costs' }],
  },
  {
    id: 'custom-weekend',
    restaurant_id: RESTAURANT_ID,
    name: 'Weekend Supervisor',
    description: 'Runs the floor on weekends',
    flavor: 'collaborator',
    builtin: false,
    created_at: '2026-07-20T00:00:00Z',
    role_areas: [
      { area_key: 'scheduling', level: 'manage' },
      { area_key: 'inventory', level: 'view' },
    ],
    role_flags: [],
  },
];

const MEMBERSHIP_ROWS = [
  { role_id: 'builtin-owner' },
  { role_id: 'custom-weekend' },
  { role_id: 'custom-weekend' },
];

let chains: Record<string, ReturnType<typeof makeChain>>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();

  chains = {
    roles: makeChain({ data: ROLE_ROWS, error: null }),
    user_restaurants: makeChain({ data: MEMBERSHIP_ROWS, error: null }),
    role_areas: makeChain({ data: null, error: null }),
    role_flags: makeChain({ data: null, error: null }),
  };

  mockSupabase.from.mockImplementation((table: string) => {
    if (!chains[table]) chains[table] = makeChain({ data: null, error: null });
    return chains[table];
  });
  mockSupabase.rpc.mockResolvedValue({
    data: { copied: ['rest-456'], name_collisions: [] },
    error: null,
  });
});

async function renderReady(restaurantId: string | undefined = RESTAURANT_ID) {
  const { Wrapper, queryClient } = createWrapper();
  const { result } = renderHook(() => useRoles(restaurantId), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return { result, queryClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRoles — listing', () => {
  it('queries roles scoped to the restaurant plus the global builtins', async () => {
    await renderReady();

    expect(mockSupabase.from).toHaveBeenCalledWith('roles');

    const orCall = chains.roles.__calls.find(([m]) => m === 'or');
    expect(orCall, 'the list must use .or() to admit global builtins alongside custom roles').toBeDefined();
    expect(orCall![1][0]).toContain('restaurant_id.is.null');
    expect(orCall![1][0]).toContain(`restaurant_id.eq.${RESTAURANT_ID}`);
  });

  it('embeds role_areas and role_flags in the same round trip', async () => {
    await renderReady();

    const selectCall = chains.roles.__calls.find(([m]) => m === 'select');
    expect(selectCall).toBeDefined();
    const selectArg = String(selectCall![1][0]);
    expect(selectArg).toContain('role_areas');
    expect(selectArg).toContain('role_flags');
    expect(selectArg, 'select explicit fields, not * (CLAUDE.md query optimization)').not.toBe('*');
  });

  it('returns both builtin and custom roles with their grants intact', async () => {
    const { result } = await renderReady();

    expect(result.current.roles).toHaveLength(2);
    const custom = result.current.roles.find((r) => r.id === 'custom-weekend');
    expect(custom?.builtin).toBe(false);
    expect(custom?.role_areas).toEqual([
      { area_key: 'scheduling', level: 'manage' },
      { area_key: 'inventory', level: 'view' },
    ]);
  });

  it('counts members per role, scoped to this restaurant', async () => {
    const { result } = await renderReady();

    const eqCall = chains.user_restaurants.__calls.find(
      ([m, args]) => m === 'eq' && args[0] === 'restaurant_id',
    );
    expect(
      eqCall,
      'a builtin role row is global — the count must be filtered by restaurant_id or every Owner on the platform is counted here',
    ).toBeDefined();
    expect(eqCall![1][1]).toBe(RESTAURANT_ID);

    expect(result.current.roles.find((r) => r.id === 'custom-weekend')?.memberCount).toBe(2);
    expect(result.current.roles.find((r) => r.id === 'builtin-owner')?.memberCount).toBe(1);
  });

  it('does not query at all without a restaurantId', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useRoles(undefined), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('surfaces a query error instead of reporting an empty list', async () => {
    chains.roles = makeChain({ data: null, error: { message: 'permission denied' } });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRoles(RESTAURANT_ID), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.roles).toEqual([]);
  });
});

describe('useRoles — mutations', () => {
  it('createRole inserts the role, then its areas and flags', async () => {
    chains.roles = makeChain({ data: { id: 'new-role' }, error: null });
    const { result } = await renderReady();

    await act(async () => {
      await result.current.createRole({
        name: 'Weekend Supervisor',
        description: 'Runs the floor',
        areas: [{ area_key: 'scheduling', level: 'manage' }],
        flags: ['view:costs'],
      });
    });

    const insert = chains.roles.__calls.find(([m]) => m === 'insert');
    expect(insert).toBeDefined();
    const payload = insert![1][0] as Record<string, unknown>;
    expect(payload.restaurant_id).toBe(RESTAURANT_ID);
    expect(payload.name).toBe('Weekend Supervisor');
    expect(payload.builtin, 'the client never mints a builtin').toBe(false);

    expect(chains.role_areas.insert).toHaveBeenCalledWith([
      { role_id: 'new-role', area_key: 'scheduling', level: 'manage' },
    ]);
    expect(chains.role_flags.insert).toHaveBeenCalledWith([
      { role_id: 'new-role', flag: 'view:costs' },
    ]);
  });

  it('updateRole replaces the grants rather than merging them', async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.updateRole({
        id: 'custom-weekend',
        name: 'Weekend Lead',
        description: 'Runs the floor',
        areas: [{ area_key: 'inventory', level: 'view' }],
        flags: [],
      });
    });

    expect(
      chains.role_areas.delete,
      'ungranting an area has to remove its row — an upsert-only update would leave it granted',
    ).toHaveBeenCalled();
    expect(chains.role_flags.delete).toHaveBeenCalled();
    expect(chains.role_areas.insert).toHaveBeenCalledWith([
      { role_id: 'custom-weekend', area_key: 'inventory', level: 'view' },
    ]);
  });

  it('refuses to update or delete a builtin role without calling the database', async () => {
    const { result } = await renderReady();

    await expect(
      result.current.updateRole({
        id: 'builtin-owner',
        name: 'Owner',
        description: '',
        areas: [],
        flags: [],
      }),
    ).rejects.toThrow(/built-?in/i);

    await expect(result.current.deleteRole('builtin-owner')).rejects.toThrow(/built-?in/i);

    // The SQL trigger from task 1 is the actual guard; this only checks the
    // client fails fast with a readable message instead of round-tripping.
    expect(chains.roles.update).not.toHaveBeenCalled();
    expect(chains.roles.delete).not.toHaveBeenCalled();
  });

  it('copyRole calls the copy_role_to_restaurants RPC and returns its report', async () => {
    const { result } = await renderReady();

    let report: unknown;
    await act(async () => {
      report = await result.current.copyRole({
        roleId: 'custom-weekend',
        targetRestaurantIds: ['rest-456'],
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('copy_role_to_restaurants', {
      p_role_id: 'custom-weekend',
      p_target_restaurant_ids: ['rest-456'],
    });
    expect(report).toEqual({ copied: ['rest-456'], name_collisions: [] });
  });

  it.each([
    ['createRole', (r: ReturnType<typeof useRoles>) =>
      r.createRole({ name: 'X', description: '', areas: [], flags: [] })],
    ['updateRole', (r: ReturnType<typeof useRoles>) =>
      r.updateRole({ id: 'custom-weekend', name: 'X', description: '', areas: [], flags: [] })],
    ['deleteRole', (r: ReturnType<typeof useRoles>) => r.deleteRole('custom-weekend')],
    ['copyRole', (r: ReturnType<typeof useRoles>) =>
      r.copyRole({ roleId: 'custom-weekend', targetRestaurantIds: ['rest-456'] })],
  ])('%s invalidates both ["roles", restaurantId] and ["restaurants"]', async (_name, run) => {
    chains.roles = makeChain({ data: { id: 'new-role' }, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useRoles(RESTAURANT_ID), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await run(result.current);
    });

    const keys = invalidate.mock.calls.map(([arg]) =>
      JSON.stringify((arg as { queryKey: unknown[] }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(['roles', RESTAURANT_ID]));
    expect(
      keys,
      'a role edit changes the editing user\'s own capabilities — ["restaurants"] carries the embedded grants',
    ).toContain(JSON.stringify(['restaurants']));
  });
});
