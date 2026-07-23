import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const invokeMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useApproveClaimMutation, useRejectClaimMutation } from '@/hooks/useOpenShiftClaims';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  invokeMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { success: true }, error: null });
  invokeMock.mockResolvedValue({ data: { success: true }, error: null });
});

describe('useApproveClaimMutation', () => {
  it('invokes notify-open-shift-claim with action "approved" after RPC success', async () => {
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1', note: 'ok' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('notify-open-shift-claim', {
      body: { claimId: 'c1', action: 'approved' },
    });
  });

  it('still succeeds when the notify invoke resolves with an error (fire-and-forget)', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: '500' } });
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('still succeeds when the notify invoke rejects (transport failure)', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useApproveClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useRejectClaimMutation', () => {
  it('invokes notify with action "rejected" after RPC success', async () => {
    const { result } = renderHook(() => useRejectClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c2', note: 'no' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('notify-open-shift-claim', {
      body: { claimId: 'c2', action: 'rejected' },
    });
  });

  it('does NOT invoke notify when the RPC returns success:false', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'nope' }, error: null });
    const { result } = renderHook(() => useRejectClaimMutation(), { wrapper });
    result.current.mutate({ claimId: 'c2' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
