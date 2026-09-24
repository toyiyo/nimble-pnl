/**
 * Tests for the conflict indicator in the two planner lanes:
 * OffTemplateRow and HiddenTemplatesRow.
 *
 * A conflicted row gets the amber left border and a ConflictBadge, so the
 * header count always matches the visible triangles.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { OffTemplateRow } from '@/components/scheduling/ShiftPlanner/OffTemplateRow';
import { HiddenTemplatesRow } from '@/components/scheduling/ShiftPlanner/HiddenTemplatesRow';
import type { Shift } from '@/types/scheduling';

function makeShift(partial: Partial<Shift>): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-04-20T13:00:00Z',
    end_time: '2026-04-20T21:00:00Z',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee: { id: 'e1', name: 'Alice', restaurant_id: 'r1' } as Shift['employee'],
    ...partial,
  };
}

const WEEK = ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-25', '2026-04-26'];
const LINES = ['Employee has approved time-off from 2026-04-20 to 2026-04-20'];

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('OffTemplateRow — conflict indicator', () => {
  const shift = makeShift({});
  const shiftsByDay = new Map([['2026-04-20', [shift]]]);

  it('renders the badge and the amber border for a conflicted shift', () => {
    wrap(
      <OffTemplateRow
        area="Kitchen"
        weekDays={WEEK}
        shiftsByDay={shiftsByDay}
        onRemoveShift={vi.fn()}
        conflictsByShiftId={new Map([[shift.id, LINES]])}
      />,
    );
    // Start from the accessible badge button; its parent is the lane row.
    const row = screen.getByRole('button', { name: /^Conflicts:/ }).parentElement;
    expect(row?.className).toContain('border-l-warning');
  });

  it('renders no badge without an entry', () => {
    const { container } = wrap(
      <OffTemplateRow
        area="Kitchen"
        weekDays={WEEK}
        shiftsByDay={shiftsByDay}
        onRemoveShift={vi.fn()}
        conflictsByShiftId={new Map()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Conflicts:/ })).toBeNull();
    expect(container.querySelector('.border-l-warning')).toBeNull();
  });
});

describe('HiddenTemplatesRow — conflict indicator', () => {
  const shift = makeShift({ id: 's2' });
  const shiftsByDay = new Map([['2026-04-20', [shift]]]);

  it('renders the badge and the amber border for a conflicted shift', () => {
    wrap(
      <HiddenTemplatesRow
        weekDays={WEEK}
        shiftsByDay={shiftsByDay}
        onRemoveShift={vi.fn()}
        onShowHidden={vi.fn()}
        conflictsByShiftId={new Map([[shift.id, LINES]])}
      />,
    );
    // Start from the accessible badge button; its parent is the lane row.
    const row = screen.getByRole('button', { name: /^Conflicts:/ }).parentElement;
    expect(row?.className).toContain('border-l-warning');
  });

  it('renders no badge without the map', () => {
    const { container } = wrap(
      <HiddenTemplatesRow
        weekDays={WEEK}
        shiftsByDay={shiftsByDay}
        onRemoveShift={vi.fn()}
        onShowHidden={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Conflicts:/ })).toBeNull();
    expect(container.querySelector('.border-l-warning')).toBeNull();
  });
});
