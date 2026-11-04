import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

import type { TemplateShiftSnapshot } from '@/types/scheduling';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
  toast: vi.fn(),
  /** When true, the list query never resolves (a refetch in flight). */
  hangList: false,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      select: (cols: string) => {
        mocks.select(cols);
        return {
          eq: () => ({
            order: () => (mocks.hangList ? new Promise(() => {}) : Promise.resolve({ data: [], error: null })),
          }),
        };
      },
    })),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { useSchedulePlanTemplates, MAX_SCHEDULE_PLAN_TEMPLATES } from '@/hooks/useSchedulePlanTemplates';

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

const shifts: TemplateShiftSnapshot[] = [
  {
    day_offset: 0,
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 30,
    position: 'Server',
    employee_id: 'emp-1',
    employee_name: 'Alice',
    notes: null,
  },
];

describe('useSchedulePlanTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hangList = false;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
  });

  it('exports a limit of 20 templates', () => {
    expect(MAX_SCHEDULE_PLAN_TEMPLATES).toBe(20);
  });

  it('selects explicit columns, not *', async () => {
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', 'UTC'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.select).toHaveBeenCalledWith('id, restaurant_id, name, shifts, shift_count, created_at, updated_at');
  });

  it('createTemplate calls save_schedule_plan_template with the snapshot and returns the row', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { id: 't-1', name: 'Lunch', shift_count: 1, updated_at: '2026-10-06T10:00:00.123456+00:00' },
      error: null,
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', 'UTC'), { wrapper });

    let out: unknown;
    await act(async () => {
      out = await result.current.createTemplate.mutateAsync({ name: 'Lunch', shifts });
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_schedule_plan_template', {
      p_restaurant_id: 'rest-1',
      p_name: 'Lunch',
      p_shifts: shifts,
    });
    expect(out).toMatchObject({ id: 't-1', updated_at: '2026-10-06T10:00:00.123456+00:00' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedule-plan-templates', 'rest-1'] });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Template saved' }));
  });

  it('updateTemplate sends the raw updated_at string unchanged', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { id: 't-1', name: 'Lunch', shift_count: 1, updated_at: '2026-10-06T11:00:00.654321+00:00' },
      error: null,
    });
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', 'UTC'), { wrapper });

    let out: unknown;
    await act(async () => {
      out = await result.current.updateTemplate.mutateAsync({
        id: 't-1',
        name: 'Lunch',
        shifts,
        expectedUpdatedAt: '2026-10-06T10:00:00.123456+00:00',
      });
    });

    expect(mocks.rpc).toHaveBeenCalledWith('update_schedule_plan_template', {
      p_restaurant_id: 'rest-1',
      p_template_id: 't-1',
      p_name: 'Lunch',
      p_shifts: shifts,
      p_expected_updated_at: '2026-10-06T10:00:00.123456+00:00',
    });
    expect(out).toMatchObject({ updated_at: '2026-10-06T11:00:00.654321+00:00' });
  });

  it('updateTemplate shows the server error in a destructive toast', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Template was changed by another user. Reload and try again.' },
    });
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', 'UTC'), { wrapper });

    await act(async () => {
      await expect(
        result.current.updateTemplate.mutateAsync({ id: 't-1', name: 'L', shifts, expectedUpdatedAt: 'x' }),
      ).rejects.toBeTruthy();
    });

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Failed to save template',
        description: 'Template was changed by another user. Reload and try again.',
        variant: 'destructive',
      }),
    );
  });

  it('deleteTemplate removes the row from the cache at once, so no stale row can be selected again', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.hangList = true; // the refetch after the delete stays in flight
    queryClient.setQueryData(['schedule-plan-templates', 'rest-1'], [{ id: 't-1' }, { id: 't-2' }]);
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', 'UTC'), { wrapper });

    await act(async () => {
      await result.current.deleteTemplate.mutateAsync('t-1');
    });

    expect(mocks.rpc).toHaveBeenCalledWith('delete_schedule_plan_template', {
      p_restaurant_id: 'rest-1',
      p_template_id: 't-1',
    });
    const cached = queryClient.getQueryData<{ id: string }[]>(['schedule-plan-templates', 'rest-1']) ?? [];
    expect(cached.map((t) => t.id)).toEqual(['t-2']);
    mocks.hangList = false;
  });
});
