/**
 * Tests for EmployeeChip — conflict indicator.
 *
 * Invariants:
 * 1. With conflictLines, the chip gets the amber left border classes.
 * 2. With conflictLines, a ConflictBadge button renders before the name.
 * 3. Without conflictLines (or empty), no amber border and no badge.
 * 4. Memo comparator covers conflictLines by length + element equality
 *    (source-text invariant, matching EmployeeChip.test.tsx style).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { TooltipProvider } from '@/components/ui/tooltip';
import { EmployeeChip } from '@/components/scheduling/ShiftPlanner/EmployeeChip';

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/EmployeeChip.tsx'),
  'utf-8',
);

const baseProps = {
  employeeName: 'Termora Johnson',
  shiftId: 'shift-1',
  position: 'Server',
  onRemove: vi.fn(),
};

const LINES = ['Employee has approved time-off from 2026-04-21 to 2026-04-22'];

function renderChip(props: Partial<React.ComponentProps<typeof EmployeeChip>> = {}) {
  return render(
    <TooltipProvider>
      <EmployeeChip {...baseProps} {...props} />
    </TooltipProvider>,
  );
}

describe('EmployeeChip — conflict indicator', () => {
  it('adds the amber left border when conflictLines has entries', () => {
    const { container } = renderChip({ conflictLines: LINES });
    const chip = container.querySelector('.border-l-amber-500');
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain('border-l-2');
  });

  it('renders the ConflictBadge button when conflictLines has entries', () => {
    renderChip({ conflictLines: LINES });
    expect(screen.getByRole('button', { name: /^Conflicts:/ })).toBeTruthy();
  });

  it('renders no amber border and no badge without conflictLines', () => {
    const { container } = renderChip();
    expect(container.querySelector('.border-l-amber-500')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Conflicts:/ })).toBeNull();
  });

  it('renders no amber border and no badge with an empty array', () => {
    const { container } = renderChip({ conflictLines: [] });
    expect(container.querySelector('.border-l-amber-500')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Conflicts:/ })).toBeNull();
  });

  it('keeps the remove button working next to the badge', () => {
    renderChip({ conflictLines: LINES });
    expect(
      screen.getByRole('button', { name: 'Remove Termora Johnson from shift' }),
    ).toBeTruthy();
  });

  it('comparator covers conflictLines by element equality, not a join allocation (source-text)', () => {
    // The comparator must compare prev vs next conflictLines...
    expect(SRC).toMatch(/prev\.conflictLines[\s\S]{0,40}next\.conflictLines/);
    // ...without a per-compare string allocation.
    expect(SRC).not.toMatch(/conflictLines[^\n]*join\(/);
  });
});
