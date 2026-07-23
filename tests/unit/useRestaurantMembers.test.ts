import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useRestaurantMembers,
  findMemberByEmail,
  type RestaurantMember,
} from '@/hooks/useRestaurantMembers';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/**
 * The hook makes two sequential queries. The first resolves at `.eq()`
 * (user_restaurants), the second at `.in()` (profiles). Route by table name so
 * either can be made to error independently.
 */
function stubQueries(opts: {
  memberships?: { data: unknown; error: unknown };
  profiles?: { data: unknown; error: unknown };
}) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'user_restaurants') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(opts.memberships ?? { data: [], error: null }),
        }),
      };
    }
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue(opts.profiles ?? { data: [], error: null }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRestaurantMembers query', () => {
  it('joins memberships to profiles, tolerating a member with no profile row', async () => {
    stubQueries({
      memberships: {
        data: [
          { user_id: 'u1', role: 'manager' },
          { user_id: 'u2', role: 'staff' },
        ],
        error: null,
      },
      // u2 has no profile row — email/fullName must fall back to null, not throw.
      profiles: {
        data: [{ user_id: 'u1', full_name: 'Alexis Sanchez', email: 'alexis@rushbowls.com' }],
        error: null,
      },
    });

    const { result } = renderHook(() => useRestaurantMembers('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      { userId: 'u1', email: 'alexis@rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
      { userId: 'u2', email: null, fullName: null, role: 'staff' },
    ]);
    expect(mockSupabase.from).toHaveBeenCalledWith('user_restaurants');
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
  });

  it('short-circuits to an empty roster without querying profiles', async () => {
    stubQueries({ memberships: { data: [], error: null } });

    const { result } = renderHook(() => useRestaurantMembers('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    // The profiles table must never be hit when there are no members.
    expect(mockSupabase.from).not.toHaveBeenCalledWith('profiles');
  });

  it('propagates a membership-query error', async () => {
    stubQueries({ memberships: { data: null, error: new Error('membership boom') } });

    const { result } = renderHook(() => useRestaurantMembers('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('propagates a profiles-query error', async () => {
    stubQueries({
      memberships: { data: [{ user_id: 'u1', role: 'manager' }], error: null },
      profiles: { data: null, error: new Error('profiles boom') },
    });

    const { result } = renderHook(() => useRestaurantMembers('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('stays disabled (never queries) without a restaurant id', () => {
    stubQueries({});

    const { result } = renderHook(() => useRestaurantMembers(undefined), {
      wrapper: createWrapper(),
    });

    // enabled: !!restaurantId — the query must not fire.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

const members: RestaurantMember[] = [
  { userId: 'u1', email: 'Alexis@Rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
  { userId: 'u2', email: 'book@cpa.example', fullName: 'Dana Books', role: 'collaborator_accountant' },
  { userId: 'u3', email: null, fullName: 'No Email', role: 'staff' },
];

describe('findMemberByEmail', () => {
  it('matches case-insensitively — profiles.email is TEXT, not CITEXT', () => {
    expect(findMemberByEmail(members, 'alexis@rushbowls.com')?.userId).toBe('u1');
    expect(findMemberByEmail(members, 'ALEXIS@RUSHBOWLS.COM')?.userId).toBe('u1');
  });

  it('trims surrounding whitespace', () => {
    expect(findMemberByEmail(members, '  book@cpa.example  ')?.userId).toBe('u2');
  });

  it('returns null for a non-member', () => {
    expect(findMemberByEmail(members, 'stranger@example.com')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findMemberByEmail(members, '')).toBeNull();
    expect(findMemberByEmail(members, '   ')).toBeNull();
  });

  it('fails open while the roster is loading or errored', () => {
    // undefined members must never read as "match found" — the callers use a
    // null result to mean "proceed normally".
    expect(findMemberByEmail(undefined, 'alexis@rushbowls.com')).toBeNull();
  });

  it('ignores members with no email rather than matching them', () => {
    // A member whose email is null must never match a real lookup, and must
    // not throw while comparing — the roster includes exactly such a member.
    expect(members.some((m) => m.email === null)).toBe(true);
    expect(findMemberByEmail(members, 'no-email@example.com')).toBeNull();
  });
});
