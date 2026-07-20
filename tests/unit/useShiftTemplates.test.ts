import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import {
  jsDateToDayOfWeek,
  templateAppliesToDay,
  useShiftTemplates,
} from '@/hooks/useShiftTemplates';
import { supabase } from '@/integrations/supabase/client';

const toastSpy = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useShiftTemplates helpers', () => {
  describe('jsDateToDayOfWeek', () => {
    it('should convert JS Sunday (0) to template Sunday (0)', () => {
      expect(jsDateToDayOfWeek(0)).toBe(0);
    });

    it('should convert JS Monday (1) to template Monday (1)', () => {
      expect(jsDateToDayOfWeek(1)).toBe(1);
    });

    it('should convert JS Saturday (6) to template Saturday (6)', () => {
      expect(jsDateToDayOfWeek(6)).toBe(6);
    });
  });

  describe('templateAppliesToDay', () => {
    it('should return true when day is in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(true); // Monday
    });

    it('should return false when day is not in template days', () => {
      const template = { days: [1, 2, 3, 4, 5] }; // weekdays
      expect(templateAppliesToDay(template, '2026-03-01')).toBe(false); // Sunday
    });

    it('should handle weekend-only templates', () => {
      const template = { days: [0, 6] }; // Sun, Sat
      expect(templateAppliesToDay(template, '2026-02-28')).toBe(true);  // Saturday
      expect(templateAppliesToDay(template, '2026-03-02')).toBe(false); // Monday
    });
  });
});

// ---------------------------------------------------------------------------
// Query builder mock helpers
// ---------------------------------------------------------------------------

type MockQueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  single?: ReturnType<typeof vi.fn>;
};

/** Builds a chainable mock that resolves `.order()` (select path) with `data`. */
function makeSelectBuilder(data: unknown[]): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

/**
 * Builds a chainable mock for `.update(...).eq('id', id).eq('restaurant_id', id)`
 * (no `.select()` chained). The mutation code calls `.eq('id', id)` once, then
 * conditionally a second `.eq('restaurant_id', restaurantId)` — so the object
 * returned by the first `.eq()` call must itself be both awaitable (thenable)
 * and further chainable via a second `.eq()`.
 */
function makeUpdateBuilder() {
  const resolved = Promise.resolve({ error: null });
  const chain = {
    eq: vi.fn().mockReturnValue(resolved),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  const eq = vi.fn().mockReturnValue(chain);
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq };
}

/**
 * Builds a chainable mock for
 * `.delete().eq('id', id).eq('restaurant_id', restaurantId).select('id')`,
 * resolving with the given `{ data, error }` result at the terminal `.select()`.
 */
function makeDeleteBuilder(result: { data: unknown[] | null; error: Error | null }) {
  const select = vi.fn().mockResolvedValue(result);
  const secondEq = vi.fn().mockReturnValue({ select });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const del = vi.fn().mockReturnValue({ eq: firstEq });
  return { delete: del, eq: firstEq, select };
}

