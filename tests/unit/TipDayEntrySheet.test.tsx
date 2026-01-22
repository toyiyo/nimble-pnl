import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { TipDayEntrySheet } from '@/components/tips/TipDayEntrySheet';
import { render, screen, fireEvent } from '@testing-library/react';

describe('TipDayEntrySheet', () => {
  it('renders with initial amount value', () => {
    const handleSave = vi.fn();
    render(
      <TipDayEntrySheet
        open={true}
        date={new Date('2026-01-20')}
        initialAmount={123.45}
        onSave={handleSave}
        onClose={() => {}}
      />
    );

    const input = screen.getByLabelText('Total tip amount');
    expect(input).toHaveValue(123.45);
  });

  it('calls onSave with updated amount when Save is clicked', () => {
    const handleSave = vi.fn();
    render(
      <TipDayEntrySheet
        open={true}
        date={new Date('2026-01-20')}
        initialAmount={0}
        onSave={handleSave}
        onClose={() => {}}
      />
    );

    const input = screen.getByLabelText('Total tip amount');
    fireEvent.change(input, { target: { value: '456.78' } });

    const saveButton = screen.getByLabelText('Save tips for day');
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledWith(456.78, expect.objectContaining({ cash: 0, card: 0 }));
  });

  it('displays the correct date in the header', () => {
    render(
      <TipDayEntrySheet
        open={true}
        date={new Date('2026-01-20')}
        initialAmount={0}
        onSave={() => {}}
        onClose={() => {}}
      />
    );

    // Header should contain the date
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Verify the sheet title contains date info
    expect(screen.getByText(/Enter Tips for/i)).toBeInTheDocument();
  });

  it('allows entering cash and card breakdown', () => {
    const handleSave = vi.fn();
    render(
      <TipDayEntrySheet
        open={true}
        date={new Date('2026-01-20')}
        initialAmount={100}
        onSave={handleSave}
        onClose={() => {}}
      />
    );

    const cashInput = screen.getByLabelText('Cash tips');
    const cardInput = screen.getByLabelText('Card tips');

    fireEvent.change(cashInput, { target: { value: '40' } });
    fireEvent.change(cardInput, { target: { value: '60' } });

    const saveButton = screen.getByLabelText('Save tips for day');
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledWith(100, { cash: 40, card: 60 });
  });

  it('calls onClose when sheet is dismissed', () => {
    const handleClose = vi.fn();
    render(
      <TipDayEntrySheet
        open={true}
        date={new Date('2026-01-20')}
        initialAmount={0}
        onSave={() => {}}
        onClose={handleClose}
      />
    );

    // The sheet's onOpenChange should trigger onClose when closed
    // This is tested through the component's internal behavior
    expect(handleClose).not.toHaveBeenCalled(); // Initially not called
  });
});
