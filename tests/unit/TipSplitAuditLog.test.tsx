import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TipSplitAuditLog } from '@/components/tips/TipSplitAuditLog';
import { supabase } from '@/integrations/supabase/client';
import React from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('TipSplitAuditLog', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should display loading state initially', () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
      }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: selectMock,
    } as any);

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    // Should show skeleton loaders
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('should display audit entries with user emails', async () => {
    const mockAuditData = [
      {
        id: 'audit-1',
        tip_split_id: 'split-123',
        action: 'created',
        changed_by: 'user-1',
        changed_at: '2024-01-06T10:00:00Z',
        changes: null,
        reason: null,
      },
      {
        id: 'audit-2',
        tip_split_id: 'split-123',
        action: 'approved',
        changed_by: 'user-2',
        changed_at: '2024-01-06T11:00:00Z',
        changes: { status: { old: 'draft', new: 'approved' } },
        reason: null,
      },
    ];

    const mockUsers = [
      { id: 'user-1', email: 'creator@example.com' },
      { id: 'user-2', email: 'approver@example.com' },
    ];

    // Mock audit log query
    const selectMock1 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockAuditData, error: null }),
      }),
    });

    // Mock profiles query
    const selectMock2 = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: mockUsers, error: null }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return { select: selectMock1 } as any;
      }
      if (table === 'profiles') {
        return { select: selectMock2 } as any;
      }
      return {} as any;
    });

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('creator@example.com')).toBeInTheDocument();
      expect(screen.getByText('approver@example.com')).toBeInTheDocument();
    });

    // Check actions are displayed
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('should display error state on query failure', async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ 
          data: null, 
          error: { message: 'Database error' } 
        }),
      }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: selectMock,
    } as any);

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Failed to load audit trail')).toBeInTheDocument();
    });
  });

  it('should display empty state when no audit entries exist', async () => {
    const selectMock1 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: selectMock1,
    } as any);

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('No audit history available')).toBeInTheDocument();
    });
  });

  it('should display reason when provided', async () => {
    const mockAuditData = [
      {
        id: 'audit-1',
        tip_split_id: 'split-123',
        action: 'reopened',
        changed_by: 'user-1',
        changed_at: '2024-01-06T10:00:00Z',
        changes: null,
        reason: 'Manager reopened for editing',
      },
    ];

    const mockUsers = [
      { id: 'user-1', email: 'manager@example.com' },
    ];

    const selectMock1 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockAuditData, error: null }),
      }),
    });

    const selectMock2 = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: mockUsers, error: null }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return { select: selectMock1 } as any;
      }
      if (table === 'profiles') {
        return { select: selectMock2 } as any;
      }
      return {} as any;
    });

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Manager reopened for editing')).toBeInTheDocument();
    });
  });

  it('should display changes when provided', async () => {
    const mockAuditData = [
      {
        id: 'audit-1',
        tip_split_id: 'split-123',
        action: 'modified',
        changed_by: 'user-1',
        changed_at: '2024-01-06T10:00:00Z',
        changes: { total_amount: { old: 15000, new: 15500 } },
        reason: null,
      },
    ];

    const mockUsers = [{ id: 'user-1', email: 'manager@example.com' }];

    const selectMock1 = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockAuditData, error: null }),
      }),
    });

    const selectMock2 = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: mockUsers, error: null }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'tip_split_audit') {
        return { select: selectMock1 } as any;
      }
      if (table === 'profiles') {
        return { select: selectMock2 } as any;
      }
      return {} as any;
    });

    render(<TipSplitAuditLog splitId="split-123" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/total_amount/)).toBeInTheDocument();
      expect(screen.getByText(/15000/)).toBeInTheDocument();
      expect(screen.getByText(/15500/)).toBeInTheDocument();
    });
  });
});