describe('useShiftTemplates', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );

  describe('status filter', () => {
    it('defaults to status "active" and applies .eq(is_active, true)', async () => {
      const builder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(builder as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
      expect(builder.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('status "inactive" applies .eq(is_active, false)', async () => {
      const builder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(builder as any);

      const { result } = renderHook(
        () => useShiftTemplates('r1', { status: 'inactive' }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(builder.eq).toHaveBeenCalledWith('is_active', false);
      expect(builder.eq).not.toHaveBeenCalledWith('is_active', true);
    });

    it('status "all" applies no is_active filter', async () => {
      const builder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(builder as any);

      const { result } = renderHook(
        () => useShiftTemplates('r1', { status: 'all' }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
      expect(builder.eq).not.toHaveBeenCalledWith('is_active', true);
      expect(builder.eq).not.toHaveBeenCalledWith('is_active', false);
    });

    it('query key includes the status segment', async () => {
      const builder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(builder as any);

      renderHook(() => useShiftTemplates('r1', { status: 'all' }), { wrapper });

      await waitFor(() => {
        expect(
          queryClient.getQueryState(['shift_templates', 'r1', 'all']),
        ).toBeDefined();
      });
    });
  });

  describe('hideTemplate', () => {
    it('updates is_active: false for the given id', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update, eq } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 3 });
      });

      expect(update).toHaveBeenCalledWith({ is_active: false });
      expect(eq).toHaveBeenCalledWith('id', 't1');
      // Defense-in-depth: also scope the update by restaurant_id, matching the
      // restaurant_id filter every read query on this hook already applies.
      const chain = eq.mock.results[0].value;
      expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
    });

    it('invalidates the restaurant-scoped prefix (no status segment)', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 0 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['shift_templates', 'r1'],
      });
    });

    it('shows a toast with title, N-shift description, 8s duration, and an Undo action when keptShiftCount >= 1', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 3 });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '"Morning" hidden',
          description: '3 assigned shifts kept',
          duration: 8000,
          action: expect.anything(),
        }),
      );
    });

    it('uses singular "shift" when exactly 1 is kept', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 1 });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: '1 assigned shift kept' }),
      );
    });

    it('uses "Assigned shifts are kept" description when keptShiftCount is 0', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 0 });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Assigned shifts are kept' }),
      );
    });
  });

  describe('deleteTemplate', () => {
    it('deletes by id, scoped to restaurant_id, and confirms via .select("id")', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del, eq, select } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 });
      });

      expect(del).toHaveBeenCalled();
      expect(eq).toHaveBeenCalledWith('id', 't1');
      const chain = eq.mock.results[0].value;
      expect(chain.eq).toHaveBeenCalledWith('restaurant_id', 'r1');
      const secondChain = chain.eq.mock.results[0].value;
      expect(secondChain.select).toHaveBeenCalledWith('id');
      expect(select).toHaveBeenCalledWith('id');
    });

    it('invalidates the restaurant-scoped prefix on a real (>=1 row) delete', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['shift_templates', 'r1'],
      });
    });

    it('shows a normal (non-destructive) toast with the template name on success', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Closing Server', pendingClaimsCount: 0 });
      });

      expect(toastSpy).toHaveBeenCalledTimes(1);
      const call = toastSpy.mock.calls[0][0];
      expect(call.title).toBe('"Closing Server" deleted');
      expect(call.variant).not.toBe('destructive');
      expect(call.action).toBeUndefined();
    });

    it('describes 1 withdrawn pending claim in the singular', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 1 });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: '1 pending claim withdrawn' }),
      );
    });

    it('describes 2+ withdrawn pending claims in the plural', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Closing Server', pendingClaimsCount: 2 });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: '2 pending claims withdrawn' }),
      );
    });

    it('omits the claims description when no pending claims were withdrawn', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 });
      });

      const call = toastSpy.mock.calls[0][0];
      expect(call.description).toBeUndefined();
    });

    it('shows an info toast ("already removed") on a 0-row result and does NOT invalidate', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 3 });
      });

      expect(toastSpy).toHaveBeenCalledTimes(1);
      const call = toastSpy.mock.calls[0][0];
      expect(call.title).toBe('Template already removed');
      expect(call.variant).not.toBe('destructive');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('shows a destructive error toast and does NOT invalidate on failure', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({
        data: null,
        error: new Error('network down'),
      });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 }),
        ).rejects.toThrow('network down');
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'network down',
          variant: 'destructive',
        }),
      );
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe('restoreTemplate', () => {
    it('updates is_active: true for the given id', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update, eq } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.restoreTemplate('t1');
      });

      expect(update).toHaveBeenCalledWith({ is_active: true });
      expect(eq).toHaveBeenCalledWith('id', 't1');
    });

    it('invalidates the restaurant-scoped prefix (no status segment)', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.restoreTemplate('t1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['shift_templates', 'r1'],
      });
    });

    it('shows a "Template restored" toast', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { update } = makeUpdateBuilder();

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.restoreTemplate('t1');
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Template restored' }),
      );
    });
  });

  describe('create/update mutations still invalidate the prefix', () => {
    it('createTemplate invalidates ["shift_templates", restaurantId]', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const single = vi.fn().mockResolvedValue({ data: { id: 't1' }, error: null });
      const insertSelect = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select: insertSelect });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        insert,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.createTemplate({
          restaurant_id: 'r1',
          name: 'Morning',
          start_time: '08:00',
          end_time: '12:00',
          days: [1],
          is_active: true,
        } as any);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['shift_templates', 'r1'],
      });
    });

    it('updateTemplate invalidates ["shift_templates", restaurantId]', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const single = vi.fn().mockResolvedValue({ data: { id: 't1' }, error: null });
      const updateSelect = vi.fn().mockReturnValue({ single });
      // updateMutation chains .eq('id', id).eq('restaurant_id', id).select().single()
      const secondEq = vi.fn().mockReturnValue({ select: updateSelect });
      const update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: secondEq, select: updateSelect }),
      });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'New name' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['shift_templates', 'r1'],
      });
    });
  });
});
