import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const invokeMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { useBroadcastOpenShifts, buildBroadcastToast } from '@/hooks/useBroadcastOpenShifts';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const result = (over: Partial<Parameters<typeof buildBroadcastToast>[0]> = {}) => ({
  success: true,
  open_shifts: 4,
  push_sent: 10,
  push_failed: 0,
  email_recipients: 12,
  email_sent: 12,
  email_failed: 0,
  email_rate_limited: 0,
  total_employees: 25,
  ...over,
});

describe('buildBroadcastToast', () => {
  it('reports plain success when every email went out', () => {
    expect(buildBroadcastToast(result())).toEqual({
      title: 'Broadcast sent',
      description: 'Notified 25 team members about 4 open shifts.',
    });
  });

  it('names the email denominator when some failed', () => {
    const toast = buildBroadcastToast(result({ email_sent: 9, email_failed: 3 }));

    // "3 of 12", not "3 of 25": total_employees counts everyone, but only the
    // 12 with an address were ever emailed.
    expect(toast.description).toBe(
      'Notified 25 team members about 4 open shifts. 3 of 12 emails failed to send.',
    );
    expect(toast.variant).toBeUndefined();
  });

  it('stays grammatical for a single failure without a plural branch', () => {
    expect(buildBroadcastToast(result({ email_sent: 11, email_failed: 1 })).description).toContain(
      '1 of 12 emails failed to send.',
    );
  });

  it('goes destructive when no email got through at all', () => {
    const toast = buildBroadcastToast(result({ email_sent: 0, email_failed: 12 }));

    expect(toast).toEqual({
      title: 'Broadcast sent, but no emails went out',
      description: 'Push notifications were sent. All 12 emails failed to send.',
      variant: 'destructive',
    });
  });

  it('reports plain success when there was no email channel to fail', () => {
    const toast = buildBroadcastToast(
      result({ email_recipients: 0, email_sent: 0, email_failed: 0 }),
    );

    expect(toast.variant).toBeUndefined();
    expect(toast.description).toBe('Notified 25 team members about 4 open shifts.');
  });

  it('degrades to the plain message when the function predates these fields', () => {
    const toast = buildBroadcastToast({
      success: true,
      open_shifts: 4,
      push_sent: 10,
      push_failed: 0,
      email_sent: 12,
      email_failed: 0,
      total_employees: 25,
    });

    expect(toast.description).toBe('Notified 25 team members about 4 open shifts.');
  });

  it('does not go destructive on stale-function skew even when email_failed is nonzero', () => {
    // Rolling-deploy skew: an old function build can emit email_failed > 0
    // without ever including email_recipients.
    // `?? 0` on a missing denominator must not make failed >= recipients trivially true.
    const toast = buildBroadcastToast({
      success: true,
      open_shifts: 4,
      push_sent: 10,
      push_failed: 0,
      email_sent: 9,
      email_failed: 3,
      total_employees: 25,
    });

    expect(toast).toEqual({
      title: 'Broadcast sent',
      description: 'Notified 25 team members about 4 open shifts.',
    });
  });
});

describe('useBroadcastOpenShifts', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastMock.mockReset();
  });

  it('surfaces partial email failure through the toast', async () => {
    invokeMock.mockResolvedValue({
      data: result({ email_sent: 9, email_failed: 3, email_rate_limited: 3 }),
      error: null,
    });

    const { result: hook } = renderHook(() => useBroadcastOpenShifts(), { wrapper });
    hook.current.mutate({ restaurantId: 'r1', publicationId: 'p1' });

    await waitFor(() => expect(hook.current.isSuccess).toBe(true));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('3 of 12 emails failed to send.'),
      }),
    );
  });

  it('reports the error message when the invoke itself fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result: hook } = renderHook(() => useBroadcastOpenShifts(), { wrapper });
    hook.current.mutate({ restaurantId: 'r1', publicationId: 'p1' });

    await waitFor(() => expect(hook.current.isError).toBe(true));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Broadcast failed', variant: 'destructive' }),
    );
  });
});
