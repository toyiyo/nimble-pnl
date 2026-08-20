import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftRow } from '@/components/employee/ShiftRow';
import type { Shift } from '@/types/scheduling';
import { makeClock } from '../helpers/restaurantClock';

const draft = {
  id: 'a',
  start_time: '2026-08-20T12:00:00Z',
  end_time: '2026-08-20T20:00:00Z',
  status: 'scheduled',
  is_published: false,
  // `Shift` names this field `break_duration` (src/types/scheduling.ts:117).
  // A fixture that spells it `break_minutes` leaves `break_duration`
  // undefined, and the row then renders "NaNh NaNm". The `as Shift` cast
  // hides that from `tsc`.
  break_duration: 0,
} as Shift;

describe('ShiftRow draft treatment', () => {
  it('marks a draft when the restaurant publishes', () => {
    const { container } = render(<ShiftRow shift={draft} clock={makeClock()} restaurantPublishes />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(container.querySelector('.border-dashed')).not.toBeNull();
  });

  it('shows a solid row when the restaurant does not publish', () => {
    const { container } = render(<ShiftRow shift={draft} clock={makeClock()} restaurantPublishes={false} />);
    expect(screen.queryByText('Draft')).toBeNull();
    expect(container.querySelector('.border-dashed')).toBeNull();
  });

  it('marks a draft by default, so current call sites do not change', () => {
    render(<ShiftRow shift={draft} clock={makeClock()} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders a real duration, so the fixture cannot go back to break_minutes', () => {
    const { container } = render(<ShiftRow shift={draft} clock={makeClock()} />);

    expect(container.textContent).toContain('8h 0m');
    expect(container.textContent).not.toContain('NaN');
  });
});
