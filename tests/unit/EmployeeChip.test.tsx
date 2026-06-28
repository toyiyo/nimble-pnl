/**
 * Tests for EmployeeChip — covering badge (F1).
 *
 * RED → GREEN → REFACTOR TDD cycle.
 *
 * Invariants:
 * 1. Renders employee name.
 * 2. Remove button has default aria-label when NOT covering.
 * 3. When homeArea !== cellArea, chip has "border-dashed" class.
 * 4. When homeArea !== cellArea, origin badge renders the homeArea text.
 * 5. When homeArea !== cellArea, Remove button aria-label includes "(covering from <homeArea>)".
 * 6. When homeArea === cellArea, chip does NOT have "border-dashed".
 * 7. When homeArea === cellArea, no origin badge is rendered.
 * 8. When homeArea is null, no origin badge is rendered and no dashed border.
 * 9. When cellArea is null, no origin badge is rendered and no dashed border.
 * 10. Memo comparator: homeArea and cellArea are in the comparator (source-text invariant).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

describe('EmployeeChip — covering badge (F1)', () => {
  it('renders the employee name', () => {
    render(<EmployeeChip {...baseProps} />);
    expect(screen.getByText('Termora Johnson')).toBeTruthy();
  });

  it('Remove button has default aria-label when not covering', () => {
    render(<EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Cold Stone" />);
    const btn = screen.getByRole('button', { name: 'Remove Termora Johnson from shift' });
    expect(btn).toBeTruthy();
  });

  it('chip has border-dashed class when homeArea !== cellArea (covering)', () => {
    const { container } = render(
      <EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Wetzel's" />,
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain('border-dashed');
  });

  it('renders origin badge with homeArea text when covering', () => {
    render(<EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Wetzel's" />);
    expect(screen.getByText('Cold Stone')).toBeTruthy();
  });

  it('Remove button aria-label includes "(covering from <homeArea>)" when covering', () => {
    render(<EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Wetzel's" />);
    const btn = screen.getByRole('button', {
      name: "Remove Termora Johnson from shift (covering from Cold Stone)",
    });
    expect(btn).toBeTruthy();
  });

  it('chip does NOT have border-dashed when homeArea === cellArea', () => {
    const { container } = render(
      <EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Cold Stone" />,
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).not.toContain('border-dashed');
  });

  it('no origin badge rendered when homeArea === cellArea', () => {
    render(<EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea="Cold Stone" />);
    // "Cold Stone" should NOT appear as a badge (the name text is separate)
    // We check that there's no element with title "Covering from Cold Stone"
    const badge = document.querySelector('[title="Covering from Cold Stone"]');
    expect(badge).toBeNull();
  });

  it('no origin badge when homeArea is null', () => {
    render(<EmployeeChip {...baseProps} homeArea={null} cellArea="Wetzel's" />);
    const badge = document.querySelector('[title^="Covering from"]');
    expect(badge).toBeNull();
  });

  it('no dashed border when homeArea is null', () => {
    const { container } = render(
      <EmployeeChip {...baseProps} homeArea={null} cellArea="Wetzel's" />,
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).not.toContain('border-dashed');
  });

  it('no origin badge when cellArea is null', () => {
    render(<EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea={null} />);
    const badge = document.querySelector('[title^="Covering from"]');
    expect(badge).toBeNull();
  });

  it('no dashed border when cellArea is null', () => {
    const { container } = render(
      <EmployeeChip {...baseProps} homeArea="Cold Stone" cellArea={null} />,
    );
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).not.toContain('border-dashed');
  });
});

describe('EmployeeChip source-text invariants', () => {
  it('memo comparator checks homeArea', () => {
    expect(SRC).toMatch(/homeArea/);
    // The comparator must reference homeArea (prev.homeArea === next.homeArea)
    expect(SRC).toMatch(/prev\.homeArea.*next\.homeArea|next\.homeArea.*prev\.homeArea/);
  });

  it('memo comparator checks cellArea', () => {
    expect(SRC).toMatch(/cellArea/);
    expect(SRC).toMatch(/prev\.cellArea.*next\.cellArea|next\.cellArea.*prev\.cellArea/);
  });

  it('origin badge uses bg-muted/50 semantic token (no raw colors)', () => {
    // The badge should use semantic tokens from CLAUDE.md
    expect(SRC).toMatch(/bg-muted\/50/);
    expect(SRC).toMatch(/text-muted-foreground/);
  });

  it('badge has truncate and max-w-[72px] to prevent overflow', () => {
    expect(SRC).toMatch(/truncate/);
    expect(SRC).toMatch(/max-w-\[72px\]/);
  });

  it('does NOT use raw color literals for the covering state', () => {
    // Must not introduce raw color classes for the covering badge
    expect(SRC).not.toMatch(/bg-yellow-[0-9]/);
    expect(SRC).not.toMatch(/text-yellow-[0-9]/);
    expect(SRC).not.toMatch(/border-yellow-[0-9]/);
  });
});
