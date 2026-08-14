import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { Shift } from '@/types/scheduling';

vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: () => ({ conflicts: [], hasConflicts: false }),
}));

import { ShiftCard } from '@/pages/SchedulingShiftCard';

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's-1',
    restaurant_id: 'r-1',
    employee_id: 'e-1',
    start_time: '2026-09-01T16:00:00.000Z',
    end_time: '2026-09-01T22:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    notes: undefined,
    status: 'scheduled',
    is_published: true,
    locked: false,
    is_recurring: false,
    recurrence_parent_id: null,
    recurrence_pattern: null,
    published_at: null,
    published_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

describe('ShiftCard offer-trade action', () => {
  it('shows the offer action for a scheduled shift when onOfferTrade is set', () => {
    const onOfferTrade = vi.fn();
    render(
      <ShiftCard
        shift={mockShift()}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={onOfferTrade}
      />,
    );

    const button = screen.getByLabelText('Offer shift for trade');
    fireEvent.click(button);
    expect(onOfferTrade).toHaveBeenCalledTimes(1);
  });

  it('hides the offer action when onOfferTrade is not set', () => {
    render(<ShiftCard shift={mockShift()} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByLabelText('Offer shift for trade')).toBeNull();
  });

  it('hides the offer action for a cancelled shift', () => {
    render(
      <ShiftCard
        shift={mockShift({ status: 'cancelled' })}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Offer shift for trade')).toBeNull();
  });

  it('hides the offer action for an unpublished draft shift', () => {
    render(
      <ShiftCard
        shift={mockShift({ is_published: false })}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Offer shift for trade')).toBeNull();
  });
});
