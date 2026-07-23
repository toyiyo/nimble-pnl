import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useAccountlessEmployees,
  findAccountlessEmployeeByEmail,
  type AccountlessEmployee,
} from '@/hooks/useAccountlessEmployees';

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
 * The hook queries employees with select().eq('restaurant_id', ...).is('user_id', null).eq('status', 'active').
 */
function stubQuery(result: { data: unknown; error: unknown }) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'employees') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue(result),
            }),
          }),
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

describe('useAccountlessEmployees query', () => {
  it('returns active, accountless employees with id/name/email', async () => {
    stubQuery({
      data: [
        { id: 'e1', name: 'Jamie Rivera', email: 'jamie@rushbowls.com' },
        { id: 'e2', name: 'No Email Employee', email: null },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAccountlessEmployees('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      { id: 'e1', name: 'Jamie Rivera', email: 'jamie@rushbowls.com' },
      { id: 'e2', name: 'No Email Employee', email: null },
    ]);
  });

  it('filters restaurant_id, user_id null, and status active', async () => {
    stubQuery({ data: [], error: null });

    const eqRestaurant = vi.fn();
    const isUserIdNull = vi.fn();
    const eqStatusActive = vi.fn().mockResolvedValue({ data: [], error: null });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe('id, name, email');
            return {
              eq: eqRestaurant.mockReturnValue({
                is: isUserIdNull.mockReturnValue({
                  eq: eqStatusActive,
                }),
              }),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useAccountlessEmployees('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'r1');
    expect(isUserIdNull).toHaveBeenCalledWith('user_id', null);
    expect(eqStatusActive).toHaveBeenCalledWith('status', 'active');
  });

  it('propagates a query error', async () => {
    stubQuery({ data: null, error: new Error('employees boom') });

    const { result } = renderHook(() => useAccountlessEmployees('r1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('stays disabled (never queries) without a restaurant id', () => {
    stubQuery({ data: [], error: null });

    const { result } = renderHook(() => useAccountlessEmployees(undefined), {
      wrapper: createWrapper(),
    });

    // enabled: !!restaurantId — the query must not fire.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

const employees: AccountlessEmployee[] = [
  { id: 'e1', name: 'Jamie Rivera', email: 'Jamie@Rushbowls.com' },
  { id: 'e2', name: 'Dana Cook', email: 'cook@kitchen.example' },
  { id: 'e3', name: 'No Email', email: null },
];

describe('findAccountlessEmployeeByEmail', () => {
  it('matches case-insensitively — employees.email is TEXT, not CITEXT', () => {
    expect(findAccountlessEmployeeByEmail(employees, 'jamie@rushbowls.com')?.id).toBe('e1');
    expect(findAccountlessEmployeeByEmail(employees, 'JAMIE@RUSHBOWLS.COM')?.id).toBe('e1');
  });

  it('trims surrounding whitespace', () => {
    expect(findAccountlessEmployeeByEmail(employees, '  cook@kitchen.example  ')?.id).toBe('e2');
  });

  it('returns null for a non-match', () => {
    expect(findAccountlessEmployeeByEmail(employees, 'stranger@example.com')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findAccountlessEmployeeByEmail(employees, '')).toBeNull();
    expect(findAccountlessEmployeeByEmail(employees, '   ')).toBeNull();
  });

  it('fails open while the roster is loading or errored', () => {
    // undefined employees must never read as "match found" — the callers use a
    // null result to mean "proceed normally".
    expect(findAccountlessEmployeeByEmail(undefined, 'jamie@rushbowls.com')).toBeNull();
  });

  it('ignores employees with no email rather than matching them', () => {
    expect(employees.some((e) => e.email === null)).toBe(true);
    expect(findAccountlessEmployeeByEmail(employees, 'no-email@example.com')).toBeNull();
  });
});
