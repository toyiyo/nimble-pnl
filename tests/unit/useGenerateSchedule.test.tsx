import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/functions-js';
import type { ReactNode } from 'react';

const { toastMock, invokeMock, insertMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  invokeMock: vi.fn(),
  insertMock: vi.fn(),
}));

// Mock the toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    from: () => ({ insert: insertMock }),
  },
}));

import { useGenerateSchedule } from '@/hooks/useGenerateSchedule';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toastMock.mockClear();
  invokeMock.mockReset();
  insertMock.mockReset();
});

describe('useGenerateSchedule — 422 diagnostic path', () => {
  it('extracts diagnostic from FunctionsHttpError.context and shows single-line toast', async () => {
    const diagnostic = {
      total_employees: 30,
      total_templates: 12,
      total_required_slots: 48,
      total_generated: 24,
      total_dropped: 24,
      drop_reason_summary: { POSITION_MISMATCH: 18, UNAVAILABLE_DAY: 6 },
      model_used: 'Gemini 2.5 Flash',
    };
    const responseBody = { error: 'AI generated no valid shifts.', diagnostic };
    // Construct a FunctionsHttpError carrying that body as the Response context.
    const fakeResponse = {
      json: () => Promise.resolve(responseBody),
    } as unknown as Response;
    const err = new FunctionsHttpError(fakeResponse);
    invokeMock.mockResolvedValueOnce({ data: null, error: err });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'America/Chicago',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const call = toastMock.mock.calls[0][0];
    expect(call.variant).toBe('destructive');
    expect(call.description).toContain('0 of 48');
    expect(call.description).toContain('POSITION_MISMATCH');
  });

  it('falls back to error.message for non-422 errors', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: new Error('Network failure'),
    });
    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0].description).toContain('Network failure');
  });
});
