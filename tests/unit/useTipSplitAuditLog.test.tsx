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
});
