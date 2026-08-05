/**
 * RestaurantContext — the role must be resolved before `loading` clears.
 *
 * `StaffRoleChecker` (src/App.tsx:253) holds every protected route behind
 * `useRestaurantContext().loading`, then reads `selectedRestaurant?.role` to
 * decide whether a kiosk / staff / collaborator user is allowed on the current
 * path. That gate is only sound if `loading === false` implies "the role is
 * known".
 *
 * It did not. `loading` came straight from the memberships query, but the
 * selection was made in a `useEffect` — one commit later. In between there was
 * a render with `loading === false` and `selectedRestaurant === null`, so
 * `role` was `undefined`, every guard in StaffRoleChecker evaluated falsy, and
 * the forbidden page rendered (and fired its queries) before the redirect.
 *
 * These tests pin the contract at the context seam that StaffRoleChecker
 * depends on, which is the layer where the defect lives. Driving it through
 * the router in E2E cannot pin it: the window is a single commit, so a browser
 * test observes it only as an unreproducible flash.
 */
import React, { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RestaurantProvider, useRestaurantContext } from '@/contexts/RestaurantContext';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/chartOfAccountsUtils', () => ({
  createDefaultChartOfAccounts: vi.fn().mockResolvedValue(undefined),
}));

const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const mockAuth = vi.hoisted(() => ({ user: { id: 'user-123' } as { id: string } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));

function membershipRow(restaurantId: string, role: string) {
  return {
    id: `membership-${restaurantId}`,
    user_id: 'user-123',
    restaurant_id: restaurantId,
    role,
    created_at: '2026-01-01T00:00:00Z',
    restaurant: { id: restaurantId, name: `Restaurant ${restaurantId}` },
    roleRecord: null,
  };
}

/** Chainable `.select().eq()` stub; `eq` resolves with the queued values in order. */
function stubMemberships(...results: Array<{ data: unknown; error: unknown }>) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn();
  for (const result of results) builder.eq.mockResolvedValueOnce(result);
  // Any further refetch repeats the last queued result.
  builder.eq.mockResolvedValue(results[results.length - 1]);
  mockSupabase.from.mockReturnValue(builder);
  return builder;
}

type Sample = { loading: boolean; role: string | undefined };

/** Records the context on every render, so we can inspect intermediate commits. */
function Probe({ samples }: { samples: Sample[] }) {
  const { selectedRestaurant, loading } = useRestaurantContext();
  samples.push({ loading, role: selectedRestaurant?.role });
  return null;
}

function renderProvider() {
  const samples: Sample[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RestaurantProvider>{children}</RestaurantProvider>
    </QueryClientProvider>
  );
  const utils = render(<Probe samples={samples} />, { wrapper });
  return { samples, queryClient, ...utils };
}

describe('RestaurantContext — role resolution vs. the loading flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'user-123' };
    localStorage.clear();
  });

  it('never reports loading:false with an unresolved role when the user has a sole membership', async () => {
    stubMemberships({ data: [membershipRow('restaurant-1', 'collaborator_accountant')], error: null });

    const { samples } = renderProvider();

    await waitFor(() => expect(samples.at(-1)?.role).toBe('collaborator_accountant'));

    // The window StaffRoleChecker falls through: not loading, but no role yet.
    const failOpen = samples.filter((s) => !s.loading && s.role === undefined);
    expect(failOpen).toEqual([]);
  });

  it('never reports loading:false with an unresolved role when a saved selection is restored', async () => {
    localStorage.setItem('selectedRestaurant_user-123', 'restaurant-2');
    stubMemberships({
      data: [
        membershipRow('restaurant-1', 'owner'),
        membershipRow('restaurant-2', 'kiosk'),
      ],
      error: null,
    });

    const { samples } = renderProvider();

    await waitFor(() => expect(samples.at(-1)?.role).toBe('kiosk'));

    const failOpen = samples.filter((s) => !s.loading && s.role === undefined);
    expect(failOpen).toEqual([]);
  });

  it('picks up a role change on refetch instead of holding the role from the first fetch', async () => {
    stubMemberships(
      { data: [membershipRow('restaurant-1', 'owner')], error: null },
      { data: [membershipRow('restaurant-1', 'staff')], error: null },
    );

    const { samples, queryClient } = renderProvider();

    await waitFor(() => expect(samples.at(-1)?.role).toBe('owner'));

    await queryClient.invalidateQueries({ queryKey: ['restaurants', 'user-123'] });

    // The auto-selected membership was stored as a snapshot object, so a
    // demotion to `staff` never reached StaffRoleChecker without a reload.
    await waitFor(() => expect(samples.at(-1)?.role).toBe('staff'));
  });

  it('leaves the selection empty for a multi-restaurant user with no saved choice', async () => {
    stubMemberships({
      data: [membershipRow('restaurant-1', 'owner'), membershipRow('restaurant-2', 'owner')],
      error: null,
    });

    const { samples } = renderProvider();

    // Index.tsx renders a "Select or create a restaurant" screen for this
    // state, so the provider must not block or auto-pick on the user's behalf.
    await waitFor(() => expect(samples.at(-1)?.loading).toBe(false));
    expect(samples.at(-1)?.role).toBeUndefined();
  });
});
