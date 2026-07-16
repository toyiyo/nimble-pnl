/**
 * Tests for ShiftCell ghost (read-only) mode when its template is hidden
 * (Phase 4 task 5 of the "Hide shift templates" feature).
 *
 * Design doc: docs/superpowers/specs/2026-07-05-hide-shift-templates-design.md
 * Plan: docs/superpowers/plans/2026-07-05-hide-shift-templates-plan.md (Task 5)
 *
 * Invariants under `isHiddenTemplate=true`:
 *  1. Drop-target / assign affordances suppressed (`useDroppable` called with `disabled: true`).
 *  2. Mobile tap-to-assign suppressed (no onClick handler even with hasMobileSelection).
 *  3. No open-slot / coverage indicator rendered, even if `coverage` is passed.
 *  4. Existing shift chips still render, but dimmed (`opacity-60` on the cell wrapper).
 *  5. Cell carries `aria-label={`${dayLabel}, hidden template`}` (mirrors the inactive-day
 *     aria-label pattern), so screen readers can tell a ghost cell from an ordinary empty cell.
 *  6. Chip remove buttons keep working (chips are read-only for assignment, not for removal)
 *     — the design says shifts are "kept", not frozen; removal isn't disabled here — only
 *     assignment/drop/coverage affordances are.
 *  7. memo comparator includes `isHiddenTemplate`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';
import type { Shift, SlotCoverage } from '@/types/scheduling';

function makeShift(overrides?: Partial<Shift>): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-04T21:00:00Z',
    end_time: '2026-07-05T04:30:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '2026-07-04T00:00:00Z',
    updated_at: '2026-07-04T00:00:00Z',
    employee: { id: 'e1', name: 'Termora', area: 'Cold Stone', position: 'Server' } as Shift['employee'],
    ...overrides,
  };
}

function makeCoverage(overrides?: Partial<SlotCoverage>): SlotCoverage {
  return {
    minConcurrent: 1,
    openSpots: 1,
    coveragePct: 50,
    segments: [{ startMin: 600, endMin: 990, covered: false }],
    coveringEmployees: [],
    ...overrides,
  };
}

let lastDroppableArgs: { id: string; data: unknown; disabled?: boolean } | undefined;
vi.mock('@dnd-kit/core', () => ({
  useDroppable: (args: { id: string; data: unknown; disabled?: boolean }) => {
    lastDroppableArgs = args;
    return { isOver: false, setNodeRef: () => {} };
  },
}));

const BASE_PROPS = {
  templateId: 't1',
  day: '2026-07-04',
  isActiveDay: true,
  shifts: [],
  capacity: 1,
  onRemoveShift: vi.fn(),
};

describe('ShiftCell hidden-template ghost mode', () => {
  it('disables the droppable (no drop-target assignment) when isHiddenTemplate', () => {
    render(<ShiftCell {...BASE_PROPS} isHiddenTemplate />);
    expect(lastDroppableArgs?.disabled).toBe(true);
  });

  it('keeps the droppable enabled for an active-day, non-hidden cell', () => {
    render(<ShiftCell {...BASE_PROPS} isHiddenTemplate={false} />);
    expect(lastDroppableArgs?.disabled).toBe(false);
  });

  it('suppresses mobile tap-to-assign even when hasMobileSelection is true', () => {
    const onMobileTap = vi.fn();
    const { container } = render(
      <ShiftCell
        {...BASE_PROPS}
        isHiddenTemplate
        hasMobileSelection
        onMobileTap={onMobileTap}
      />,
    );
    const cell = container.querySelector('[aria-label]') as HTMLElement;
    fireEvent.click(cell);
    expect(onMobileTap).not.toHaveBeenCalled();
  });

  it('does not apply the mobile-selection highlight/cursor styling when hidden', () => {
    const { container } = render(
      <ShiftCell
        {...BASE_PROPS}
        isHiddenTemplate
        hasMobileSelection
        onMobileTap={vi.fn()}
      />,
    );
    const cell = container.querySelector('[aria-label]') as HTMLElement;
    expect(cell.className).not.toContain('cursor-pointer');
  });

  it('does not render the coverage indicator even when coverage is provided', () => {
    const coverage = makeCoverage();
    render(<ShiftCell {...BASE_PROPS} isHiddenTemplate coverage={coverage} />);
    expect(screen.queryByRole('button', { name: /Coverage/i })).toBeNull();
  });

  it('does not render the fallback capacity badge when hidden (capacity > 1)', () => {
    render(<ShiftCell {...BASE_PROPS} isHiddenTemplate capacity={3} shifts={[]} />);
    // Fallback badge renders bare "N/N" text with no accessible role; assert it's absent.
    expect(screen.queryByText('0/3')).toBeNull();
  });

  it('still renders existing shift chips, dimmed', () => {
    const shift = makeShift();
    const { container } = render(
      <ShiftCell {...BASE_PROPS} isHiddenTemplate shifts={[shift]} />,
    );
    expect(screen.getByText('Termora')).toBeTruthy();
    const cell = container.querySelector('[aria-label]') as HTMLElement;
    expect(cell.className).toContain('opacity-60');
  });

  it('chip remove buttons still call onRemoveShift when hidden', () => {
    const onRemoveShift = vi.fn();
    const shift = makeShift({ id: 's-remove' });
    render(
      <ShiftCell {...BASE_PROPS} isHiddenTemplate shifts={[shift]} onRemoveShift={onRemoveShift} />,
    );
    const removeBtn = screen.getByRole('button', { name: /Remove Termora/i });
    fireEvent.click(removeBtn);
    expect(onRemoveShift).toHaveBeenCalledWith('s-remove');
  });

  it('sets aria-label to "<dayLabel>, hidden template" when dayLabel is provided', () => {
    const { container } = render(
      <ShiftCell {...BASE_PROPS} isHiddenTemplate dayLabel="Monday" />,
    );
    const cell = container.querySelector('[aria-label="Monday, hidden template"]');
    expect(cell).toBeTruthy();
  });

  it('falls back to the raw day value in aria-label when dayLabel is omitted', () => {
    const { container } = render(<ShiftCell {...BASE_PROPS} isHiddenTemplate />);
    const cell = container.querySelector('[aria-label="2026-07-04, hidden template"]');
    expect(cell).toBeTruthy();
  });

  it('does not affect the inactive-day branch aria-label (inactive day wins, day-format unchanged)', () => {
    const { container } = render(
      <ShiftCell {...BASE_PROPS} isHiddenTemplate isActiveDay={false} dayLabel="Monday" />,
    );
    const cell = container.firstChild as HTMLElement;
    // Inactive-day branch keeps its own existing aria-label contract.
    expect(cell.getAttribute('aria-label')).toBe('2026-07-04 inactive');
  });

  it('renders normally (no ghost aria-label) when isHiddenTemplate is false/omitted', () => {
    const { container } = render(<ShiftCell {...BASE_PROPS} dayLabel="Monday" />);
    const cell = container.querySelector('[aria-label]');
    expect(cell).toBeNull();
  });
});

// ── source-text invariants ────────────────────────────────────────────────────

const SRC = readFileSync(
  resolve(__dirname, '../../src/components/scheduling/ShiftPlanner/ShiftCell.tsx'),
  'utf-8',
);

describe('ShiftCell source-text invariants — hidden-template ghost mode', () => {
  it('accepts isHiddenTemplate in the props interface', () => {
    expect(SRC).toMatch(/isHiddenTemplate\??\s*:\s*boolean/);
  });

  it('memo comparator includes isHiddenTemplate check', () => {
    expect(SRC).toMatch(/prev\.isHiddenTemplate\s*===\s*next\.isHiddenTemplate/);
  });

  it('ghost aria-label mirrors the inactive-day pattern ("hidden template")', () => {
    expect(SRC).toMatch(/hidden template/);
  });
});
