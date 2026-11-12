/**
 * RestaurantContext — the `select_restaurant` deep link from notice emails.
 * The provider selects the linked restaurant, saves it, and deletes the key.
 */
import React, { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RestaurantProvider, useRestaurantContext } from '@/contexts/RestaurantContext';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/chartOfAccountsUtils', () => ({
  createDefaultChartOfAccounts: vi.fn().mockResolvedValue(undefined),
}));

const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const mockAuth = vi.hoisted(() => ({ user: { id: 'user-123' } as { id: string } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));

const KEY = 'selectedRestaurant_user-123';

function membershipRow(restaurantId: string, role = 'owner') {
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

function stubMemberships(data: unknown[]) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockResolvedValue({ data, error: null });
  mockSupabase.from.mockReturnValue(builder);
}

type State = { loading: boolean; id: string | undefined; search: string };

function Probe({ states }: { states: State[] }) {
  const { selectedRestaurant, loading } = useRestaurantContext();
  const location = useLocation();
  states.push({ loading, id: selectedRestaurant?.restaurant_id, search: location.search });
  return null;
}

function renderAt(entry: string) {
  const states: State[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <RestaurantProvider>{children}</RestaurantProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(<Probe states={states} />, { wrapper });
  return states;
}

describe('RestaurantContext - select_restaurant deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'user-123' };
    localStorage.clear();
  });

  it('selects the linked restaurant, saves it, and deletes the key', async () => {
    localStorage.setItem(KEY, 'A');
    stubMemberships([membershipRow('A'), membershipRow('B')]);

    const states = renderAt('/banking?select_restaurant=B');

    await waitFor(() => expect(states.at(-1)?.search).toBe(''));
    expect(states.at(-1)?.id).toBe('B');
    expect(localStorage.getItem(KEY)).toBe('B');
  });

  it('ignores a foreign id, keeps the saved restaurant, and deletes the key', async () => {
    localStorage.setItem(KEY, 'A');
    stubMemberships([membershipRow('A'), membershipRow('B')]);

    const states = renderAt('/banking?select_restaurant=Z');

    await waitFor(() => expect(states.at(-1)?.search).toBe(''));
    expect(states.at(-1)?.id).toBe('A');
    expect(localStorage.getItem(KEY)).toBe('A');
  });

  it('keeps the other keys, for example welcome=true', async () => {
    localStorage.setItem(KEY, 'A');
    stubMemberships([membershipRow('A'), membershipRow('B')]);

    const states = renderAt('/?select_restaurant=B&welcome=true');

    await waitFor(() => expect(states.at(-1)?.search).toBe('?welcome=true'));
    expect(states.at(-1)?.id).toBe('B');
  });

  it('keeps the key when the restaurant list is empty', async () => {
    stubMemberships([]);

    const states = renderAt('/banking?select_restaurant=B');

    await waitFor(() => expect(states.at(-1)?.loading).toBe(false));
    expect(states.at(-1)?.search).toBe('?select_restaurant=B');
    expect(states.at(-1)?.id).toBeUndefined();
  });

  it('does not change the URL or the selection for the trade link', async () => {
    localStorage.setItem(KEY, 'A');
    stubMemberships([membershipRow('A'), membershipRow('B')]);

    const states = renderAt('/banking?trade=T&restaurant=B&from=reminder');

    await waitFor(() => expect(states.at(-1)?.loading).toBe(false));
    expect(states.at(-1)?.search).toBe('?trade=T&restaurant=B&from=reminder');
    expect(states.at(-1)?.id).toBe('A');
    expect(localStorage.getItem(KEY)).toBe('A');
  });
});
