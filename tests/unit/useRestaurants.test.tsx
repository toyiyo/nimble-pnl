/**
 * useRestaurants — React Query conversion + embedded role (Phase 4, task 8b)
 *
 * Design doc: docs/superpowers/specs/2026-07-29-roles-and-areas-design.md
 * ("Keeping usePermissions synchronous" — the two Phase 2.5 caveats).
 * Plan: docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md ("Task 8").
 *
 * Today's `useRestaurants.tsx` is raw `useState` + `useEffect` with a manual
 * `fetchRestaurants` callback — no React Query cache, key, or `staleTime`
 * (CLAUDE.md's "No Manual Caching" rule). This file pins the next shape:
 *
 * - React Query, key `['restaurants', user.id]`, `staleTime: 30000`,
 *   `refetchOnWindowFocus: true` — so a role edit made elsewhere reaches a
 *   signed-in collaborator without a reload.
 * - The `user_restaurants` select is extended to embed the joined role under
 *   `roleRecord` (deliberately not `role` — that's the existing legacy text
 *   column), including its `role_areas` and `role_flags`, in the same round
 *   trip (no extra network call for permissions).
 *
 * This is a data-layer conversion only; there is no UI in this file, so the
 * visual reference (docs/design-reference/roles-and-areas.html /
 * editor.png / editor-dark.png / list.png / mobile.png) does not apply here —
 * it governs task 9's components.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRestaurants } from '@/hooks/useRestaurants';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/lib/chartOfAccountsUtils', () => ({
  createDefaultChartOfAccounts: vi.fn().mockResolvedValue(undefined),
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockAuth = vi.hoisted(() => ({
  user: { id: 'user-123' } as { id: string } | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

const roleRecordFixture = {
  id: 'role-chef-id',
  name: 'Chef',
  flavor: 'platform',
  builtin: true,
  role_areas: [
    { area_key: 'inventory', level: 'manage' },
    { area_key: 'recipes', level: 'manage' },
  ],
  role_flags: [],
};

const restaurantRowFixture = {
  id: 'membership-1',
  user_id: 'user-123',
  restaurant_id: 'restaurant-1',
  role: 'chef',
  role_id: 'role-chef-id',
  created_at: '2026-01-01T00:00:00Z',
  restaurant: { id: 'restaurant-1', name: 'Test Restaurant' },
  roleRecord: roleRecordFixture,
};

/** Builds a chainable `.select().eq()` query-builder stub, thenable like the real one. */
function createUserRestaurantsBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockResolvedValue(resolvedValue);
  return builder;
}

function createWrapper(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

describe('useRestaurants — React Query conversion with embedded roleRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'user-123' };
  });

  it('queries user_restaurants keyed by React Query as ["restaurants", user.id] with staleTime 30000 and refetchOnWindowFocus true', async () => {
    const builder = createUserRestaurantsBuilder({ data: [restaurantRowFixture], error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const entry = queryClient.getQueryCache().find({ queryKey: ['restaurants', 'user-123'] });
    expect(entry).toBeDefined();
    expect(entry?.options.staleTime).toBe(30000);
    expect(entry?.options.refetchOnWindowFocus).toBe(true);
  });

  it('embeds roleRecord:roles(...) with role_areas and role_flags in the select string', async () => {
    const builder = createUserRestaurantsBuilder({ data: [restaurantRowFixture], error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSupabase.from).toHaveBeenCalledWith('user_restaurants');
    const selectArg = builder.select.mock.calls[0][0] as string;
    expect(selectArg).toContain('roleRecord:roles');
    expect(selectArg).toContain('role_areas');
    expect(selectArg).toContain('role_flags');
  });

  it('exposes the embedded roleRecord verbatim on each returned restaurant', async () => {
    const builder = createUserRestaurantsBuilder({ data: [restaurantRowFixture], error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.restaurants).toHaveLength(1);
    expect(result.current.restaurants[0].roleRecord).toEqual(roleRecordFixture);
  });

  it('reports loading true before resolution and false once resolved', async () => {
    const builder = createUserRestaurantsBuilder({ data: [restaurantRowFixture], error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.restaurants).toHaveLength(1);
  });

  it('does not query user_restaurants when there is no signed-in user', async () => {
    mockAuth.user = null;
    const builder = createUserRestaurantsBuilder({ data: [], error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    // Give any stray async work a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(result.current.restaurants).toEqual([]);
  });

  it('refetches the restaurants query after createRestaurant succeeds, so a new role/membership reaches the UI without a reload', async () => {
    const builder = createUserRestaurantsBuilder({ data: [restaurantRowFixture], error: null });
    mockSupabase.from.mockReturnValue(builder);
    mockSupabase.rpc.mockResolvedValue({ data: 'new-restaurant-id', error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRestaurants(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);

    await result.current.createRestaurant({ name: 'New Spot' });

    await waitFor(() => expect(mockSupabase.from).toHaveBeenCalledTimes(2));
  });
});
