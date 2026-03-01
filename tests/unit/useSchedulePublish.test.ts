/**
 * Unit Tests: useSchedulePublish hook
 *
 * Tests all exported hooks:
 * - useWeekPublicationStatus (query hook)
 * - usePublishSchedule (mutation hook)
 * - useUnpublishSchedule (mutation hook)
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useWeekPublicationStatus,
  usePublishSchedule,
  useUnpublishSchedule,
} from '@/hooks/useSchedulePublish';

import {
  RESTAURANT_ID,
  createWrapper,
  buildMockFromChain,
  type MockFromChain,
} from './helpers/scheduling-test-helpers';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEK_START = '2026-03-02';

const mockPublication = {
  id: 'pub-1',
  restaurant_id: RESTAURANT_ID,
  week_start_date: WEEK_START,
  week_end_date: '2026-03-08',
  published_at: '2026-03-01T10:00:00Z',
  published_by: 'user-1',
  shift_count: 12,
  notes: 'Published for March week 1',
};

let mockFromChain: MockFromChain;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = buildMockFromChain({
    terminalMethods: ['maybeSingle'],
    extraChainMethods: ['order', 'limit'],
  });

  mockSupabase.from.mockReturnValue(mockFromChain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// Export verification
// ---------------------------------------------------------------------------

describe('useSchedulePublish exports', () => {
  it('exports useWeekPublicationStatus as a function', () => {
    expect(typeof useWeekPublicationStatus).toBe('function');
  });

  it('exports usePublishSchedule as a function', () => {
    expect(typeof usePublishSchedule).toBe('function');
  });

  it('exports useUnpublishSchedule as a function', () => {
    expect(typeof useUnpublishSchedule).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useWeekPublicationStatus query tests
// ---------------------------------------------------------------------------

describe('useWeekPublicationStatus', () => {
  it('returns null when restaurantId is null', async () => {
    const { result } = renderHook(() => useWeekPublicationStatus(null, WEEK_START), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.publication).toBeNull();
    expect(result.current.isPublished).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns null when weekStartDate is null', async () => {
    const { result } = renderHook(() => useWeekPublicationStatus(RESTAURANT_ID, null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.publication).toBeNull();
    expect(result.current.isPublished).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches publication when both params are provided', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: mockPublication,
      error: null,
    });

    const { result } = renderHook(
      () => useWeekPublicationStatus(RESTAURANT_ID, WEEK_START),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('schedule_publications');
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    expect(mockFromChain.eq).toHaveBeenCalledWith('week_start_date', WEEK_START);
    // weekEndDate should be 6 days after start: 2026-03-08
    expect(mockFromChain.eq).toHaveBeenCalledWith('week_end_date', '2026-03-08');
    expect(result.current.publication).toEqual(mockPublication);
    expect(result.current.isPublished).toBe(true);
  });

  it('returns isPublished=false when no publication exists', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(
      () => useWeekPublicationStatus(RESTAURANT_ID, WEEK_START),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.publication).toBeNull();
    expect(result.current.isPublished).toBe(false);
  });

  it('handles query error', async () => {
    mockFromChain.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'Permission denied' },
    });

    const { result } = renderHook(
      () => useWeekPublicationStatus(RESTAURANT_ID, WEEK_START),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('calculates weekEndDate correctly for cross-month boundaries', async () => {
    // Week starting 2026-02-25 (Wed) should end on 2026-03-03 (Tue)
    mockFromChain.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    renderHook(
      () => useWeekPublicationStatus(RESTAURANT_ID, '2026-02-25'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockFromChain.eq).toHaveBeenCalledWith('week_end_date', '2026-03-03');
    });
  });
});

// ---------------------------------------------------------------------------
// usePublishSchedule mutation tests
// ---------------------------------------------------------------------------

describe('usePublishSchedule', () => {
  it('calls publish_schedule RPC and shows success toast', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-new-id', error: null });

    const { result } = renderHook(() => usePublishSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
        notes: 'First publish',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_schedule', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_start: WEEK_START,
      p_week_end: '2026-03-08',
      p_notes: 'First publish',
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Schedule published',
      description: 'The schedule has been published and shifts are now locked.',
    });
  });

  it('passes null for notes when omitted', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-id', error: null });

    const { result } = renderHook(() => usePublishSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_schedule', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_start: WEEK_START,
      p_week_end: '2026-03-08',
      p_notes: null,
    });
  });

  it('shows error toast on RPC failure', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'No shifts to publish' },
    });

    const { result } = renderHook(() => usePublishSchedule(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurantId: RESTAURANT_ID,
          weekStartDate: WEEK_START,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error publishing schedule',
          variant: 'destructive',
        }),
      );
    });
  });

  it('calculates weekEndDate correctly for cross-month week', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-id', error: null });

    const { result } = renderHook(() => usePublishSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStartDate: '2026-02-25',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'publish_schedule',
      expect.objectContaining({ p_week_end: '2026-03-03' }),
    );
  });
});

// ---------------------------------------------------------------------------
// useUnpublishSchedule mutation tests
// ---------------------------------------------------------------------------

describe('useUnpublishSchedule', () => {
  it('calls unpublish_schedule RPC and shows success toast', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 5, error: null });

    const { result } = renderHook(() => useUnpublishSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStart: WEEK_START,
        weekEnd: '2026-03-08',
        reason: 'Needs changes',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('unpublish_schedule', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_start: WEEK_START,
      p_week_end: '2026-03-08',
      p_reason: 'Needs changes',
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Schedule unpublished',
      description: 'The schedule has been unpublished and shifts are now unlocked.',
    });
  });

  it('passes null for reason when omitted', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 3, error: null });

    const { result } = renderHook(() => useUnpublishSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStart: WEEK_START,
        weekEnd: '2026-03-08',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('unpublish_schedule', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_start: WEEK_START,
      p_week_end: '2026-03-08',
      p_reason: null,
    });
  });

  it('shows error toast on RPC failure', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Schedule not found' },
    });

    const { result } = renderHook(() => useUnpublishSchedule(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurantId: RESTAURANT_ID,
          weekStart: WEEK_START,
          weekEnd: '2026-03-08',
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error unpublishing schedule',
          variant: 'destructive',
        }),
      );
    });
  });
});
