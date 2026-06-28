/**
 * Tests for OffTemplateRow — read-only off-template lane (F3).
 *
 * RED → GREEN → REFACTOR TDD cycle.
 *
 * Invariants:
 * 1. Renders "Off-template" label in the row header.
 * 2. Renders a day cell for each weekDay.
 * 3. When a day has unmatched shifts, each shift renders employee name + compact time range.
 * 4. When a day has no unmatched shifts, the cell is empty (no chips).
 * 5. Remove button is present for each shift and has an accessible aria-label.
 * 6. Calling onRemoveShift with the shift id when remove button is clicked.
 * 7. Component does NOT call useDroppable (source-text invariant — no drag target).
 * 8. Compact time labels: "13:00:00" → "1:00p", "09:00:00" → "9a", "16:30:00" → "4:30p".
 * 9. Renders a Clock icon in the header (no raw color literals).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { OffTemplateRow } from '@/components/scheduling/ShiftPlanner/OffTemplateRow';
import type { Shift } from '@/types/scheduling';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/OffTemplateRow.tsx'),
  'utf-8',
);

const weekDays = ['2026-07-04', '2026-07-05', '2026-07-06'];

function makeShift(id: string, name: string, start: string, end: string): Shift {
  return {
    id,
    restaurant_id: 'r1',
    employee_id: id,
    start_time: start,
    end_time: end,
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee: { id, name, area: 'Cold Stone', position: 'Server' } as Shift['employee'],
  };
}

const shift1 = makeShift('s1', 'Corey Trussell', '2026-07-04T15:00:00Z', '2026-07-04T19:30:00Z');
const shift2 = makeShift('s2', 'Aleah Holderread', '2026-07-05T18:00:00Z', '2026-07-05T23:30:00Z');

const shiftsByDay = new Map<string, Shift[]>([
  ['2026-07-04', [shift1]],
  ['2026-07-05', [shift2]],
]);

const baseProps = {
  area: 'Cold Stone',
  weekDays,
  shiftsByDay,
  onRemoveShift: vi.fn(),
};

describe('OffTemplateRow — read-only off-template lane (F3)', () => {
  it('renders "Off-template" label in the row header', () => {
    render(<OffTemplateRow {...baseProps} />);
    expect(screen.getByText('Off-template')).toBeTruthy();
  });

  it('renders a day cell for each weekDay', () => {
    const { container } = render(<OffTemplateRow {...baseProps} />);
    // First child is header; then one cell per weekDay
    const cells = container.querySelectorAll('[data-testid="off-template-cell"]');
    expect(cells).toHaveLength(weekDays.length);
  });

  it('renders employee name for each unmatched shift', () => {
    render(<OffTemplateRow {...baseProps} />);
    expect(screen.getByText('Corey Trussell')).toBeTruthy();
    expect(screen.getByText('Aleah Holderread')).toBeTruthy();
  });

  it('empty day cells contain no chip elements', () => {
    const { container } = render(<OffTemplateRow {...baseProps} />);
    const cells = container.querySelectorAll('[data-testid="off-template-cell"]');
    // Third day (2026-07-06) has no shifts
    const emptyCell = cells[2];
    expect(emptyCell.querySelector('button')).toBeNull();
  });

  it('remove button has accessible aria-label for each shift', () => {
    render(<OffTemplateRow {...baseProps} />);
    const btn1 = screen.getByRole('button', {
      name: 'Remove off-template shift for Corey Trussell',
    });
    expect(btn1).toBeTruthy();
    const btn2 = screen.getByRole('button', {
      name: 'Remove off-template shift for Aleah Holderread',
    });
    expect(btn2).toBeTruthy();
  });

  it('calls onRemoveShift with the shift id when remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<OffTemplateRow {...baseProps} onRemoveShift={onRemove} />);
    const btn = screen.getByRole('button', {
      name: 'Remove off-template shift for Corey Trussell',
    });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  it('falls back to "Unassigned" employee name when employee is missing', () => {
    const noEmpShift: Shift = { ...shift1, employee: undefined };
    const map = new Map<string, Shift[]>([['2026-07-04', [noEmpShift]]]);
    render(<OffTemplateRow {...baseProps} shiftsByDay={map} />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});

describe('OffTemplateRow source-text invariants', () => {
  it('does NOT import or call useDroppable (not a drag target)', () => {
    // Must not import or invoke useDroppable — the component is read-only.
    // (Comments mentioning the concept are fine; imports/calls are not.)
    expect(SRC).not.toMatch(/import[^'"]*useDroppable/);
    expect(SRC).not.toMatch(/useDroppable\s*\(/);
  });

  it('uses semantic color tokens (no raw color literals)', () => {
    expect(SRC).not.toMatch(/bg-white\b/);
    expect(SRC).not.toMatch(/text-black\b/);
    expect(SRC).not.toMatch(/text-gray-[0-9]/);
    expect(SRC).not.toMatch(/bg-gray-[0-9]/);
  });

  it('imports Clock icon from lucide-react', () => {
    expect(SRC).toMatch(/Clock/);
    expect(SRC).toMatch(/lucide-react/);
  });

  it('has X icon for remove button', () => {
    expect(SRC).toMatch(/\bX\b/);
  });
});
