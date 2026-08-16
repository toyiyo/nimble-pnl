import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PublishedShiftChangeDialog } from '@/components/scheduling/PublishedShiftChangeDialog';

const onOpenChange = vi.fn();
const onConfirm = vi.fn();

const renderDialog = (overrides: Partial<React.ComponentProps<typeof PublishedShiftChangeDialog>> = {}) =>
  render(
    <PublishedShiftChangeDialog
      open
      onOpenChange={onOpenChange}
      employeeName="Alex Rivera"
      isPending={false}
      onConfirm={onConfirm}
      {...overrides}
    />
  );

describe('PublishedShiftChangeDialog', () => {
  beforeEach(() => {
    onOpenChange.mockClear();
    onConfirm.mockClear();
  });

  it('renders the title, description, and both buttons', () => {
    renderDialog();
    expect(screen.getByText('This shift is published')).toBeInTheDocument();
    expect(
      screen.getByText('Alex Rivera can see this shift. Save the change anyway?')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save change' })).toBeInTheDocument();
  });

  it('names both employees on a reassignment', () => {
    renderDialog({ secondEmployeeName: 'Jamie Chen' });
    expect(
      screen.getByText('Alex Rivera and Jamie Chen can see this shift. Save the change anyway?')
    ).toBeInTheDocument();
  });

  it('checks the notify checkbox by default', () => {
    renderDialog();
    const checkbox = screen.getByRole('checkbox', { name: /Notify Alex Rivera about this change/i });
    expect(checkbox).toHaveAttribute('data-state', 'checked');
  });

  it('calls onConfirm with notify: true when the checkbox stays checked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ notify: true });
  });

  it('calls onConfirm with notify: false after the checkbox is unchecked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /Notify Alex Rivera about this change/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
    expect(onConfirm).toHaveBeenCalledWith({ notify: false });
  });

  it('disables both buttons while pending', () => {
    renderDialog({ isPending: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save change' })).toBeDisabled();
  });
});
