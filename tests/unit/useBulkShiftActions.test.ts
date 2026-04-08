import React, { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Supabase mock ────────────────────────────────────────────────────
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockIn = vi.fn();
const mockEq = vi.fn();

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

// ── useShifts mock ──────────────────────────────────────────────────
vi.mock('@/hooks/useShifts', () => ({
  buildShiftChangeDescription: (count: number, lockedCount: number, action: string) => {
    const label = count === 1 ? 'shift' : 'shifts';
    let desc = `${count} ${label} ${action}.`;
    if (lockedCount > 0) {
      const lockedLabel = lockedCount === 1 ? 'locked shift was' : 'locked shifts were';
      const outcome = action === 'deleted' ? 'preserved' : 'unchanged';
      desc += ` ${lockedCount} ${lockedLabel} ${outcome}.`;
    }
    return desc;
  },
}));

// ── Toast mock ───────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Import after mocks ──────────────────────────────────────────────
import { useBulkShiftActions } from '@/hooks/useBulkShiftActions';

// ── Helpers ──────────────────────────────────────────────────────────
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Set up the chain for the locked-status SELECT query */
function setupLockedQuery(rows: Array<{ id: string; locked: boolean }>) {
  const selectResult = { data: rows, error: null };
  mockIn.mockReturnValue(selectResult);
  mockEq.mockReturnValue({ in: mockIn });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockSupabase.from.mockReturnValue({ select: mockSelect });
}

/**
 * Set up successive from() calls:
 *  1st call → locked-status SELECT (returns rows)
 *  2nd call → DELETE or UPDATE (returns result)
 */
function setupSelectThenMutate(
  lockedRows: Array<{ id: string; locked: boolean }>,
  mutateResult: { data: unknown; error: null; count: number },
  mutationType: 'delete' | 'update',
) {
  const selectChain = {
    data: lockedRows,
    error: null,
  };

  let callCount = 0;

  mockSupabase.from.mockImplementation(() => {
    callCount++;

    if (callCount === 1) {
      // SELECT locked status
      return {
        select: () => ({
          eq: () => ({
            in: () => selectChain,
          }),
        }),
      };
    }

    // DELETE or UPDATE — chain is .in().eq('locked', false)
    if (mutationType === 'delete') {
      return {
        delete: () => ({
          in: () => ({
            eq: () => mutateResult,
          }),
        }),
      };
    }

    // UPDATE
    return {
      update: () => ({
        in: () => ({
          eq: () => mutateResult,
        }),
      }),
    };
  });
}

describe('useBulkShiftActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── bulkDelete ─────────────────────────────────────────────────────

  describe('bulkDelete', () => {
    it('deletes all shifts including locked ones', async () => {
      // bulkDelete now deletes all shifts directly without partitioning
      mockSupabase.from.mockReturnValue({
        delete: () => ({
          in: () => ({
            eq: () => ({ data: null, error: null }),
          }),
        }),
      });

      const { result } = renderHook(() => useBulkShiftActions('rest-1'), {
        wrapper: createWrapper(),
      });

      let outcome: Awaited<ReturnType<typeof result.current.bulkDelete>>;
      await act(async () => {
        outcome = await result.current.bulkDelete(['s1', 's2', 's3']);
      });

      expect(outcome!.deletedCount).toBe(3);
      expect(outcome!.lockedCount).toBe(0);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shifts deleted',
          description: '3 shifts deleted.',
        }),
      );
    });

    it('deletes a single shift with correct grammar', async () => {
      mockSupabase.from.mockReturnValue({
        delete: () => ({
          in: () => ({
            eq: () => ({ data: null, error: null }),
          }),
        }),
      });

      const { result } = renderHook(() => useBulkShiftActions('rest-1'), {
        wrapper: createWrapper(),
      });

      let outcome: Awaited<ReturnType<typeof result.current.bulkDelete>>;
      await act(async () => {
        outcome = await result.current.bulkDelete(['s1']);
      });

      expect(outcome!.deletedCount).toBe(1);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '1 shift deleted.',
        }),
      );
    });
  });

  // ── bulkEdit ───────────────────────────────────────────────────────

  describe('bulkEdit', () => {
    it('filters out locked shifts and applies changes to unlocked ones', async () => {
      const lockedRows = [
        { id: 's1', locked: false },
        { id: 's2', locked: true },
        { id: 's3', locked: false },
      ];

      setupSelectThenMutate(
        lockedRows,
        { data: [{ id: 's1' }, { id: 's3' }], error: null, count: 2 },
        'update',
      );

      const { result } = renderHook(() => useBulkShiftActions('rest-1'), {
        wrapper: createWrapper(),
      });

      let outcome: Awaited<ReturnType<typeof result.current.bulkEdit>>;
      await act(async () => {
        outcome = await result.current.bulkEdit(['s1', 's2', 's3'], { position: 'Server' });
      });

      expect(outcome!.updatedCount).toBe(2);
      expect(outcome!.lockedCount).toBe(1);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('1 locked shift was unchanged'),
        }),
      );
    });

    it('returns zero counts when all shifts are locked', async () => {
      const lockedRows = [
        { id: 's1', locked: true },
        { id: 's2', locked: true },
      ];

      setupSelectThenMutate(lockedRows, { data: null, error: null, count: 0 }, 'update');

      const { result } = renderHook(() => useBulkShiftActions('rest-1'), {
        wrapper: createWrapper(),
      });

      let outcome: Awaited<ReturnType<typeof result.current.bulkEdit>>;
      await act(async () => {
        outcome = await result.current.bulkEdit(['s1', 's2'], { position: 'Cook' });
      });

      expect(outcome!.updatedCount).toBe(0);
      expect(outcome!.lockedCount).toBe(2);
    });

    it('updates all shifts when none are locked', async () => {
      const lockedRows = [
        { id: 's1', locked: false },
        { id: 's2', locked: false },
      ];

      setupSelectThenMutate(
        lockedRows,
        { data: [{ id: 's1' }, { id: 's2' }], error: null, count: 2 },
        'update',
      );

      const { result } = renderHook(() => useBulkShiftActions('rest-1'), {
        wrapper: createWrapper(),
      });

      let outcome: Awaited<ReturnType<typeof result.current.bulkEdit>>;
      await act(async () => {
        outcome = await result.current.bulkEdit(['s1', 's2'], { position: 'Host' });
      });

      expect(outcome!.updatedCount).toBe(2);
      expect(outcome!.lockedCount).toBe(0);
    });
  });
});
