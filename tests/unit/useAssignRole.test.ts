import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

/** The membership id an `assign_membership_role` call carries. */
function calledMembershipId(params: unknown): string | undefined {
  return (params as { p_membership_id?: string } | undefined)?.p_membership_id;
}

import {
  useAssignRole,
  useAssignPeopleToRole,
  assignRoleErrorMessage,
} from '@/hooks/useAssignRole';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';

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

const person = (id: string): RestaurantMember => ({
  membershipId: id,
  userId: `u-${id}`,
  email: `${id}@example.com`,
  fullName: id.toUpperCase(),
  role: 'staff',
  roleId: null,
});

describe('useAssignPeopleToRole', () => {
  beforeEach(() => rpc.mockReset());

  it('walks the list one at a time, in order', async () => {
    // Sequential, not Promise.all: rule 5b of assign_membership_role takes
    // FOR UPDATE on the restaurant's owner rows, so concurrent calls contend.
    const seen: string[] = [];
    let inFlight = 0;
    let overlapped = false;
    rpc.mockImplementation(async (_fn: unknown, params: unknown) => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      seen.push(calledMembershipId(params) ?? '?');
      await Promise.resolve();
      inFlight -= 1;
      return { error: null };
    });
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignPeopleToRole('r1'), { wrapper: wrapper(client) });

    const outcome = await result.current.mutateAsync({
      members: [person('m1'), person('m2'), person('m3')],
      role: 'collaborator_custom',
      roleId: 'x1',
    });

    expect(seen).toEqual(['m1', 'm2', 'm3']);
    expect(overlapped).toBe(false);
    expect(outcome).toEqual({ landed: 3, failures: [] });
  });

  it('resolves with the failures rather than throwing them', async () => {
    // A partial failure is a result to report, not an exception: one 42501
    // among three must not discard the two that landed.
    rpc.mockImplementation(async (_fn: unknown, params: unknown) =>
      calledMembershipId(params) === 'm2'
        ? { error: { code: '42501', message: 'Only an owner can change an owner' } }
        : { error: null }
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useAssignPeopleToRole('r1'), { wrapper: wrapper(client) });

    const outcome = await result.current.mutateAsync({
      members: [person('m1'), person('m2'), person('m3')],
      role: 'staff',
    });

    expect(outcome.landed).toBe(2);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].member.membershipId).toBe('m2');
    // The sentence the RPC wrote, not a generic fallback.
    expect(outcome.failures[0].message).toBe('Only an owner can change an owner');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates once for the batch, even when every call was denied', async () => {
    // onSettled, not onSuccess: rule 5b's owner count and the invite matrix are
    // both read from data the caller is showing, so a denial can mean the
    // screen is stale.
    rpc.mockResolvedValue({ error: { code: '42501', message: 'nope' } });
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAssignPeopleToRole('r1'), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ members: [person('m1'), person('m2')], role: 'staff' });

    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    // Four invalidations for a two-person batch, not eight.
    expect(keys).toHaveLength(4);
    expect(keys).toContain(JSON.stringify(['restaurant-members', 'r1']));
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
