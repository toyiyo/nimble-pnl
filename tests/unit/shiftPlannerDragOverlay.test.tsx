import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DragOverlayChip } from '@/components/scheduling/ShiftPlanner/DragOverlayChip';

describe('DragOverlayChip', () => {
  it('renders employee name', () => {
    render(<DragOverlayChip name="Jane Doe" />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('has cursor-grabbing class', () => {
    const { container } = render(<DragOverlayChip name="Jane Doe" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain('cursor-grabbing');
  });

  it('has shadow styling for floating ghost appearance', () => {
    const { container } = render(<DragOverlayChip name="Jane Doe" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain('shadow');
  });

  it('has ring styling for visual emphasis', () => {
    const { container } = render(<DragOverlayChip name="Jane Doe" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain('ring');
  });

  it('renders only the name, not position or shift count', () => {
    render(<DragOverlayChip name="Alice Smith" />);
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    // The component should only accept a name prop -- no position or shiftCount
  });
});
