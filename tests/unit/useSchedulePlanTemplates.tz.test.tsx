import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

import type { Shift, SchedulePlanTemplate } from '@/types/scheduling';

const { mockRpc, mockToast } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockToast: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return { supabase: { from: () => chain, rpc: mockRpc } };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { useSchedulePlanTemplates } from '@/hooks/useSchedulePlanTemplates';

const CHICAGO = 'America/Chicago';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeTemplate(): SchedulePlanTemplate {
  return {
    id: 'tpl-1',
    restaurant_id: 'rest-1',
    name: 'Week A',
    shifts: [
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
    ],
    shift_count: 1,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  } satisfies SchedulePlanTemplate;
}

// The browser zone (Asia/Tokyo) is not the restaurant zone (America/Chicago).
describe('useSchedulePlanTemplates with the restaurant zone', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    mockRpc.mockReset();
    mockToast.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('saves restaurant-local wall clocks', async () => {
    mockRpc.mockResolvedValue({ data: 'tpl-1', error: null });
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', CHICAGO), { wrapper });

    const shift = {
      id: 's1',
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      start_time: '2026-03-30T14:00:00Z', // Mon 09:00 CDT
      end_time: '2026-03-30T22:00:00Z',
      break_duration: 30,
      position: 'Server',
      notes: null,
      status: 'scheduled',
      employee: { name: 'Alice' },
    } as unknown as Shift;

    await act(async () => {
      await result.current.saveTemplate.mutateAsync({
        name: 'Week A',
        shifts: [shift],
        weekStart: new Date(2026, 2, 30),
      });
    });

    expect(mockRpc).toHaveBeenCalledWith('save_schedule_plan_template', {
      p_restaurant_id: 'rest-1',
      p_name: 'Week A',
      p_shifts: [expect.objectContaining({ day_offset: 0, start_time: '09:00:00', end_time: '17:00:00' })],
    });
  });

  it('applies shifts and the replace window in the restaurant zone', async () => {
    mockRpc.mockResolvedValue({
      data: { inserted_count: 1, skipped_count: 0, deleted_count: 0 },
      error: null,
    });
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', CHICAGO), { wrapper });

    await act(async () => {
      await result.current.applyTemplate.mutateAsync({
        template: makeTemplate(),
        targetMonday: new Date(2026, 3, 6),
        mergeMode: 'replace',
      });
    });

    expect(mockRpc).toHaveBeenCalledWith('apply_schedule_plan_template', {
      p_restaurant_id: 'rest-1',
      p_target_start: '2026-04-06T05:00:00.000Z',
      p_target_end: '2026-04-13T04:59:59.999Z',
      p_shifts: [
        expect.objectContaining({
          start_time: '2026-04-06T14:00:00.000Z',
          end_time: '2026-04-06T22:00:00.000Z',
        }),
      ],
      p_merge_mode: 'replace',
    });
  });

  it('shows the clear message for a bad stored time and does not call the RPC', async () => {
    const { result } = renderHook(() => useSchedulePlanTemplates('rest-1', CHICAGO), { wrapper });
    const template = makeTemplate();
    template.shifts[0].start_time = '9am';

    await act(async () => {
      await expect(
        result.current.applyTemplate.mutateAsync({
          template,
          targetMonday: new Date(2026, 3, 6),
          mergeMode: 'merge',
        }),
      ).rejects.toThrow('This template has an invalid shift time.');
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'This template has an invalid shift time.' }),
    );
  });
});
