import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock supabase client - move mocks before vi.mock calls
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Mock useToast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Import after mocking
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  useCollaboratorsQuery,
  useCollaboratorInvitesQuery,
  useSendCollaboratorInvitation,
  useCancelCollaboratorInvitation,
  useRemoveCollaborator,
  type Collaborator,
  type PendingInvite,
} from '@/hooks/useCollaborators';

// Test wrapper component
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Get mocked functions
const mockFrom = vi.mocked(supabase.from);
const mockInvoke = vi.mocked(supabase.functions.invoke);

describe('useCollaborators Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================
  // useCollaboratorsQuery Tests
  // ============================================================

  describe('useCollaboratorsQuery', () => {
    it('should not fetch when restaurantId is null', async () => {
      const { result } = renderHook(() => useCollaboratorsQuery(null), {
        wrapper: createWrapper(),
      });

      // Query should be disabled when restaurantId is null
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch collaborators for a restaurant', async () => {
      const mockCollaboratorData = [
        {
          id: 'ur-1',
          user_id: 'user-1',
          role: 'collaborator_accountant',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const mockProfileData = [
        {
          user_id: 'user-1',
          email: 'accountant@example.com',
          full_name: 'Test Accountant',
        },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'user_restaurants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                like: vi.fn().mockResolvedValue({ data: mockCollaboratorData, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: mockProfileData, error: null }),
            }),
          } as any;
        }
        return { select: vi.fn() } as any;
      });

      const { result } = renderHook(() => useCollaboratorsQuery('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([
        {
          id: 'ur-1',
          email: 'accountant@example.com',
          role: 'collaborator_accountant',
          createdAt: '2024-01-01T00:00:00Z',
          profileName: 'Test Accountant',
        },
      ]);
    });

    it('should handle error when fetching collaborators', async () => {
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Failed to fetch collaborators' },
            }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useCollaboratorsQuery('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it('should handle missing profile data gracefully', async () => {
      const mockCollaboratorData = [
        {
          id: 'ur-1',
          user_id: 'user-1',
          role: 'collaborator_inventory',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'user_restaurants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                like: vi.fn().mockResolvedValue({ data: mockCollaboratorData, error: null }),
              }),
            }),
          } as any;
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          } as any;
        }
        return { select: vi.fn() } as any;
      });

      const { result } = renderHook(() => useCollaboratorsQuery('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data?.[0].email).toBe('Unknown');
    });
  });

  // ============================================================
  // useCollaboratorInvitesQuery Tests
  // ============================================================

  describe('useCollaboratorInvitesQuery', () => {
    it('should not fetch when restaurantId is null', async () => {
      const { result } = renderHook(() => useCollaboratorInvitesQuery(null), {
        wrapper: createWrapper(),
      });

      // Query should be disabled when restaurantId is null
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch pending invitations for a restaurant', async () => {
      const mockInvitations = [
        {
          id: 'inv-1',
          email: 'pending@example.com',
          role: 'collaborator_chef',
          status: 'pending',
          created_at: '2024-01-01T00:00:00Z',
          expires_at: '2024-01-08T00:00:00Z',
          invited_by: 'owner-1',
        },
      ];

      const mockProfiles = [
        { user_id: 'owner-1', full_name: 'Restaurant Owner' },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'invitations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                like: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: mockInvitations, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: mockProfiles, error: null }),
            }),
          } as any;
        }
        return { select: vi.fn() } as any;
      });

      const { result } = renderHook(() => useCollaboratorInvitesQuery('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual([
        {
          id: 'inv-1',
          email: 'pending@example.com',
          role: 'collaborator_chef',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00Z',
          expiresAt: '2024-01-08T00:00:00Z',
          invitedBy: 'Restaurant Owner',
        },
      ]);
    });

    it('should handle error when fetching invitations', async () => {
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Failed to fetch invitations' },
              }),
            }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useCollaboratorInvitesQuery('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  // ============================================================
  // useSendCollaboratorInvitation Tests
  // ============================================================

  describe('useSendCollaboratorInvitation', () => {
    it('should send invitation successfully', async () => {
      mockInvoke.mockResolvedValue({ data: {}, error: null });

      const { result } = renderHook(() => useSendCollaboratorInvitation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          restaurantId: 'restaurant-1',
          email: 'new@example.com',
          role: 'collaborator_accountant',
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockInvoke).toHaveBeenCalledWith('send-team-invitation', {
        body: {
          restaurantId: 'restaurant-1',
          email: 'new@example.com',
          role: 'collaborator_accountant',
        },
      });
    });

    it('should handle error when sending invitation', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Failed to send' },
      });

      const { result } = renderHook(() => useSendCollaboratorInvitation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          restaurantId: 'restaurant-1',
          email: 'new@example.com',
          role: 'collaborator_inventory',
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  // ============================================================
  // useCancelCollaboratorInvitation Tests
  // ============================================================

  describe('useCancelCollaboratorInvitation', () => {
    it('should cancel invitation successfully', async () => {
      mockFrom.mockImplementation(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useCancelCollaboratorInvitation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          inviteId: 'inv-1',
          inviteEmail: 'pending@example.com',
          restaurantId: 'restaurant-1',
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should handle error when cancelling invitation', async () => {
      mockFrom.mockImplementation(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Failed to cancel' },
            }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useCancelCollaboratorInvitation(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          inviteId: 'inv-1',
          inviteEmail: 'pending@example.com',
          restaurantId: 'restaurant-1',
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  // ============================================================
  // useRemoveCollaborator Tests
  // ============================================================

  describe('useRemoveCollaborator', () => {
    it('should remove collaborator successfully', async () => {
      mockFrom.mockImplementation(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useRemoveCollaborator(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          collaboratorId: 'collab-1',
          collaboratorEmail: 'collab@example.com',
          restaurantId: 'restaurant-1',
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should handle error when removing collaborator', async () => {
      mockFrom.mockImplementation(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Failed to remove' },
            }),
          }),
        }),
      }) as any);

      const { result } = renderHook(() => useRemoveCollaborator(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          collaboratorId: 'collab-1',
          collaboratorEmail: 'collab@example.com',
          restaurantId: 'restaurant-1',
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  // ============================================================
  // Type Tests
  // ============================================================

  describe('Type Definitions', () => {
    it('Collaborator type should have all required fields', () => {
      const collaborator: Collaborator = {
        id: 'test-id',
        email: 'test@example.com',
        role: 'collaborator_accountant',
        createdAt: '2024-01-01T00:00:00Z',
        profileName: 'Test Name',
      };

      expect(collaborator.id).toBeDefined();
      expect(collaborator.email).toBeDefined();
      expect(collaborator.role).toBeDefined();
      expect(collaborator.createdAt).toBeDefined();
    });

    it('PendingInvite type should have all required fields', () => {
      const invite: PendingInvite = {
        id: 'invite-id',
        email: 'invite@example.com',
        role: 'collaborator_chef',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-08T00:00:00Z',
        invitedBy: 'Owner Name',
      };

      expect(invite.id).toBeDefined();
      expect(invite.email).toBeDefined();
      expect(invite.role).toBeDefined();
      expect(invite.status).toBeDefined();
      expect(invite.createdAt).toBeDefined();
    });

    it('PendingInvite status should be one of the allowed values', () => {
      const statuses: PendingInvite['status'][] = ['pending', 'accepted', 'expired', 'cancelled'];

      for (const status of statuses) {
        const invite: PendingInvite = {
          id: 'id',
          email: 'test@example.com',
          role: 'collaborator_inventory',
          status,
          createdAt: '2024-01-01',
        };
        expect(invite.status).toBe(status);
      }
    });
  });
});
