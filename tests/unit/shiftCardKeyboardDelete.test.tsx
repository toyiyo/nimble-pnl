/**
 * Regression test for a keyboard-accessibility bug found in code review
 * (sound-logic reviewer, Phase 7b fold): ShiftCard's outer card div has
 * role="button"/tabIndex={0}/onKeyDown (Task 7, design doc "ShiftCard
 * keyboard access"). The nested Edit/Delete icon buttons only
 * `e.stopPropagation()` on their `onClick`, not on keydown, so pressing
 * Enter/Space while the "Delete shift" button is focused let the keydown
 * bubble to the card's own onKeyDown, which unconditionally called
 * `onEdit(shift)` instead of the focused button's own `onDelete(shift)`.
 *
 * The fix guards the card's onKeyDown with `e.target !== e.currentTarget`
 * so it only reacts to keydowns on the card surface itself, not ones
 * bubbling up from a focused descendant control.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ShiftCard } from '@/pages/SchedulingShiftCard';
import type { Shift } from '@/types/scheduling';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
  }),
}));

const mockUseCheckConflicts = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: (...args: unknown[]) => mockUseCheckConflicts(...args),
}));

beforeEach(() => {
  mockUseCheckConflicts.mockReturnValue({ conflicts: [], hasConflicts: false });
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-15T15:00:00.000Z',
    end_time: '2026-07-15T23:00:00.000Z',
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

describe('ShiftCard — keyboard activation of nested Edit/Delete buttons', () => {
  it('calls onDelete (not onEdit) when Enter is pressed on the focused Delete button', async () => {
    const user = userEvent.setup();
    const shift = makeShift();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ShiftCard shift={shift} onEdit={onEdit} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete shift' });
    deleteButton.focus();
    await user.keyboard('{Enter}');

    expect(onDelete).toHaveBeenCalledWith(shift);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('calls onDelete (not onEdit) when Space is pressed on the focused Delete button', async () => {
    const user = userEvent.setup();
    const shift = makeShift();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ShiftCard shift={shift} onEdit={onEdit} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete shift' });
    deleteButton.focus();
    await user.keyboard(' ');

    expect(onDelete).toHaveBeenCalledWith(shift);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('still activates onEdit via Enter/Space when the card surface itself is focused', () => {
    const shift = makeShift();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ShiftCard shift={shift} onEdit={onEdit} onDelete={onDelete} />);

    const card = screen.getByTestId('shift-card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onEdit).toHaveBeenCalledWith(shift);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
