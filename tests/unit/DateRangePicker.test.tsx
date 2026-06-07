import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from '../../src/components/ui/date-range-picker';

describe('DateRangePicker', () => {
  it('closes the popover only once the range is complete (both ends picked)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    // Start with no range so first click is unambiguous "set from".
    render(<DateRangePicker onSelect={onSelect} />);

    const trigger = screen.getByRole('button');
    await user.click(trigger);

    // Popover is open — trigger aria-expanded is true.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const grids = await screen.findAllByRole('grid');
    // First click sets `from` — range is incomplete, popover stays open.
    await user.click(within(grids[0]).getAllByRole('gridcell', { name: '10' })[0]);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Second click completes the range -> onSelect fires and the popover closes.
    const gridsAfterFirst = screen.getAllByRole('grid');
    await user.click(within(gridsAfterFirst[0]).getAllByRole('gridcell', { name: '20' })[0]);
    expect(onSelect).toHaveBeenCalled();
    // Radix Popover keeps content mounted but sets aria-expanded=false when closed.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
