/**
 * Tests for ShiftCell — conflict pass-through and memo comparator.
 *
 * The conflict map (`conflictsByShiftId`) is rebuilt wholesale on every
 * planner edit (same as `coverageByTemplateDay`), so the comparator must
 * compare this cell's own entries by value, not the map by reference.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';
import type { Shift } from '@/types/scheduling';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

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

const LINES = ['Employee has approved time-off from 2026-04-21 to 2026-04-22'];

const BASE_PROPS = {
  templateId: 't1',
  day: '2026-04-20',
  isActiveDay: true,
  capacity: 1,
  onRemoveShift: vi.fn(),
};

type CompareFn = (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
const compare = (ShiftCell as unknown as { compare: CompareFn }).compare;

describe('ShiftCell — conflict pass-through', () => {
  it('passes the shift conflict lines to the chip (badge renders)', () => {
    const shift = makeShift({});
    render(
      <TooltipProvider>
        <ShiftCell
          {...BASE_PROPS}
          shifts={[shift]}
          conflictsByShiftId={new Map([[shift.id, LINES]])}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /^Conflicts:/ })).toBeTruthy();
  });

  it('renders no badge for a shift without an entry', () => {
    const shift = makeShift({});
    render(
      <TooltipProvider>
        <ShiftCell {...BASE_PROPS} shifts={[shift]} conflictsByShiftId={new Map()} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: /^Conflicts:/ })).toBeNull();
  });
});

describe('ShiftCell memo comparator — conflictsByShiftId', () => {
  const shift = makeShift({});
  const shifts = [shift];

  it('skips a re-render when a rebuilt map has the same entry for this cell', () => {
    const equal = compare(
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map([[shift.id, LINES]]) },
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map([[shift.id, LINES]]) },
    );
    expect(equal).toBe(true);
  });

  it('re-renders when this cell gains a conflict entry', () => {
    const equal = compare(
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map() },
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map([[shift.id, LINES]]) },
    );
    expect(equal).toBe(false);
  });

  it('skips a re-render when only another cell\'s entry changed', () => {
    const equal = compare(
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map([['other-shift', LINES]]) },
      { ...BASE_PROPS, shifts, conflictsByShiftId: new Map() },
    );
    expect(equal).toBe(true);
  });
});
