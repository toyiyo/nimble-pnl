import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ShiftCell } from '@/components/scheduling/ShiftPlanner/ShiftCell';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}));

describe('ShiftCell day indicators', () => {
  it('renders hatched pattern for inactive days', () => {
    const { container } = render(
      <ShiftCell
        templateId="t1"
        day="2026-03-01"
        isActiveDay={false}
        shifts={[]}
        onRemoveShift={() => {}}
      />,
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.style.backgroundImage).toContain('repeating-linear-gradient');
  });

  it('renders active indicator border for active days', () => {
    const { container } = render(
      <ShiftCell
        templateId="t1"
        day="2026-03-03"
        isActiveDay={true}
        shifts={[]}
        onRemoveShift={() => {}}
      />,
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('border-l-2');
    expect(cell.className).toContain('border-primary/40');
  });

  it('inactive days have reduced opacity', () => {
    const { container } = render(
      <ShiftCell
        templateId="t1"
        day="2026-03-01"
        isActiveDay={false}
        shifts={[]}
        onRemoveShift={() => {}}
      />,
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('opacity-60');
  });
});
