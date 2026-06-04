import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../../src/components/ui/date-picker';

// Radix Popover needs these in jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const JAN_2026 = new Date(2026, 0, 1);

describe('DatePicker', () => {
  it('shows the placeholder when no value is set', () => {
    render(<DatePicker value={undefined} onChange={vi.fn()} placeholder="Pick a date" />);
    expect(screen.getByRole('button', { name: 'Pick a date' })).toBeInTheDocument();
  });

  it('renders the formatted value with the default and a custom dateFormat', () => {
    const { rerender } = render(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} />);
    // default "PPP"
    expect(screen.getByRole('button', { name: /January 15(th)?,? 2026/i })).toBeInTheDocument();
    rerender(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} dateFormat="MMM d, yyyy" />);
    expect(screen.getByRole('button', { name: /Jan 15, 2026/ })).toBeInTheDocument();
  });

  it('opens the calendar grid when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<DatePicker value={undefined} onChange={vi.fn()} defaultMonth={JAN_2026} placeholder="Pick a date" />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('selecting a day calls onChange and CLOSES the popover (the fix)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value={undefined} onChange={onChange} defaultMonth={JAN_2026} placeholder="Pick a date" />);
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as Date;
    expect(arg.getFullYear()).toBe(2026);
    expect(arg.getMonth()).toBe(0);
    expect(arg.getDate()).toBe(15);
    // Radix Popover keeps content mounted but hidden when closed; check the
    // trigger's aria-expanded attribute instead of DOM removal.
    const trigger = screen.getByRole('button', { name: /pick a date/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('re-clicking the selected day clears via onChange(undefined) but KEEPS the popover open (close-guard)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value={new Date(2026, 0, 15)} onChange={onChange} defaultMonth={JAN_2026} />);
    await user.click(screen.getByRole('button'));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('grid')).toBeInTheDocument(); // still open
  });

  it('does not select a disabled day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value={undefined}
        onChange={onChange}
        defaultMonth={JAN_2026}
        disabled={(d) => d.getDate() === 20}
        placeholder="Pick a date"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pick a date' }));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '20' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('opens on the selected value\'s month when no defaultMonth is given', async () => {
    const user = userEvent.setup();
    render(<DatePicker value={new Date(2026, 0, 15)} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText(/January 2026/i)).toBeInTheDocument();
  });

  it('renders a custom children trigger and toggles the popover', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker value={undefined} onChange={vi.fn()} defaultMonth={JAN_2026}>
        <button type="button">Change Date</button>
      </DatePicker>,
    );
    await user.click(screen.getByRole('button', { name: 'Change Date' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('forwards aria-label to the default trigger', () => {
    render(<DatePicker value={undefined} onChange={vi.fn()} aria-label="Select start date" />);
    expect(screen.getByRole('button', { name: 'Select start date' })).toBeInTheDocument();
  });
});
