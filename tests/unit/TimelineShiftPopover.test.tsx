/**
 * Unit tests: TimelineShiftPopover — view mode footer (Edit/Delete), edit mode
 * (renders TimelineShiftEditor), locked/recurring affordances, delete confirm
 * for published shifts, and conflict-dialog stacking (design doc: docs/superpowers/specs/
 * 2026-07-05-timeline-edit-create-design.md, plan task B2).
 *
 * `useCheckConflicts` is mocked (TimelineShiftEditor's own dependency) so no
 * network call is exercised. Mutation callbacks are plain vi.fn()s injected as
 * props — this component does not itself mount useValidatedShiftMutations
 * (that wiring is B3's job at the ShiftTimelineTab level).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TimelineShiftPopover } from '@/components/scheduling/ShiftTimeline/TimelineShiftPopover';
import type { Employee, Shift, ConflictCheck } from '@/types/scheduling';

const mockUseCheckConflicts = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: (...args: unknown[]) => mockUseCheckConflicts(...args),
}));

const NO_CONFLICTS = { conflicts: [] as ConflictCheck[], hasConflicts: false, loading: false, error: null };

function makeEmployee(overrides: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    restaurant_id: 'r1',
    position: 'Server',
    status: 'active',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-03-10T15:00:00.000Z',
    end_time: '2026-03-10T23:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Shift;
}

const employees: Employee[] = [
  makeEmployee({ id: 'e1', name: 'Amy Server', position: 'Server' }),
  makeEmployee({ id: 'e2', name: 'Cody Cook', position: 'Cook' }),
];

function defaultProps(overrides: Partial<React.ComponentProps<typeof TimelineShiftPopover>> = {}) {
  return {
    activeShift: makeShift(),
    tz: 'America/Chicago',
    dateStr: '2026-03-10',
    employees,
    restaurantId: 'r1',
    dayShifts: [] as Shift[],
    onClose: vi.fn(),
    validateAndUpdateTime: vi.fn(),
    forceUpdateTime: vi.fn(),
    deleteShift: vi.fn(),
    validationResult: null,
    clearValidation: vi.fn(),
    ...overrides,
  };
}

describe('TimelineShiftPopover', () => {
  beforeEach(() => {
    mockUseCheckConflicts.mockReset();
    mockUseCheckConflicts.mockReturnValue(NO_CONFLICTS);
  });

  it('renders nothing when activeShift is null', () => {
    const { container } = render(
      <TimelineShiftPopover {...defaultProps({ activeShift: null })} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('view mode shows Edit and Delete footer actions', () => {
    render(<TimelineShiftPopover {...defaultProps()} />);

    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('locked shift shows a lock icon and disables Edit/Delete', () => {
    render(
      <TimelineShiftPopover
        {...defaultProps({ activeShift: makeShift({ locked: true }) })}
      />,
    );

    expect(screen.getByLabelText(/locked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled();
  });

  it('recurring shift shows the "this shift only" hint', () => {
    render(
      <TimelineShiftPopover
        {...defaultProps({ activeShift: makeShift({ is_recurring: true }) })}
      />,
    );

    expect(screen.getByText(/changes apply to this shift only/i)).toBeTruthy();
  });

  it('clicking Edit switches to edit mode and renders the employee select from TimelineShiftEditor', async () => {
    const user = userEvent.setup();
    render(<TimelineShiftPopover {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByLabelText(/select employee/i)).toBeTruthy();
    expect(screen.getByLabelText(/start time/i)).toBeTruthy();
  });

  it('clicking Delete on an unpublished shift deletes immediately (no confirm dialog)', async () => {
    const user = userEvent.setup();
    const deleteShift = vi.fn();
    render(
      <TimelineShiftPopover
        {...defaultProps({ activeShift: makeShift({ is_published: false }), deleteShift })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(deleteShift).toHaveBeenCalledWith('shift-1');
    // No AlertDialog should have appeared.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('clicking Delete on a published shift opens an AlertDialog confirm, and only deletes on confirm', async () => {
    const user = userEvent.setup();
    const deleteShift = vi.fn();
    render(
      <TimelineShiftPopover
        {...defaultProps({ activeShift: makeShift({ is_published: true }), deleteShift })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(deleteShift).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^delete shift$/i }));

    await waitFor(() => expect(deleteShift).toHaveBeenCalledWith('shift-1'));
  });

  it('published-shift delete confirm dismisses without deleting on Cancel', async () => {
    const user = userEvent.setup();
    const deleteShift = vi.fn();
    render(
      <TimelineShiftPopover
        {...defaultProps({ activeShift: makeShift({ is_published: true }), deleteShift })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(deleteShift).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Save with no pending issues calls forceUpdateTime-free validateAndUpdateTime and closes the popover', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const validateAndUpdateTime = vi.fn().mockResolvedValue({ updated: true });

    render(
      <TimelineShiftPopover
        {...defaultProps({ onClose, validateAndUpdateTime })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(validateAndUpdateTime).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Save with pending conflicts keeps the popover mounted and open behind the conflict dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const validateAndUpdateTime = vi.fn().mockResolvedValue({
      updated: false,
      pendingConflicts: [
        { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
      ] as ConflictCheck[],
      pendingWarnings: [],
    });

    render(
      <TimelineShiftPopover
        {...defaultProps({ onClose, validateAndUpdateTime })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: /scheduling warning/i })).toBeTruthy());
    // Popover content (edit form) should still be present behind the conflict dialog.
    expect(screen.getByLabelText(/select employee/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirming the conflict dialog calls forceUpdateTime and then closes the popover', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const validateAndUpdateTime = vi.fn().mockResolvedValue({
      updated: false,
      pendingConflicts: [
        { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
      ] as ConflictCheck[],
      pendingWarnings: [],
    });
    const forceUpdateTime = vi.fn().mockResolvedValue(true);

    render(
      <TimelineShiftPopover
        {...defaultProps({ onClose, validateAndUpdateTime, forceUpdateTime })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: /scheduling warning/i })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /assign anyway/i }));

    await waitFor(() => expect(forceUpdateTime).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cancelling the conflict dialog returns to the edit form without closing the popover', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const validateAndUpdateTime = vi.fn().mockResolvedValue({
      updated: false,
      pendingConflicts: [
        { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
      ] as ConflictCheck[],
      pendingWarnings: [],
    });

    render(
      <TimelineShiftPopover
        {...defaultProps({ onClose, validateAndUpdateTime })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: /scheduling warning/i })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /scheduling warning/i })).toBeNull());
    // Still in edit mode, still mounted.
    expect(screen.getByLabelText(/select employee/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
