import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeOffShiftsDialog } from '../../src/components/timeoff/TimeOffShiftsDialog';
import type { TimeOffRequest } from '../../src/types/scheduling';
import type { CoverageImpactShift } from '../../src/hooks/useShiftProtection';

const request = {
  id: 'req-1',
  restaurant_id: 'rest-1',
  employee_id: 'e-1',
  start_date: '2026-11-02',
  end_date: '2026-11-04',
  reason: 'Family trip',
  status: 'pending',
  employee: { id: 'e-1', name: 'Maria Lopez' },
} as unknown as TimeOffRequest;

const shift = (id: string, date: string): CoverageImpactShift => ({
  shift_id: id,
  shift_date: date,
  position: 'Server',
  start_time: `${date}T16:00:00Z`,
  end_time: `${date}T23:00:00Z`,
  required: 2,
  current_count: 2,
  after_count: 1,
});

const shifts = [shift('s1', '2026-11-02'), shift('s2', '2026-11-03'), shift('s3', '2026-11-04')];

function setup(props: Partial<React.ComponentProps<typeof TimeOffShiftsDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <TimeOffShiftsDialog
      request={request}
      shifts={shifts}
      submitting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onConfirm, onCancel };
}

describe('TimeOffShiftsDialog', () => {
  it('names the employee and the shift count', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Approve time off' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Maria Lopez is scheduled for 3 shifts in these dates.');
    expect(screen.getAllByTestId('timeoff-shift-row')).toHaveLength(3);
  });

  it('defaults to a trade with the Approved PTO note', () => {
    const { onConfirm } = setup();
    expect(screen.getByLabelText('Trade note')).toHaveValue('Approved PTO');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post 3 shifts' }));
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'trade', note: 'Approved PTO' });
  });

  it('hides the note and changes the button for a delete', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByLabelText('Delete the shifts'));
    expect(screen.queryByLabelText('Trade note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and delete 3 shifts' }));
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'delete' });
  });

  it('submits on Enter in the note input', () => {
    const { onConfirm } = setup();
    const input = screen.getByLabelText('Trade note');
    fireEvent.change(input, { target: { value: 'Vacation' } });
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'trade', note: 'Vacation' });
  });

  it('locks every control while submitting', () => {
    setup({ submitting: true });
    expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Trade note')).toBeDisabled();
    expect(screen.getByLabelText('Delete the shifts')).toBeDisabled();
  });

  it('ignores Esc while submitting', () => {
    const { onCancel } = setup({ submitting: true });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel on Esc when idle', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('keeps the footer on screen with a scroll region for the shift list', () => {
    setup();
    expect(screen.getByTestId('timeoff-shift-list').className).toContain('max-h-48');
    expect(screen.getByTestId('timeoff-shift-list').className).toContain('overflow-y-auto');
  });
});
