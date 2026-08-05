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
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
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
    it('CRITICAL: deletes by id, scoped to restaurant_id, and confirms via .select("id")', async () => {
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

    it('CRITICAL: rejects without querying supabase when restaurantId is null (never deletes unscoped)', async () => {
      const selectBuilder = makeSelectBuilder([]);
      const { delete: del } = makeDeleteBuilder({ data: [{ id: 't1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates(null), { wrapper });

      await act(async () => {
        await expect(
          result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 }),
        ).rejects.toThrow('Restaurant context is required to delete a template');
      });

      expect(del).not.toHaveBeenCalled();
    });
  });

  // Control-group gating (design doc "Friction & gating rules"): the delete
  // dialog disables Delete+Hide on `isDeleting || isHiding`, so the hook must
  // expose the underlying mutation pending state, not just the callbacks.
  describe('isDeleting / isHiding (control-group gating flags)', () => {
    it('isDeleting is false at rest, true while the delete mutation is in flight, false after it settles', async () => {
      const selectBuilder = makeSelectBuilder([]);
      let resolveSelect!: (value: { data: unknown[]; error: null }) => void;
      const pendingSelect = new Promise<{ data: unknown[]; error: null }>((resolve) => {
        resolveSelect = resolve;
      });
      const secondEq = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(pendingSelect) });
      const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
      const del = vi.fn().mockReturnValue({ eq: firstEq });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        delete: del,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isDeleting).toBe(false);

      let deletePromise!: Promise<unknown>;
      act(() => {
        deletePromise = result.current.deleteTemplate({ id: 't1', name: 'Morning', pendingClaimsCount: 0 });
      });

      await waitFor(() => expect(result.current.isDeleting).toBe(true));

      await act(async () => {
        resolveSelect({ data: [{ id: 't1' }], error: null });
        await deletePromise;
      });

      await waitFor(() => expect(result.current.isDeleting).toBe(false));
    });

    it('isHiding is false at rest, true while the hide mutation is in flight, false after it settles', async () => {
      const selectBuilder = makeSelectBuilder([]);
      let resolveUpdate!: (value: { error: null }) => void;
      const pendingUpdate = new Promise<{ error: null }>((resolve) => {
        resolveUpdate = resolve;
      });
      // `.update(...).eq('id', id).eq('restaurant_id', id)` — the second `.eq()`
      // call must itself return the deferred, awaitable promise.
      const secondEq = vi.fn().mockReturnValue(pendingUpdate);
      const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
      const update = vi.fn().mockReturnValue({ eq: firstEq });

      vi.mocked(supabase.from).mockReturnValue({
        ...selectBuilder,
        update,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isHiding).toBe(false);

      let hidePromise!: Promise<unknown>;
      act(() => {
        hidePromise = result.current.hideTemplate({ id: 't1', name: 'Morning', keptShiftCount: 0 });
      });

      await waitFor(() => expect(result.current.isHiding).toBe(true));

      await act(async () => {
        resolveUpdate({ error: null });
        await hidePromise;
      });

      await waitFor(() => expect(result.current.isHiding).toBe(false));
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
      vi.mocked(supabase.from).mockReturnValue(selectBuilder as any);
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { batch_id: null, updated_count: 0, published_shifts: [], skipped_count: 0 },
        error: null,
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

  describe('updateTemplate cascade RPC', () => {
    beforeEach(() => {
      const selectBuilder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(selectBuilder as any);
    });

    it('calls update_shift_template_with_cascade with the template fields, cascade flag, and drifted ids', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { batch_id: null, updated_count: 0, published_shifts: [], skipped_count: 0 },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          position: 'Server',
          area: 'Patio',
          days: [1, 2],
          break_duration: 30,
          capacity: 2,
          start_time: '08:00',
          end_time: '12:00',
          cascade: true,
          driftedShiftIds: ['s1', 's2'],
        });
      });

      expect(supabase.rpc).toHaveBeenCalledWith('update_shift_template_with_cascade', {
        p_template_id: 't1',
        p_restaurant_id: 'r1',
        p_name: 'Morning',
        p_position: 'Server',
        p_area: 'Patio',
        p_days: [1, 2],
        p_break_duration: 30,
        p_capacity: 2,
        p_start_time: '08:00',
        p_end_time: '12:00',
        p_cascade: true,
        p_drifted_shift_ids: ['s1', 's2'],
      });
    });

    it('defaults p_area to null, p_cascade to false, and p_drifted_shift_ids to [] when omitted', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { batch_id: null, updated_count: 0, published_shifts: [], skipped_count: 0 },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'Morning' });
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'update_shift_template_with_cascade',
        expect.objectContaining({
          p_area: null,
          p_cascade: false,
          p_drifted_shift_ids: [],
        }),
      );
    });

    it('shows a plain "Template updated" toast (no Undo action) when updated_count is 0', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { batch_id: null, updated_count: 0, published_shifts: [], skipped_count: 0 },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'Morning' });
      });

      expect(toastSpy).toHaveBeenCalledWith({ title: 'Template updated', description: undefined });
    });

    it('still explains the shortfall when a cascading save promised shifts but moved none', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { batch_id: null, updated_count: 0, published_shifts: [], skipped_count: 3 },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          cascade: true,
          promisedCount: 3,
        });
      });

      // A bare "Template updated" after clicking "Save & update 3 shifts"
      // reads as if the shifts moved. No Undo — there is no batch to undo.
      const call = toastSpy.mock.calls.at(-1)![0];
      expect(call.title).toBe('Template updated');
      expect(call.description).toBe(
        'You expected 3, but none were still eligible when it saved.'
      );
      expect(call.action).toBeUndefined();
    });

    it('shows the moved-shifts toast with an Undo action when the cascade updates shifts', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 3,
          published_shifts: [],
          skipped_count: 0,
        },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'Morning', cascade: true });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Template updated',
          description: '3 shifts moved to the new hours.',
          duration: 8000,
          action: expect.anything(),
        }),
      );
    });

    it('appends the shortfall sentence when the cascade updated fewer shifts than the dialog promised', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 2,
          published_shifts: [],
          skipped_count: 1,
        },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          cascade: true,
          promisedCount: 3,
        });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Template updated',
          description: '2 shifts moved to the new hours. You expected 3, but only 2 were still eligible when it saved.',
        }),
      );
    });

    it('does not append a shortfall sentence when the promised and updated counts match', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 3,
          published_shifts: [],
          skipped_count: 0,
        },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          cascade: true,
          promisedCount: 3,
        });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Template updated',
          description: '3 shifts moved to the new hours.',
        }),
      );
    });

    it('maps a 23505 (unique_violation) rejection to a friendly slot-collision message', async () => {
      const conflictError = Object.assign(new Error(
        'duplicate key value violates unique constraint "uq_shift_templates_active_slot"',
      ), { code: '23505' });
      vi.mocked(supabase.rpc).mockRejectedValueOnce(conflictError);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateTemplate({ id: 't1', name: 'Morning' }),
        ).rejects.toThrow();
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Another active template already uses these hours for this position. Pick a different time or position, or update that template instead.',
          variant: 'destructive',
        }),
      );
    });

    it('surfaces error.message unchanged for a non-23505 rejection', async () => {
      vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateTemplate({ id: 't1', name: 'Morning' }),
        ).rejects.toThrow('network down');
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'network down',
          variant: 'destructive',
        }),
      );
    });

    it('invokes send-shift-notification with action "modified" and the previous hours for each published shift when notify is true', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 2,
          published_shifts: [
            { id: 's1', previous_start_time: '2026-03-10T14:00:00+00:00', previous_end_time: '2026-03-10T22:00:00+00:00', previous_position: 'Server' },
            { id: 's2', previous_start_time: '2026-03-11T14:00:00+00:00', previous_end_time: '2026-03-11T22:00:00+00:00', previous_position: 'Server' },
          ],
          skipped_count: 0,
        },
        error: null,
      } as any);
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          cascade: true,
          notify: true,
        });
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-shift-notification', {
        body: {
          shiftId: 's1',
          action: 'modified',
          previousShift: {
            start_time: '2026-03-10T14:00:00+00:00',
            end_time: '2026-03-10T22:00:00+00:00',
            position: 'Server',
          },
        },
      });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('send-shift-notification', {
        body: {
          shiftId: 's2',
          action: 'modified',
          previousShift: {
            start_time: '2026-03-11T14:00:00+00:00',
            end_time: '2026-03-11T22:00:00+00:00',
            position: 'Server',
          },
        },
      });
    });

    it('does not invoke send-shift-notification when notify is false', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 1,
          published_shifts: [
            { id: 's1', previous_start_time: '2026-03-10T14:00:00+00:00', previous_end_time: '2026-03-10T22:00:00+00:00', previous_position: 'Server' },
          ],
          skipped_count: 0,
        },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'Morning', cascade: true });
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('a failed notification does not surface an error toast — the save already succeeded', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: {
          batch_id: 'batch-1',
          updated_count: 1,
          published_shifts: [
            { id: 's1', previous_start_time: '2026-03-10T14:00:00+00:00', previous_end_time: '2026-03-10T22:00:00+00:00', previous_position: 'Server' },
          ],
          skipped_count: 0,
        },
        error: null,
      } as any);
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: new Error('edge function boom'),
      } as any);

      const { result } = renderHook(() => useShiftTemplates('r1'), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({
          id: 't1',
          name: 'Morning',
          cascade: true,
          notify: true,
        });
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Template updated' }),
      );
      expect(toastSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
  });

  describe('undoCascade (via the Undo toast action)', () => {
    beforeEach(() => {
      const selectBuilder = makeSelectBuilder([]);
      vi.mocked(supabase.from).mockReturnValue(selectBuilder as any);
    });

    async function triggerCascadeAndClickUndo(restaurantId = 'r1') {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          batch_id: 'batch-1',
          updated_count: 2,
          published_shifts: [],
          skipped_count: 0,
        },
        error: null,
      } as any);

      const { result } = renderHook(() => useShiftTemplates(restaurantId), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateTemplate({ id: 't1', name: 'Morning', cascade: true });
      });

      const toastCall = toastSpy.mock.calls.find(
        ([arg]) => arg.title === 'Template updated' && arg.action,
      );
      expect(toastCall).toBeDefined();
      const undoAction = toastCall![0].action;

      return { result, undoAction };
    }

    it('calls undo_template_hours_cascade with the batch id and restaurant id', async () => {
      const { undoAction } = await triggerCascadeAndClickUndo();

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { restored_count: 2, changed_since_count: 0, deleted_count: 0 },
        error: null,
      } as any);

      await act(async () => {
        undoAction.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(supabase.rpc).toHaveBeenCalledWith('undo_template_hours_cascade', {
        p_batch_id: 'batch-1',
        p_restaurant_id: 'r1',
      });
    });

    it('reports full success honestly when nothing was skipped', async () => {
      const { undoAction } = await triggerCascadeAndClickUndo();

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { restored_count: 2, changed_since_count: 0, deleted_count: 0 },
        error: null,
      } as any);

      await act(async () => {
        undoAction.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cascade undone',
          description: 'Restored 2 shifts.',
        }),
      );
    });

    it('reports honestly when some shifts changed or were deleted since the cascade', async () => {
      const { undoAction } = await triggerCascadeAndClickUndo();

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { restored_count: 1, changed_since_count: 1, deleted_count: 1 },
        error: null,
      } as any);

      await act(async () => {
        undoAction.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cascade undone',
          description: 'Restored 1 shift · skipped 1 changed since, 1 deleted',
        }),
      );
    });

    it('names only the skip reason that actually occurred', async () => {
      const { undoAction } = await triggerCascadeAndClickUndo();

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { restored_count: 3, changed_since_count: 0, deleted_count: 2 },
        error: null,
      } as any);

      await act(async () => {
        undoAction.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cascade undone',
          description: 'Restored 3 shifts · skipped 2 deleted',
        }),
      );
    });

    it('invalidates shifts and template-linked-shifts queries after undo', async () => {
      const { undoAction } = await triggerCascadeAndClickUndo();

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: { restored_count: 2, changed_since_count: 0, deleted_count: 0 },
        error: null,
      } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        undoAction.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shifts', 'r1'] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['template-linked-shifts', 'r1'],
      });
    });
  });
});
