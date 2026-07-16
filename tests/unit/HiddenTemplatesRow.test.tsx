/**
 * Tests for HiddenTemplatesRow — read-only "From hidden templates" lane
 * (Phase 4 task 6 of the "Hide shift templates" feature).
 *
 * Design doc: docs/superpowers/specs/2026-07-05-hide-shift-templates-design.md
 *   ("From hidden templates" lane section)
 * Plan: docs/superpowers/plans/2026-07-05-hide-shift-templates-plan.md (Task 6)
 *
 * Invariants:
 *  1. Renders "From hidden templates" label in the row header.
 *  2. Renders a day cell for each weekDay (same grid contract as OffTemplateRow).
 *  3. Subtitle shows "N shift(s) kept" with correct singular/plural.
 *  4. Subtitle includes a "Show templates" button that calls onShowHidden when clicked.
 *  5. Shift chips render (employee name) per day, dimmed treatment (opacity wrapper).
 *  6. Remove button present per chip; calls onRemoveShift with the shift id.
 *  7. Empty day cells contain no chips.
 *  8. Falls back to "Unassigned" when employee is missing.
 *  9. Component does NOT call useDroppable (read-only, not a drag target).
 *  10. Uses semantic color tokens only (no raw color literals).
 *  11. Renders an EyeOff icon (aria-hidden) in the header.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { HiddenTemplatesRow } from '@/components/scheduling/ShiftPlanner/HiddenTemplatesRow';
import type { Shift } from '@/types/scheduling';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/HiddenTemplatesRow.tsx'),
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
  weekDays,
  shiftsByDay,
  onRemoveShift: vi.fn(),
  onShowHidden: vi.fn(),
};

describe('HiddenTemplatesRow — read-only hidden-templates lane', () => {
  it('renders "From hidden templates" label in the row header', () => {
    render(<HiddenTemplatesRow {...baseProps} />);
    expect(screen.getByText('From hidden templates')).toBeTruthy();
  });

  it('renders a day cell for each weekDay', () => {
    const { container } = render(<HiddenTemplatesRow {...baseProps} />);
    const cells = container.querySelectorAll('[data-testid="hidden-templates-cell"]');
    expect(cells).toHaveLength(weekDays.length);
  });

  it('shows "N shifts kept" for plural counts', () => {
    render(<HiddenTemplatesRow {...baseProps} />);
    expect(screen.getByText(/2 shifts kept/)).toBeTruthy();
  });

  it('shows "1 shift kept" (singular) when exactly one shift', () => {
    const map = new Map<string, Shift[]>([['2026-07-04', [shift1]]]);
    render(<HiddenTemplatesRow {...baseProps} shiftsByDay={map} />);
    expect(screen.getByText(/1 shift kept/)).toBeTruthy();
  });

  it('renders a "Show templates" button that calls onShowHidden when clicked', () => {
    const onShowHidden = vi.fn();
    render(<HiddenTemplatesRow {...baseProps} onShowHidden={onShowHidden} />);
    const btn = screen.getByRole('button', { name: 'Show templates' });
    fireEvent.click(btn);
    expect(onShowHidden).toHaveBeenCalledTimes(1);
  });

  it('renders employee name for each shift, dimmed', () => {
    const { container } = render(<HiddenTemplatesRow {...baseProps} />);
    expect(screen.getByText('Corey Trussell')).toBeTruthy();
    expect(screen.getByText('Aleah Holderread')).toBeTruthy();
    const dimmed = container.querySelector('.opacity-60');
    expect(dimmed).toBeTruthy();
  });

  it('empty day cells contain no chip elements', () => {
    const { container } = render(<HiddenTemplatesRow {...baseProps} />);
    const cells = container.querySelectorAll('[data-testid="hidden-templates-cell"]');
    // Third day (2026-07-06) has no shifts
    const emptyCell = cells[2];
    expect(emptyCell.querySelector('button')).toBeNull();
  });

  it('remove button has accessible aria-label and calls onRemoveShift with the shift id', () => {
    const onRemoveShift = vi.fn();
    render(<HiddenTemplatesRow {...baseProps} onRemoveShift={onRemoveShift} />);
    const btn = screen.getByRole('button', { name: /Remove Corey Trussell/i });
    fireEvent.click(btn);
    expect(onRemoveShift).toHaveBeenCalledWith('s1');
  });

  it('remove button keeps a focus-visible outline (keyboard focus stays visible)', () => {
    render(<HiddenTemplatesRow {...baseProps} />);
    const btn = screen.getByRole('button', { name: /Remove Corey Trussell/i });
    expect(btn.className).toContain('focus-visible:outline');
  });

  it('falls back to "Unassigned" employee name when employee is missing', () => {
    const noEmpShift: Shift = { ...shift1, employee: undefined };
    const map = new Map<string, Shift[]>([['2026-07-04', [noEmpShift]]]);
    render(<HiddenTemplatesRow {...baseProps} shiftsByDay={map} />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('renders zero shifts kept when the map is empty', () => {
    render(<HiddenTemplatesRow {...baseProps} shiftsByDay={new Map()} />);
    expect(screen.getByText(/0 shifts kept/)).toBeTruthy();
  });
});

describe('HiddenTemplatesRow source-text invariants', () => {
  it('does NOT import or call useDroppable (not a drag target)', () => {
    expect(SRC).not.toMatch(/import[^'"]*useDroppable/);
    expect(SRC).not.toMatch(/useDroppable\s*\(/);
  });

  it('uses semantic color tokens (no raw color literals)', () => {
    expect(SRC).not.toMatch(/bg-white\b/);
    expect(SRC).not.toMatch(/text-black\b/);
    expect(SRC).not.toMatch(/text-gray-[0-9]/);
    expect(SRC).not.toMatch(/bg-gray-[0-9]/);
  });

  it('imports EyeOff icon from lucide-react', () => {
    expect(SRC).toMatch(/EyeOff/);
    expect(SRC).toMatch(/lucide-react/);
  });
});
