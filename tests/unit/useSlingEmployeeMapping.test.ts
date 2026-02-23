import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSlingEmployeeMapping } from '../../src/hooks/useSlingEmployeeMapping';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockMatchEmployees = vi.hoisted(() => vi.fn());
vi.mock('@/utils/shiftEmployeeMatching', () => ({
  matchEmployees: mockMatchEmployees,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const RESTAURANT_ID = 'rest-map-123';

const mockSlingUsers = [
  {
    sling_user_id: 101,
    name: 'Alice',
    lastname: 'Smith',
    email: 'alice@example.com',
    position: 'Server',
    is_active: true,
  },
  {
    sling_user_id: 102,
    name: 'Bob',
    lastname: 'Jones',
    email: 'bob@example.com',
    position: 'Cook',
    is_active: true,
  },
];

const mockEmployees = [
  {
    id: 'emp-1',
    name: 'Alice Smith',
    position: 'Server',
    restaurant_id: RESTAURANT_ID,
    status: 'active',
    email: 'alice@example.com',
    phone: null,
    hire_date: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
  },
];

const mockMatchResults = [
  {
    csvName: 'Alice Smith',
    normalizedName: 'alice smith',
    matchedEmployeeId: 'emp-1',
    matchedEmployeeName: 'Alice Smith',
    matchConfidence: 'exact' as const,
    csvPosition: 'Server',
    action: 'link' as const,
  },
  {
    csvName: 'Bob Jones',
    normalizedName: 'bob jones',
    matchedEmployeeId: null,
    matchedEmployeeName: null,
    matchConfidence: 'none' as const,
    csvPosition: 'Cook',
    action: 'create' as const,
  },
];

/**
 * Build a fresh mock chain for supabase.from() calls.
 *
 * Because the hook fires multiple independent from() calls (sling_users, employees,
 * employee_integration_mappings) we need the chain to be flexible.
 * `mockSupabase.from.mockReturnValue(chain)` makes every from() return the same chain,
 * which is sufficient for the majority of tests.  For tests that need per-table
 * behaviour we override from() with mockImplementation.
 */
function buildDefaultChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockFromChain: ReturnType<typeof buildDefaultChain>;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = buildDefaultChain();
  mockSupabase.from.mockReturnValue(mockFromChain);
  mockMatchEmployees.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSlingEmployeeMapping', () => {
  // =========================================================================
  // fetchSlingUsersAndEmployees
  // =========================================================================
  describe('fetchSlingUsersAndEmployees', () => {
    it('fetches sling_users and employees then runs matchEmployees', async () => {
      // Build per-table chains so each from() call resolves its own data
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      // The second .eq() call resolves with the data (end of chain)
      slingChain.eq
        .mockReturnValueOnce(slingChain)                                      // .eq('restaurant_id', ...)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });        // .eq('is_active', true)

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),  // .eq('restaurant_id', ...)
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(mockMatchResults);

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.fetchSlingUsersAndEmployees();
      });

      // Verify supabase from calls
      expect(mockSupabase.from).toHaveBeenCalledWith('sling_users');
      expect(mockSupabase.from).toHaveBeenCalledWith('employees');

      // matchEmployees should be called with derived csv names + employees
      expect(mockMatchEmployees).toHaveBeenCalledWith(
        [
          { name: 'Alice Smith', position: 'Server' },
          { name: 'Bob Jones', position: 'Cook' },
        ],
        mockEmployees
      );

      // State should be populated
      expect(result.current.slingUsers).toEqual(mockSlingUsers);
      expect(result.current.existingEmployees).toEqual(mockEmployees);
      expect(result.current.employeeMatches).toEqual(mockMatchResults);
    });

    it('throws when sling_users query errors', async () => {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: null, error: { message: 'relation not found' } });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await expect(
        act(() => result.current.fetchSlingUsersAndEmployees())
      ).rejects.toThrow('Failed to fetch Sling users: relation not found');
    });

    it('throws when employees query errors', async () => {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await expect(
        act(() => result.current.fetchSlingUsersAndEmployees())
      ).rejects.toThrow('Failed to fetch employees: permission denied');
    });
  });

  // =========================================================================
  // updateMatch
  // =========================================================================
  describe('updateMatch', () => {
    /**
     * Helper: seeds the hook state with fetchSlingUsersAndEmployees so that
     * employeeMatches and existingEmployees are populated.
     */
    async function seedHook() {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(mockMatchResults);

      const hookResult = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await hookResult.result.current.fetchSlingUsersAndEmployees();
      });

      // Reset from mock so subsequent calls go to default chain
      mockSupabase.from.mockReturnValue(mockFromChain);

      return hookResult;
    }

    it('updates a match with link action and sets employee info', async () => {
      const { result } = await seedHook();

      act(() => {
        result.current.updateMatch('bob jones', 'emp-1', 'link');
      });

      const bobMatch = result.current.employeeMatches.find(
        (m) => m.normalizedName === 'bob jones'
      );
      expect(bobMatch).toBeDefined();
      expect(bobMatch!.matchedEmployeeId).toBe('emp-1');
      expect(bobMatch!.matchedEmployeeName).toBe('Alice Smith');
      expect(bobMatch!.matchConfidence).toBe('exact');
      expect(bobMatch!.action).toBe('link');
    });

    it('updates a match with skip action and clears employee info', async () => {
      const { result } = await seedHook();

      act(() => {
        result.current.updateMatch('alice smith', null, 'skip');
      });

      const aliceMatch = result.current.employeeMatches.find(
        (m) => m.normalizedName === 'alice smith'
      );
      expect(aliceMatch).toBeDefined();
      expect(aliceMatch!.matchedEmployeeId).toBeNull();
      expect(aliceMatch!.matchedEmployeeName).toBeNull();
      expect(aliceMatch!.action).toBe('skip');
    });
  });

  // =========================================================================
  // createEmployeeAndMap (tested indirectly via createSingle)
  // =========================================================================
  describe('createSingle (createEmployeeAndMap)', () => {
    async function seedHook() {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(mockMatchResults);

      const hookResult = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await hookResult.result.current.fetchSlingUsersAndEmployees();
      });

      return hookResult;
    }

    it('creates an employee and mapping for an unmatched name', async () => {
      const { result } = await seedHook();

      const newEmp = { id: 'emp-new', name: 'Bob Jones', position: 'Cook', restaurant_id: RESTAURANT_ID };

      // Build per-table chains for the create operation
      const employeeInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newEmp, error: null }),
      };

      const mappingChain = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employees') return employeeInsertChain;
        if (table === 'employee_integration_mappings') return mappingChain;
        return mockFromChain;
      });

      await act(async () => {
        await result.current.createSingle('bob jones');
      });

      // Verify employee was created
      expect(employeeInsertChain.insert).toHaveBeenCalledWith({
        restaurant_id: RESTAURANT_ID,
        name: 'Bob Jones',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 0,
      });

      // Verify mapping was upserted
      expect(mappingChain.upsert).toHaveBeenCalledWith(
        {
          restaurant_id: RESTAURANT_ID,
          employee_id: 'emp-new',
          integration_type: 'sling',
          external_user_id: '102',
          external_user_name: 'Bob Jones',
        },
        { onConflict: 'restaurant_id,integration_type,external_user_id' }
      );

      // Verify the match was updated to 'link'
      const bobMatch = result.current.employeeMatches.find(
        (m) => m.normalizedName === 'bob jones'
      );
      expect(bobMatch!.matchedEmployeeId).toBe('emp-new');
      expect(bobMatch!.action).toBe('link');
      expect(result.current.isCreating).toBe(false);
    });

    it('does nothing when normalizedName is not found in matches', async () => {
      const { result } = await seedHook();

      mockSupabase.from.mockReturnValue(mockFromChain);

      await act(async () => {
        await result.current.createSingle('nonexistent name');
      });

      // No insert should have been called
      expect(mockFromChain.insert).not.toHaveBeenCalled();
    });

    it('throws when employee creation fails', async () => {
      const { result } = await seedHook();

      const employeeInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'duplicate key' },
        }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employees') return employeeInsertChain;
        return mockFromChain;
      });

      await expect(
        act(() => result.current.createSingle('bob jones'))
      ).rejects.toThrow('Failed to create employee Bob Jones: duplicate key');

      expect(result.current.isCreating).toBe(false);
    });

    it('throws when mapping upsert fails', async () => {
      const { result } = await seedHook();

      const newEmp = { id: 'emp-new', name: 'Bob Jones', position: 'Cook', restaurant_id: RESTAURANT_ID };

      const employeeInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newEmp, error: null }),
      };

      const mappingChain = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'constraint violation' },
        }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employees') return employeeInsertChain;
        if (table === 'employee_integration_mappings') return mappingChain;
        return mockFromChain;
      });

      await expect(
        act(() => result.current.createSingle('bob jones'))
      ).rejects.toThrow('Failed to create integration mapping for Bob Jones: constraint violation');

      expect(result.current.isCreating).toBe(false);
    });
  });

  // =========================================================================
  // bulkCreateAll
  // =========================================================================
  describe('bulkCreateAll', () => {
    async function seedHook() {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(mockMatchResults);

      const hookResult = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await hookResult.result.current.fetchSlingUsersAndEmployees();
      });

      return hookResult;
    }

    it('creates employees for all unmatched entries', async () => {
      const { result } = await seedHook();

      const newEmp = { id: 'emp-new', name: 'Bob Jones', position: 'Cook', restaurant_id: RESTAURANT_ID };

      const employeeInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newEmp, error: null }),
      };

      const mappingChain = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employees') return employeeInsertChain;
        if (table === 'employee_integration_mappings') return mappingChain;
        return mockFromChain;
      });

      await act(async () => {
        await result.current.bulkCreateAll();
      });

      // Bob Jones is 'none' confidence and action='create', so should be created
      expect(employeeInsertChain.insert).toHaveBeenCalledWith({
        restaurant_id: RESTAURANT_ID,
        name: 'Bob Jones',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 0,
      });

      expect(result.current.isCreating).toBe(false);
    });

    it('does nothing when all employees are already matched', async () => {
      // Seed with all-matched results
      const allMatchedResults = [
        {
          csvName: 'Alice Smith',
          normalizedName: 'alice smith',
          matchedEmployeeId: 'emp-1',
          matchedEmployeeName: 'Alice Smith',
          matchConfidence: 'exact' as const,
          csvPosition: 'Server',
          action: 'link' as const,
        },
      ];

      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(allMatchedResults);

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.fetchSlingUsersAndEmployees();
      });

      // Reset mock tracking
      mockSupabase.from.mockClear();
      mockSupabase.from.mockReturnValue(mockFromChain);

      await act(async () => {
        await result.current.bulkCreateAll();
      });

      // No employee inserts should occur
      expect(mockFromChain.insert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // confirmMappings
  // =========================================================================
  describe('confirmMappings', () => {
    async function seedHook() {
      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(mockMatchResults);

      const hookResult = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await hookResult.result.current.fetchSlingUsersAndEmployees();
      });

      return hookResult;
    }

    it('upserts all linked mappings and returns the count', async () => {
      const { result } = await seedHook();

      const mappingChain = {
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employee_integration_mappings') return mappingChain;
        return mockFromChain;
      });

      let count: number | undefined;
      await act(async () => {
        count = await result.current.confirmMappings();
      });

      // Only Alice is 'link' with matchedEmployeeId — Bob is action='create' not 'link'
      expect(count).toBe(1);
      expect(mappingChain.upsert).toHaveBeenCalledWith(
        [
          {
            restaurant_id: RESTAURANT_ID,
            employee_id: 'emp-1',
            integration_type: 'sling',
            external_user_id: '101',
            external_user_name: 'Alice Smith',
          },
        ],
        { onConflict: 'restaurant_id,integration_type,external_user_id' }
      );
    });

    it('returns 0 and does not upsert when no linked mappings exist', async () => {
      // Seed with no linked matches
      const noLinkedResults = [
        {
          csvName: 'Bob Jones',
          normalizedName: 'bob jones',
          matchedEmployeeId: null,
          matchedEmployeeName: null,
          matchConfidence: 'none' as const,
          csvPosition: 'Cook',
          action: 'create' as const,
        },
      ];

      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: mockSlingUsers, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockEmployees, error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue(noLinkedResults);

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.fetchSlingUsersAndEmployees();
      });

      // Reset from tracking
      mockSupabase.from.mockClear();
      mockSupabase.from.mockReturnValue(mockFromChain);

      let count: number | undefined;
      await act(async () => {
        count = await result.current.confirmMappings();
      });

      expect(count).toBe(0);
      // No upsert should be called when mappingsToWrite is empty
      expect(mockFromChain.upsert).not.toHaveBeenCalled();
    });

    it('throws when upsert fails', async () => {
      const { result } = await seedHook();

      const mappingChain = {
        upsert: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'upsert failed' },
        }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'employee_integration_mappings') return mappingChain;
        return mockFromChain;
      });

      await expect(
        act(() => result.current.confirmMappings())
      ).rejects.toThrow('Failed to save mappings: upsert failed');
    });
  });

  // =========================================================================
  // getSlingUserFullName edge cases (indirectly tested via fetchSlingUsersAndEmployees)
  // =========================================================================
  describe('getSlingUserFullName edge cases', () => {
    it('uses email when name and lastname are null', async () => {
      const emailOnlyUser = [
        {
          sling_user_id: 200,
          name: null,
          lastname: null,
          email: 'onlyemail@test.com',
          position: 'Host',
          is_active: true,
        },
      ];

      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: emailOnlyUser, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue([]);

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.fetchSlingUsersAndEmployees();
      });

      // matchEmployees should receive the email as the name
      expect(mockMatchEmployees).toHaveBeenCalledWith(
        [{ name: 'onlyemail@test.com', position: 'Host' }],
        []
      );
    });

    it('uses empty string when name, lastname, and email are all null', async () => {
      const emptyUser = [
        {
          sling_user_id: 300,
          name: null,
          lastname: null,
          email: null,
          position: null,
          is_active: true,
        },
      ];

      const slingChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      slingChain.eq
        .mockReturnValueOnce(slingChain)
        .mockResolvedValueOnce({ data: emptyUser, error: null });

      const empChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sling_users') return slingChain;
        if (table === 'employees') return empChain;
        return mockFromChain;
      });

      mockMatchEmployees.mockReturnValue([]);

      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.fetchSlingUsersAndEmployees();
      });

      expect(mockMatchEmployees).toHaveBeenCalledWith(
        [{ name: '', position: '' }],
        []
      );
    });
  });

  // =========================================================================
  // Initial state
  // =========================================================================
  describe('initial state', () => {
    it('returns empty arrays and false flags on mount', () => {
      const { result } = renderHook(() => useSlingEmployeeMapping(RESTAURANT_ID), {
        wrapper: createWrapper(),
      });

      expect(result.current.slingUsers).toEqual([]);
      expect(result.current.existingEmployees).toEqual([]);
      expect(result.current.employeeMatches).toEqual([]);
      expect(result.current.isCreating).toBe(false);
    });
  });
});
