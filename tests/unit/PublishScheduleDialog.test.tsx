import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PublishScheduleDialog } from '@/components/PublishScheduleDialog';

const onOpenChange = vi.fn();
const onConfirm = vi.fn();

const defaultProps = {
  weekStart: new Date('2026-08-17T00:00:00'),
  weekEnd: new Date('2026-08-23T00:00:00'),
  shiftCount: 10,
  employeeCount: 5,
  totalHours: 40,
  openShiftCount: 0,
  openShiftsEnabled: false,
  isPublishing: false,
};

const renderDialog = (overrides: Partial<React.ComponentProps<typeof PublishScheduleDialog>> = {}) =>
  render(
    <PublishScheduleDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      {...defaultProps}
      {...overrides}
    />
  );

describe('PublishScheduleDialog notify checkbox', () => {
  beforeEach(() => {
    onOpenChange.mockClear();
    onConfirm.mockClear();
  });

  it('checks the notify checkbox by default', () => {
    renderDialog();
    const checkbox = screen.getByRole('checkbox', { name: /Notify employees/i });
    expect(checkbox).toHaveAttribute('data-state', 'checked');
  });

  it('resets notify to true and notes to empty on reopen', () => {
    const { rerender } = renderDialog();
    const checkbox = screen.getByRole('checkbox', { name: /Notify employees/i });
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText(/Notes/i), { target: { value: 'Holiday coverage' } });
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByLabelText(/Notes/i)).toHaveValue('Holiday coverage');

    rerender(
      <PublishScheduleDialog
        open={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        {...defaultProps}
      />
    );
    rerender(
      <PublishScheduleDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        {...defaultProps}
      />
    );

    expect(screen.getByRole('checkbox', { name: /Notify employees/i })).toHaveAttribute(
      'data-state',
      'checked'
    );
    expect(screen.getByLabelText(/Notes/i)).toHaveValue('');
  });

  it('calls onConfirm with notes and notify true when the checkbox stays checked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Publish Schedule/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined, true);
  });

  it('calls onConfirm with notify false after the checkbox is unchecked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Notify employees/i }));
    fireEvent.click(screen.getByRole('button', { name: /Publish Schedule/i }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, false);
  });

  it('passes trimmed notes alongside the notify flag', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Notes/i), { target: { value: '  Big event  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish Schedule/i }));
    expect(onConfirm).toHaveBeenCalledWith('Big event', true);
  });
});
