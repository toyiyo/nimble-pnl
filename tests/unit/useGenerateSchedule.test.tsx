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
    // Distinguish "AI returned plenty, all dropped" from "AI returned nothing".
    expect(call.description).toContain('AI proposed 24, all dropped');
  });

  it('omits "AI proposed" suffix when total_generated is 0', async () => {
    const diagnostic = {
      total_employees: 30,
      total_templates: 12,
      total_required_slots: 48,
      total_generated: 0,
      total_dropped: 0,
      drop_reason_summary: {},
      model_used: 'Gemini 2.5 Flash',
    };
    const fakeResponse = {
      json: () => Promise.resolve({ error: 'AI generated nothing.', diagnostic }),
    } as unknown as Response;
    invokeMock.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(fakeResponse) });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0].description).not.toContain('AI proposed');
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

describe('useGenerateSchedule — partial-fill success toast', () => {
  it('shows "Filled X of Y required" when less than required slots are filled', async () => {
    const generatedShift = {
      employee_id: 'emp-1',
      template_id: 'tmpl-1',
      day: '2026-05-18',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'server',
    };
    invokeMock.mockResolvedValueOnce({
      data: {
        shifts: [generatedShift, generatedShift, generatedShift],
        metadata: {
          estimated_cost: 0,
          budget_variance_pct: 0,
          notes: '',
          model_used: 'Gemini 2.5 Flash',
          total_generated: 5,
          total_valid: 3,
          total_dropped: 2,
          total_required_slots: 10,
          drop_reason_summary: { UNAVAILABLE_DAY: 2 },
          dropped_reasons: [],
        },
      },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0].title).toBe('Schedule Generated');
    expect(toastMock.mock.calls[0][0].description).toContain('Filled 3 of 10 required slots');
  });

  it('falls back to plain count when required slots is 0', async () => {
    const generatedShift = {
      employee_id: 'emp-1',
      template_id: 'tmpl-1',
      day: '2026-05-18',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'server',
    };
    invokeMock.mockResolvedValueOnce({
      data: {
        shifts: [generatedShift, generatedShift],
        metadata: {
          estimated_cost: 0,
          budget_variance_pct: 0,
          notes: '',
          model_used: 'Gemini 2.5 Flash',
          total_generated: 2,
          total_valid: 2,
          total_dropped: 0,
          total_required_slots: 0,
          drop_reason_summary: {},
          dropped_reasons: [],
        },
      },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0].description).toContain('2 shifts created');
    expect(toastMock.mock.calls[0][0].description).not.toContain('Filled 2 of');
  });
});

// ── Bug B regression: persist shift_template_id on insert ─────────────────
// Without this, every AI-generated shift in `shifts` had shift_template_id
// = NULL, and the planner's template-id bucket fell back to time/position
// matching — which collided across areas (Cold Stone open vs Wetzel's open).
describe('useGenerateSchedule — persist shift_template_id', () => {
  function mockSuccessfulInvoke(shift: Record<string, unknown>) {
    invokeMock.mockResolvedValueOnce({
      data: {
        shifts: [shift],
        metadata: {
          estimated_cost: 0,
          budget_variance_pct: 0,
          notes: '',
          model_used: 'Gemini 2.5 Flash',
          total_generated: 1,
          total_valid: 1,
          total_dropped: 0,
          total_required_slots: 1,
          drop_reason_summary: {},
          dropped_reasons: [],
        },
      },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
  }

  it('persists shift_template_id from the LLM response', async () => {
    mockSuccessfulInvoke({
      employee_id: 'emp-1',
      template_id: 'tmpl-open-csc',
      day: '2026-06-01',
      start_time: '10:00:00',
      end_time: '16:30:00',
      position: 'server',
    });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-06-01',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    const rows = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_template_id).toBe('tmpl-open-csc');
  });

  it('coerces empty-string template_id to null on insert', async () => {
    mockSuccessfulInvoke({
      employee_id: 'emp-1',
      template_id: '',
      day: '2026-06-01',
      start_time: '10:00:00',
      end_time: '16:30:00',
      position: 'server',
    });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-06-01',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    const rows = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].shift_template_id).toBeNull();
  });

  it('coerces whitespace-only template_id to null on insert', async () => {
    mockSuccessfulInvoke({
      employee_id: 'emp-1',
      template_id: '   ',
      day: '2026-06-01',
      start_time: '10:00:00',
      end_time: '16:30:00',
      position: 'server',
    });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-06-01',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    const rows = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].shift_template_id).toBeNull();
  });
});
