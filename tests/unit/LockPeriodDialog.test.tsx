import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { LockPeriodDialog } from '@/components/tips/LockPeriodDialog';
import { render, screen, fireEvent } from '@testing-library/react';

describe('LockPeriodDialog', () => {
  it('renders with the correct period label', () => {
    render(
      <LockPeriodDialog
        open={true}
        periodLabel="Week of Jan 19"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText(/Lock tips for Week of Jan 19\?/i)).toBeInTheDocument();
  });

  it('calls onConfirm when Lock Period button is clicked', () => {
    const handleConfirm = vi.fn();
    render(
      <LockPeriodDialog
        open={true}
        periodLabel="Week of Jan 19"
        onConfirm={handleConfirm}
        onCancel={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Confirm lock'));
    expect(handleConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(
      <LockPeriodDialog
        open={true}
        periodLabel="Week of Jan 19"
        onConfirm={() => {}}
        onCancel={handleCancel}
      />
    );

    fireEvent.click(screen.getByLabelText('Cancel lock'));
    expect(handleCancel).toHaveBeenCalled();
  });

  it('disables buttons when loading', () => {
    render(
      <LockPeriodDialog
        open={true}
        periodLabel="Week of Jan 19"
        onConfirm={() => {}}
        onCancel={() => {}}
        loading={true}
      />
    );

    expect(screen.getByLabelText('Confirm lock')).toBeDisabled();
    expect(screen.getByLabelText('Cancel lock')).toBeDisabled();
  });

  it('shows informational message about locking', () => {
    render(
      <LockPeriodDialog
        open={true}
        periodLabel="Week of Jan 19"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    // The message is split across elements, so check for key phrases
    expect(screen.getByText(/Locking ensures/i)).toBeInTheDocument();
  });
});
