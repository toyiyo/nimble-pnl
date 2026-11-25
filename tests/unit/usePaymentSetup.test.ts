import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { stripeConnectedAccountKey } from '@/lib/stripeConnectKeys';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePaymentSetup } from '@/hooks/usePaymentSetup';

const invoke = vi.fn();
const toast = vi.fn();
const connectState = vi.hoisted(() => ({
  value: { connectedAccount: null as unknown, loading: false, error: null as Error | null },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/useStripeConnect', () => ({
  useStripeConnect: () => connectState.value,
}));

const RID = 'rest-1';

// The first row seeds the cache. Each refetch reads the next row from a mocked fetch.
// The last row repeats.
function setup(rows: unknown[] = [connectState.value.connectedAccount]) {
  const queryClient = new QueryClient();
  const fetchAccount = vi.fn();
  const later = rows.length > 1 ? rows.slice(1) : rows;
  later.forEach((row, i) => {
    if (i === later.length - 1) fetchAccount.mockResolvedValue(row);
    else fetchAccount.mockResolvedValueOnce(row);
  });
  queryClient.setQueryData(stripeConnectedAccountKey(RID), rows[0]);
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
    queryClient.setQueryData(stripeConnectedAccountKey(RID), await fetchAccount());
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => usePaymentSetup(RID), { wrapper });
  return { ...hook, invalidate, queryClient, fetchAccount };
}

const account = (over: Record<string, unknown> = {}) => ({
  charges_enabled: false,
  onboarding_complete: false,
  ...over,
});

describe('usePaymentSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectState.value = { connectedAccount: null, loading: false, error: null };
    invoke.mockResolvedValue({ data: {}, error: null });
  });

  it('maps the state from the account row', () => {
    expect(setup().result.current.state).toBe('not_started');
    connectState.value = { ...connectState.value, connectedAccount: account() };
    expect(setup().result.current.state).toBe('pending');
    connectState.value = {
      ...connectState.value,
      connectedAccount: account({ charges_enabled: true, onboarding_complete: true }),
    };
    expect(setup().result.current.state).toBe('ready');
  });

  it('openSetup creates the account when not started, then opens the sheet', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(invoke).toHaveBeenCalledWith('stripe-create-connected-account', {
      body: { restaurantId: RID },
    });
    expect(result.current.isSheetOpen).toBe(true);
  });

  it('openSetup for an existing account opens the sheet with no create call', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.isSheetOpen).toBe(true);
  });

  it('openSetup does nothing while the account row loads', async () => {
    connectState.value = { ...connectState.value, loading: true };
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('ignores a second openSetup while isStarting', async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    let first!: Promise<void>;
    act(() => {
      first = result.current.openSetup();
    });
    expect(result.current.isStarting).toBe(true);
    await act(async () => {
      await result.current.openSetup();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: {}, error: null });
      await first;
    });
    expect(result.current.isStarting).toBe(false);
  });

  it('shows a toast and does not open the sheet on a create error', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    expect(result.current.isSheetOpen).toBe(false);
    expect(result.current.isStarting).toBe(false);
  });

  it('checkStatus sends statusOnly, then invalidates the account query', async () => {
    const { result, invalidate } = setup();
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(invoke).toHaveBeenCalledWith('stripe-create-connected-account', {
      body: { restaurantId: RID, statusOnly: true },
    });
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: ['stripe-connected-account', RID] },
      { throwOnError: true },
    );
  });

  it('shows the server message when the function returns a 403', async () => {
    const response = new Response(JSON.stringify({ error: 'Only the owner can set up payments' }), {
      status: 403,
    });
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(response),
    });
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Only the owner can set up payments',
        variant: 'destructive',
      }),
    );
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('keeps the original error when the error body cannot be read', async () => {
    const error = new FunctionsHttpError(new Response('not json', { status: 500 }));
    invoke.mockResolvedValue({ data: null, error });
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: error.message, variant: 'destructive' }),
    );
  });

  it('shows an error toast and no status toast when the refetch fails', async () => {
    connectState.value = {
      ...connectState.value,
      connectedAccount: account({ charges_enabled: true, onboarding_complete: true }),
    };
    const { result, invalidate } = setup();
    invalidate.mockRejectedValue(new Error('refetch failed'));
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('closes the sheet when the restaurant changes', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(({ id }) => usePaymentSetup(id), {
      wrapper,
      initialProps: { id: RID },
    });
    await act(async () => {
      await result.current.openSetup();
    });
    expect(result.current.isSheetOpen).toBe(true);
    rerender({ id: 'rest-2' });
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('keeps the sheet closed when the user returns to the first restaurant', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(({ id }) => usePaymentSetup(id), {
      wrapper,
      initialProps: { id: RID },
    });
    await act(async () => {
      await result.current.openSetup();
    });
    expect(result.current.isSheetOpen).toBe(true);
    rerender({ id: 'rest-2' });
    rerender({ id: RID });
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('does not open the sheet when a pending openSetup finishes after A to B to A', async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(({ id }) => usePaymentSetup(id), {
      wrapper,
      initialProps: { id: RID },
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.openSetup();
    });
    rerender({ id: 'rest-2' });
    rerender({ id: RID });
    await act(async () => {
      resolve({ data: {}, error: null });
      await pending;
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('does not run checkStatus in parallel', async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    let first!: Promise<void>;
    act(() => {
      first = result.current.checkStatus();
    });
    expect(result.current.isChecking).toBe(true);
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: {}, error: null });
      await first;
    });
    expect(result.current.isChecking).toBe(false);
  });

  it('closeSetup closes the sheet and calls checkStatus', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    const { result } = setup();
    await act(async () => {
      await result.current.openSetup();
    });
    expect(result.current.isSheetOpen).toBe(true);
    await act(async () => {
      result.current.closeSetup();
    });
    expect(result.current.isSheetOpen).toBe(false);
    expect(invoke).toHaveBeenCalledWith('stripe-create-connected-account', {
      body: { restaurantId: RID, statusOnly: true },
    });
  });

  it('shows no toast when the cache has no data after the check', async () => {
    const { result, queryClient } = setup();
    queryClient.removeQueries({ queryKey: stripeConnectedAccountKey(RID) });
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows "Payments are on" when the check finds a ready account', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    // The first row is pending. Only the refetch returns the ready row.
    const { result, fetchAccount } = setup([
      account(),
      account({ charges_enabled: true, onboarding_complete: true }),
    ]);
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(fetchAccount).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payments are on' }));
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stripe is still checking your details' }),
    );
  });

  it('shows "Stripe is still checking your details" when the account is pending', async () => {
    connectState.value = { ...connectState.value, connectedAccount: account() };
    const { result } = setup();
    await act(async () => {
      await result.current.checkStatus();
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stripe is still checking your details' }),
    );
  });
});
