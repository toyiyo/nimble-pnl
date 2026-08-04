import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useAssignRole, assignRoleErrorMessage } from '@/hooks/useAssignRole';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useAssignRole', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the RPC with snake_case params and omits role_id for a builtin', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'chef' });

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('assign_membership_role', {
      p_membership_id: 'm1',
      p_role: 'chef',
      p_role_id: null,
    });
  });

  it('passes role_id through for a custom role', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'collaborator_custom', roleId: 'x1' });

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_role_id: 'x1' });
  });

  it('invalidates roles and restaurants on success', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'chef' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['roles', 'r1']));
    expect(keys).toContain(JSON.stringify(['restaurants']));
    expect(keys).toContain(JSON.stringify(['collaborators', 'r1']));
  });

  it('rejects when PostgREST returns an error object', async () => {
    rpc.mockResolvedValue({ error: { code: '42501', message: 'Only an owner can change a role' } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'staff' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('assignRoleErrorMessage', () => {
  it('surfaces the RPC sentence for a 42501, not a generic failure', () => {
    // PostgREST rejections arrive as plain {code, message, ...} objects, not
    // Error instances, so `instanceof Error` must be the LAST branch or every
    // denial renders as "Something went wrong".
    expect(assignRoleErrorMessage({ code: '42501', message: 'Only an owner can change an owner’s role' }))
      .toBe('Only an owner can change an owner’s role');
  });

  it('falls back for an Error instance', () => {
    expect(assignRoleErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('falls back for something with no message at all', () => {
    expect(assignRoleErrorMessage(null)).toBe("Couldn't change that role. Please try again.");
  });
});
