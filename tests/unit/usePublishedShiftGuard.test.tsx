/**
 * Unit tests: usePublishedShiftGuard — the single per-page guard that
 * decides, off a fresh read (never the React Query cache), whether a shift
 * change needs the "This shift is published" confirm dialog.
 * Design: docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { usePublishedShiftGuard } from '@/hooks/usePublishedShiftGuard';

const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
}));
const mockToast = vi.fn();
const mockInvokeScheduleNotification = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

vi.mock('@/hooks/useSchedulePublish', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSchedulePublish')>(
    '@/hooks/useSchedulePublish'
  );
  return {
    ...actual,
    invokeScheduleNotification: mockInvokeScheduleNotification,
  };
});

function setupChain(resolvedValue: { data: unknown; error: unknown }) {
  mockSingle.mockResolvedValue(resolvedValue);
  // Chains twice — `.eq('id', ...).eq('restaurant_id', ...).single()` — so
  // `eq` must keep returning an object that still offers both `eq` and
  // `single`, not just `single`.
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockSupabase.from.mockReturnValue({ select: mockSelect });
}

/**
 * Sets up two distinct `from()` targets: the `shifts` fresh-read (as
 * `setupChain` does) and the `schedule_change_logs` lookup the notify step
 * runs after a confirmed change. The lookup chain records every `eq`/`gte`
 * call so tests can assert the scoped filter.
 */
function setupChainWithChangeLog(
  shiftsResolvedValue: { data: unknown; error: unknown },
  changeLogRows: Array<{ id: string }>
) {
  const logEq = vi.fn();
  const logGte = vi.fn();
  const logOrder = vi.fn();
  const logLimit = vi.fn().mockResolvedValue({ data: changeLogRows, error: null });
  const logSelect = vi.fn();

  logOrder.mockReturnValue({ limit: logLimit });
  logGte.mockReturnValue({ order: logOrder });
  logEq.mockImplementation(() => ({ eq: logEq, gte: logGte }));
  logSelect.mockReturnValue({ eq: logEq });

  mockSingle.mockResolvedValue(shiftsResolvedValue);
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'schedule_change_logs') return { select: logSelect };
    return { select: mockSelect };
  });

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'manager-1' } },
    error: null,
  });

  return { logEq, logGte, logOrder, logLimit, logSelect };
}

/** Mocks the series count query: `select(..., {head:true})` ending in an awaited chain. */
function setupSeriesCountChain(count: number) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (value: { count: number; error: null }) => void) =>
    resolve({ count, error: null });
  const seriesSelect = vi.fn().mockReturnValue(chain);
  mockSupabase.from.mockReturnValue({ select: seriesSelect });
  return { chain, seriesSelect };
}

function TestHarness({
  run,
  shiftId = 'shift-1',
  series,
}: {
  run: (options: { allowPublished: boolean }) => void;
  shiftId?: string;
  series?: { parentId: string; scope: 'following' | 'all'; fromTime?: string };
}) {
  const { guardShiftChange, dialog } = usePublishedShiftGuard();
  return (
    <>
      <button
        onClick={() =>
          guardShiftChange({
            shiftId,
            restaurantId: 'rest-1',
            employeeName: 'Alex Rivera',
            run,
            series,
          })
        }
      >
        Trigger
      </button>
      {dialog}
    </>
  );
}

