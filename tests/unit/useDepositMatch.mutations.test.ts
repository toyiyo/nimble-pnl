import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that use them
// ---------------------------------------------------------------------------

const fromMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: fromMock },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import {
  useCreateDepositMatchRule,
  useUpdateDepositMatchRule,
  useSetDepositMatchResolution,
  useConfirmDepositMatchLink,
  useDepositMatchRule,
} from '@/hooks/useDepositMatch';
import type { DepositMatchRuleInput } from '@/types/depositMatch';

// ---------------------------------------------------------------------------
// Chain builders — each mirrors one Supabase query-builder chain the hooks
// use, so a test can assert both the args passed at each link and the final
// resolved row.
// ---------------------------------------------------------------------------

/** insert(...).select().single() */
function makeInsertChain(resolved: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(resolved);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, select, single };
}

/** update(...).eq('id', id).select().single() */
function makeUpdateChain(resolved: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(resolved);
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { update, eq, select, single };
}

/** update(...).eq('id', id).eq('restaurant_id', restaurantId).select().single() */
function makeUpdateChainWithRestaurant(resolved: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(resolved);
  const select = vi.fn(() => ({ single }));
  const eqRestaurant = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqRestaurant }));
  const update = vi.fn(() => ({ eq: eqId }));
  return { update, eqId, eqRestaurant, select, single };
}

/** select('*').eq('id', id).eq('restaurant_id', restaurantId).single() */
function makeSelectByIdChain(resolved: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(resolved);
  const eqRestaurant = vi.fn(() => ({ single }));
  const eqId = vi.fn(() => ({ eq: eqRestaurant }));
  const select = vi.fn(() => ({ eq: eqId }));
  return { select, eqId, eqRestaurant, single };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const ruleInput: DepositMatchRuleInput = {
  restaurant_id: 'rest-1',
  pos_source: 'toast',
  rail: 'card',
  connected_bank_id: 'bank-1',
  settlement: 'gross',
  lag_days_min: 1,
  lag_days_max: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCreateDepositMatchRule', () => {
  it('inserts the rule and invalidates the restaurant queries on success', async () => {
    const chain = makeInsertChain({ data: { id: 'rule-1', ...ruleInput }, error: null });
    fromMock.mockReturnValue(chain);

    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateDepositMatchRule(), {
      wrapper: createWrapper(queryClient),
    });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync(ruleInput);
    });

    expect(fromMock).toHaveBeenCalledWith('deposit_match_rules');
    expect(chain.insert).toHaveBeenCalledWith(ruleInput);
    expect(created).toEqual({ id: 'rule-1', ...ruleInput });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['deposit-match', 'rest-1'] });
  });

  it('rejects when the insert returns an error', async () => {
    const dbError = new Error('duplicate rule');
    const chain = makeInsertChain({ data: null, error: dbError });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useCreateDepositMatchRule(), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(ruleInput)).rejects.toThrow('duplicate rule');
    });
  });
});

describe('useUpdateDepositMatchRule', () => {
  it('updates the rule by id, scoped to the caller restaurant, and invalidates its queries', async () => {
    const chain = makeUpdateChainWithRestaurant({ data: { id: 'rule-1', active: false }, error: null });
    fromMock.mockReturnValue(chain);

    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateDepositMatchRule('rest-1'), {
      wrapper: createWrapper(queryClient),
    });

    let updated: unknown;
    await act(async () => {
      updated = await result.current.mutateAsync({ id: 'rule-1', update: { active: false } });
    });

    expect(fromMock).toHaveBeenCalledWith('deposit_match_rules');
    expect(chain.update).toHaveBeenCalledWith({ active: false });
    expect(chain.eqId).toHaveBeenCalledWith('id', 'rule-1');
    expect(chain.eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(updated).toEqual({ id: 'rule-1', active: false });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['deposit-match', 'rest-1'] });
  });

  it('rejects when the update returns an error', async () => {
    const chain = makeUpdateChainWithRestaurant({ data: null, error: new Error('not found') });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useUpdateDepositMatchRule('rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'missing', update: { active: false } })
      ).rejects.toThrow('not found');
    });
  });

  it('rejects without querying Supabase when no restaurant is selected', async () => {
    const { result } = renderHook(() => useUpdateDepositMatchRule(null), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'rule-1', update: { active: false } })
      ).rejects.toThrow('No restaurant is selected');
    });

    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('useSetDepositMatchResolution', () => {
  it('writes the resolution, stamping the current user and a timestamp', async () => {
    const chain = makeUpdateChain({
      data: { id: 'item-1', resolution: 'accepted' },
      error: null,
    });
    fromMock.mockReturnValue(chain);

    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetDepositMatchResolution('rest-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ item_id: 'item-1', resolution: 'accepted' });
    });

    expect(fromMock).toHaveBeenCalledWith('deposit_match_items');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: 'accepted',
        resolution_note: null,
        resolved_by: 'user-1',
      })
    );
    const written = chain.update.mock.calls[0][0] as { resolved_at: string };
    expect(typeof written.resolved_at).toBe('string');
    expect(chain.eq).toHaveBeenCalledWith('id', 'item-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['deposit-match', 'rest-1'] });
  });

  it('keeps a supplied resolution_note instead of defaulting it to null', async () => {
    const chain = makeUpdateChain({ data: { id: 'item-1' }, error: null });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useSetDepositMatchResolution('rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({
        item_id: 'item-1',
        resolution: 'disputed',
        resolution_note: 'chargeback pending',
      });
    });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ resolution_note: 'chargeback pending' })
    );
  });
});

describe('useDepositMatchRule', () => {
  it('fetches the rule by id, scoped to the given restaurant', async () => {
    const chain = makeSelectByIdChain({ data: { id: 'rule-1', pos_source: 'toast' }, error: null });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useDepositMatchRule('rule-1', 'rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith('deposit_match_rules');
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.eqId).toHaveBeenCalledWith('id', 'rule-1');
    expect(chain.eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(result.current.data).toEqual({ id: 'rule-1', pos_source: 'toast' });
  });

  it('stays disabled and never queries when ruleId is null', () => {
    const { result } = renderHook(() => useDepositMatchRule(null, 'rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('stays disabled and never queries when restaurantId is null', () => {
    const { result } = renderHook(() => useDepositMatchRule('rule-1', null), {
      wrapper: createWrapper(makeQueryClient()),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects when the row read returns an error', async () => {
    const chain = makeSelectByIdChain({ data: null, error: new Error('not found') });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useDepositMatchRule('missing', 'rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('not found'));
  });
});

describe('useConfirmDepositMatchLink', () => {
  it('marks the link confirmed and invalidates the restaurant queries', async () => {
    const chain = makeUpdateChain({ data: { id: 'link-1', state: 'confirmed' }, error: null });
    fromMock.mockReturnValue(chain);

    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmDepositMatchLink('rest-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ link_id: 'link-1' });
    });

    expect(fromMock).toHaveBeenCalledWith('deposit_match_links');
    expect(chain.update).toHaveBeenCalledWith({ state: 'confirmed' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'link-1');
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['deposit-match', 'rest-1'] });
    });
  });

  it('rejects when the confirm update returns an error', async () => {
    const chain = makeUpdateChain({ data: null, error: new Error('already confirmed') });
    fromMock.mockReturnValue(chain);

    const { result } = renderHook(() => useConfirmDepositMatchLink('rest-1'), {
      wrapper: createWrapper(makeQueryClient()),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ link_id: 'link-1' })).rejects.toThrow(
        'already confirmed'
      );
    });
  });
});
