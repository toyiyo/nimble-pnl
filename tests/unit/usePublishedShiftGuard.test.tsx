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
const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

function setupChain(resolvedValue: { data: unknown; error: unknown }) {
  mockSingle.mockResolvedValue(resolvedValue);
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockSupabase.from.mockReturnValue({ select: mockSelect });
}

function TestHarness({ run }: { run: (options: { allowPublished: boolean }) => void }) {
  const { guardShiftChange, dialog } = usePublishedShiftGuard();
  return (
    <>
      <button
        onClick={() =>
          guardShiftChange({ shiftId: 'shift-1', employeeName: 'Alex Rivera', run })
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
});