describe('usePublishedShiftGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs directly when the fresh read says the shift is not locked', async () => {
    setupChain({ data: { locked: false, employee_id: 'emp-1' }, error: null });
    const run = vi.fn();
    render(<TestHarness run={run} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ allowPublished: false, notify: false })
    );
    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(mockEq).toHaveBeenCalledWith('id', 'shift-1');
    expect(mockEq).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(screen.queryByText('This shift is published')).not.toBeInTheDocument();
  });

  it('opens the dialog when any shift in the series scope is locked', async () => {
    // The anchor itself is not read: the series count query decides.
    const { chain } = setupSeriesCountChain(2);
    const run = vi.fn();
    render(
      <TestHarness
        run={run}
        series={{ parentId: 'parent-1', scope: 'following', fromTime: '2026-08-12T00:00:00Z' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );
    expect(run).not.toHaveBeenCalled();
    expect(chain.or).toHaveBeenCalledWith('id.eq.parent-1,recurrence_parent_id.eq.parent-1');
    expect(chain.gte).toHaveBeenCalledWith('start_time', '2026-08-12T00:00:00Z');
  });

  it('runs directly when no shift in the series scope is locked', async () => {
    setupSeriesCountChain(0);
    const run = vi.fn();
    render(<TestHarness run={run} series={{ parentId: 'parent-1', scope: 'all' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ allowPublished: false, notify: false })
    );
    expect(screen.queryByText('This shift is published')).not.toBeInTheDocument();
  });

  it('opens the dialog and defers the run when the fresh read says locked', async () => {
    setupChain({ data: { locked: true, employee_id: 'emp-1' }, error: null });
    const run = vi.fn();
    render(<TestHarness run={run} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('runs with allowPublished: true after the manager confirms', async () => {
    setupChain({ data: { locked: true, employee_id: 'emp-1' }, error: null });
    const run = vi.fn();
    render(<TestHarness run={run} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ allowPublished: true, notify: true })
    );
  });

  it('does not run when the manager cancels', async () => {
    setupChain({ data: { locked: true, employee_id: 'emp-1' }, error: null });
    const run = vi.fn();
    render(<TestHarness run={run} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText('This shift is published')).not.toBeInTheDocument()
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('looks up the change log scoped to shift, actor, and time, then notifies', async () => {
    const { logEq, logGte } = setupChainWithChangeLog(
      { data: { locked: true, employee_id: 'emp-1' }, error: null },
      [{ id: 'log-1' }]
    );
    mockInvokeScheduleNotification.mockResolvedValue({ status: 'sent', sent: 1 });
    const run = vi.fn();
    render(<TestHarness run={run} shiftId="shift-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );
    // The notify checkbox stays checked by default.
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));

    await waitFor(() =>
      expect(mockInvokeScheduleNotification).toHaveBeenCalledWith('notify-shift-changed', {
        changeLogId: 'log-1',
      })
    );
    expect(logEq).toHaveBeenCalledWith('shift_id', 'shift-1');
    expect(logEq).toHaveBeenCalledWith('changed_by', 'manager-1');
    expect(logGte).toHaveBeenCalledWith('changed_at', expect.any(String));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shift updated' })
    );
  });

  it('reports a destructive toast, not an unhandled rejection, when the notify lookup throws', async () => {
    setupChainWithChangeLog(
      { data: { locked: true, employee_id: 'emp-1' }, error: null },
      [{ id: 'log-1' }]
    );
    // The commit (`run`) already succeeded by this point — only the
    // post-commit notify lookup fails here.
    mockSupabase.auth.getUser.mockRejectedValue(new Error('network down'));
    const run = vi.fn();
    render(<TestHarness run={run} shiftId="shift-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ allowPublished: true, notify: true })
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shift updated — could not notify',
          variant: 'destructive',
        })
      )
    );
    expect(mockInvokeScheduleNotification).not.toHaveBeenCalled();
  });

  it('skips the lookup and the notify call when the checkbox is unchecked', async () => {
    setupChainWithChangeLog(
      { data: { locked: true, employee_id: 'emp-1' }, error: null },
      [{ id: 'log-1' }]
    );
    const run = vi.fn();
    render(<TestHarness run={run} shiftId="shift-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() =>
      expect(screen.getByText('This shift is published')).toBeInTheDocument()
    );
    fireEvent.click(
      screen.getByLabelText('Notify Alex Rivera about this change')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ allowPublished: true, notify: false })
    );
    expect(mockInvokeScheduleNotification).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalledWith('schedule_change_logs');
  });
});
