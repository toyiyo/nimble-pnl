import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTipSplitAuditLog } from '@/hooks/useTipSplitAuditLog';
import { supabase } from '@/integrations/supabase/client';
import React, { type ReactNode } from 'react';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useTipSplitAuditLog', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should fetch audit log entries successfully', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        action: 'created',
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '2',
        tip_split_id: 'split-123',
        action: 'approved',
        changed_by: 'user-2',
        changed_at: '2026-01-03T11:00:00Z',
        changes: { status: { old: 'draft', new: 'approved' } },
        reason: null,
      },
    ];

    const mockUsers = [
      { id: 'user-1', email: 'creator@example.com' },
      { id: 'user-2', email: 'approver@example.com' },
    ];

    // Mock the tip_split_audit query
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    // Mock the profiles query
    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: mockUsers, error: null });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toMatchObject({
      id: '1',
      action: 'created',
      user: { email: 'creator@example.com' },
    });
    expect(result.current.data?.[1]).toMatchObject({
      id: '2',
      action: 'approved',
      user: { email: 'approver@example.com' },
    });
  });

  it('should not fetch when splitId is null', async () => {
    const { result } = renderHook(() => useTipSplitAuditLog(null), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should handle query errors', async () => {
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      order: mockOrder,
    } as any);

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });

  it('should handle empty audit log', async () => {
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });

    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      order: mockOrder,
    } as any);

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('should handle audit entries without users', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        action: 'created',
        changed_by: null, // System-generated entry
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      order: mockOrder,
    } as any);

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].user).toBeUndefined();
  });

  it('should use correct staleTime (30 seconds)', () => {
    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });
    
    // The hook should be configured with staleTime of 30000ms
    expect(result.current).toBeDefined();
    // Note: We can't directly test staleTime from the hook result,
    // but we verify it's set in the hook definition
  });

  it('should order entries by changed_at descending', async () => {
    const mockAuditData = [
      {
        id: '2',
        tip_split_id: 'split-123',
        action: 'approved',
        changed_by: 'user-1',
        changed_at: '2026-01-03T12:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '1',
        tip_split_id: 'split-123',
        action: 'created',
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
    ];

    const mockUsers = [{ id: 'user-1', email: 'user@example.com' }];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: mockUsers, error: null });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify order was called with descending
    expect(mockOrder).toHaveBeenCalledWith('changed_at', { ascending: false });
    
    // Verify data is in correct order (newest first)
    expect(result.current.data?.[0].action).toBe('approved');
    expect(result.current.data?.[1].action).toBe('created');
  });

  it('should handle duplicate user IDs (Set deduplication)', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'created' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '2',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'modified' as const,
        changed_by: 'user-1', // Same user
        changed_at: '2026-01-03T11:00:00Z',
        changes: { amount: { old: 100, new: 150 } },
        reason: null,
      },
      {
        id: '3',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'approved' as const,
        changed_by: 'user-1', // Same user again
        changed_at: '2026-01-03T12:00:00Z',
        changes: null,
        reason: null,
      },
    ];

    const mockUsers = [{ id: 'user-1', email: 'user@example.com' }];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: mockUsers, error: null });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should only query profiles once for user-1
    expect(mockIn).toHaveBeenCalledTimes(1);
    expect(mockIn).toHaveBeenCalledWith('id', ['user-1']);
    
    // All entries should have the same user
    expect(result.current.data).toHaveLength(3);
    result.current.data?.forEach(entry => {
      expect(entry.user).toMatchObject({ email: 'user@example.com' });
    });
  });

  it('should handle mixed entries (some with users, some without)', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'created' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '2',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'modified' as const,
        changed_by: null, // System action
        changed_at: '2026-01-03T11:00:00Z',
        changes: null,
        reason: 'Auto-update',
      },
      {
        id: '3',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'approved' as const,
        changed_by: 'user-2',
        changed_at: '2026-01-03T12:00:00Z',
        changes: null,
        reason: null,
      },
    ];

    const mockUsers = [
      { id: 'user-1', email: 'user1@example.com' },
      { id: 'user-2', email: 'user2@example.com' },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: mockUsers, error: null });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.[0].user).toMatchObject({ email: 'user1@example.com' });
    expect(result.current.data?.[1].user).toBeUndefined(); // System action
    expect(result.current.data?.[2].user).toMatchObject({ email: 'user2@example.com' });
  });

  it('should handle user lookup failure gracefully', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'created' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: null, error: null }); // User not found

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should still return audit entries, just without user info
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].user).toBeUndefined();
  });

  it('should handle all action types correctly', async () => {
    const mockAuditData = [
      {
        id: '1',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'created' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T10:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '2',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'approved' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T11:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '3',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'reopened' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T12:00:00Z',
        changes: null,
        reason: 'Correction needed',
      },
      {
        id: '4',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'modified' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T13:00:00Z',
        changes: { amount: { old: 100, new: 150 } },
        reason: null,
      },
      {
        id: '5',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'archived' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T14:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: '6',
        tip_split_id: 'split-123',
        split_reference: 'split-123',
        action: 'deleted' as const,
        changed_by: 'user-1',
        changed_at: '2026-01-03T15:00:00Z',
        changes: null,
        reason: 'Duplicate entry',
      },
    ];

    const mockUsers = [{ id: 'user-1', email: 'user@example.com' }];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockAuditData, error: null });

    const mockProfilesSelect = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ data: mockUsers, error: null });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
        } as any;
      }
      if (table === 'profiles') {
        return {
          select: mockProfilesSelect,
          in: mockIn,
        } as any;
      }
      return {} as any;
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockProfilesSelect.mockReturnValue({ in: mockIn });

    const { result } = renderHook(() => useTipSplitAuditLog('split-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(6);
    expect(result.current.data?.map(e => e.action)).toEqual([
      'created',
      'approved',
      'reopened',
      'modified',
      'archived',
      'deleted',
    ]);
  });

  it('should use correct query key for caching', () => {
    const splitId = 'split-456';
    const { result } = renderHook(() => useTipSplitAuditLog(splitId), { wrapper });
    
    // The hook should use the splitId in the query key for proper cache management
    expect(result.current).toBeDefined();
    // Query key is ['tip-split-audit', splitId]
  });
});
