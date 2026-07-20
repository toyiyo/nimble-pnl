/**
 * Regression test for a keyboard-accessibility bug found in code review
 * (sound-logic reviewer, Phase 7b fold): ShiftCard's clickable surface has
 * role="button"/tabIndex={0}/onKeyDown (Task 7, design doc "ShiftCard
 * keyboard access"). The Edit/Delete icon buttons only
 * `e.stopPropagation()` on their `onClick`, not on keydown, so pressing
 * Enter/Space while the "Delete shift" button was focused let the keydown
 * bubble to the card's own onKeyDown, which unconditionally called
 * `onEdit(shift)` instead of the focused button's own `onDelete(shift)`.
 *
 * The fix (CodeRabbit Phase 7c fold) moved the Edit/Delete buttons out from
 * under the role="button" card surface entirely — real interactive elements
 * must not be nested inside another ARIA button — so their keydowns no
 * longer bubble into the card's own onKeyDown at all.
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
  mockUseCheckConflicts.mockReset();
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

  it('should call onEdit for both Enter and Space when the card surface itself is focused', () => {
    const shift = makeShift();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<ShiftCard shift={shift} onEdit={onEdit} onDelete={onDelete} />);

    const card = screen.getByTestId('shift-card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenNthCalledWith(1, shift);
    expect(onEdit).toHaveBeenNthCalledWith(2, shift);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
