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
const mockGetUser = vi.fn();
const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }));
const mockToast = vi.fn();
const mockInvokeScheduleNotification = vi.fn();

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
  mockEq.mockReturnValue({ single: mockSingle });
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
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'schedule_change_logs') return { select: logSelect };
    return { select: mockSelect };
  });

  mockGetUser.mockResolvedValue({ data: { user: { id: 'manager-1' } }, error: null });
  mockSupabase.auth.getUser = mockGetUser;

  return { logEq, logGte, logOrder, logLimit, logSelect };
}

function TestHarness({
  run,
  shiftId = 'shift-1',
}: {
  run: (options: { allowPublished: boolean }) => void;
  shiftId?: string;
}) {
  const { guardShiftChange, dialog } = usePublishedShiftGuard();
  return (
    <>
      <button
        onClick={() => guardShiftChange({ shiftId, employeeName: 'Alex Rivera', run })}
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

    await waitFor(() => expect(run).toHaveBeenCalledWith({ allowPublished: false }));
    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(mockEq).toHaveBeenCalledWith('id', 'shift-1');
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

    await waitFor(() => expect(run).toHaveBeenCalledWith({ allowPublished: true }));
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

    await waitFor(() => expect(run).toHaveBeenCalledWith({ allowPublished: true }));
    expect(mockInvokeScheduleNotification).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalledWith('schedule_change_logs');
  });
});
