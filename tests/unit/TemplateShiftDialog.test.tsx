import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { TemplateShiftDialog } from '@/components/scheduling/WeekTemplates/TemplateShiftDialog';

import type { DraftShiftInput } from '@/types/scheduling';

const initial: DraftShiftInput = {
  start_time: '09:00:00',
  end_time: '17:00:00',
  break_duration: 30,
  position: 'Server',
  notes: null,
};

function setup(overrides: Partial<React.ComponentProps<typeof TemplateShiftDialog>> = {}) {
  const props: React.ComponentProps<typeof TemplateShiftDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    mode: 'add',
    employeeName: 'Alice',
    initial,
    initialDay: 2,
    findOverlapDays: vi.fn(() => []),
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<TemplateShiftDialog {...props} />);
  return props;
}

describe('TemplateShiftDialog', () => {
  it('add mode: preselects the clicked day and submits HH:MM times with the chosen days', () => {
    const props = setup();
    expect(screen.getByRole('button', { name: 'Wednesday' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));

    expect(props.onSubmit).toHaveBeenCalledWith(
      { start_time: '10:00', end_time: '17:00', break_duration: 30, position: 'Server', notes: null },
      [0, 2],
    );
  });

  it('add mode: needs at least one day', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled();
    expect(screen.getByText('Select at least one day')).toBeInTheDocument();
  });

  it('blocks a shift whose start equals its end', () => {
    setup();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '09:00' } });
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled();
    expect(screen.getByText('Start and end must differ')).toBeInTheDocument();
  });

  it('blocks a blank position', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled();
  });

  it('shows the overlap error as an alert and blocks submit', () => {
    setup({ findOverlapDays: vi.fn(() => [2]) });
    expect(screen.getByRole('alert')).toHaveTextContent('Alice already has a shift at this time on Wednesday');
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled();
  });

  it('edit mode: hides the day picker, shows Delete, and submits the single day', () => {
    const props = setup({ mode: 'edit' });
    expect(screen.queryByRole('button', { name: 'Monday' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(props.onSubmit).toHaveBeenCalledWith(
      { start_time: '09:00', end_time: '17:00', break_duration: 30, position: 'Server', notes: null },
      [2],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete shift' }));
    expect(props.onDelete).toHaveBeenCalled();
  });
});
