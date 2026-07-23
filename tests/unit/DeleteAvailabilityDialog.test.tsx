import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deleteAvailabilityMutate = vi.fn();
const deleteExceptionMutate = vi.fn();
const deleteAvailabilityMock = vi.fn(() => ({ mutate: deleteAvailabilityMutate, isPending: false }));
const deleteExceptionMock = vi.fn(() => ({ mutate: deleteExceptionMutate, isPending: false }));

vi.mock('@/hooks/useAvailability', () => ({
  useDeleteAvailability: (...args: unknown[]) => deleteAvailabilityMock(...args),
  useDeleteAvailabilityException: (...args: unknown[]) => deleteExceptionMock(...args),
}));

import { DeleteAvailabilityDialog } from '@/components/scheduling/DeleteAvailabilityDialog';
import type { AvailabilityDeletionTarget } from '@/components/scheduling/DeleteAvailabilityDialog';
import { utcTimeToLocalTime } from '@/lib/availabilityTimeUtils';
import { formatHourToTime } from '@/lib/timeUtils';
import { parseDateOnly } from '@/lib/dateOnly';

function expectedLocalTime(utc: string, timezone: string, referenceDate: Date): string {
  const local = utcTimeToLocalTime(utc, timezone, referenceDate);
  const [h, m] = local.split(':').map(Number);
  return formatHourToTime(h + m / 60);
}

const availableRow = {
  id: 'avail-1',
  restaurant_id: 'rest-1',
  employee_id: 'emp-1',
  day_of_week: 3, // Wednesday
  start_time: '14:00:00',
  end_time: '22:00:00',
  is_available: true,
  created_at: '',
  updated_at: '',
};

const unavailableRow = {
  ...availableRow,
  id: 'avail-2',
  is_available: false,
};

const exceptionRow = {
  id: 'exc-1',
  restaurant_id: 'rest-1',
  employee_id: 'emp-1',
  date: '2026-07-24',
  start_time: '18:00:00',
  end_time: '22:00:00',
  is_available: true,
  created_at: '',
  updated_at: '',
};

const onOpenChange = vi.fn();
const TIMEZONE = 'America/New_York';

function renderDialog(
  target: AvailabilityDeletionTarget | null,
  props: Partial<React.ComponentProps<typeof DeleteAvailabilityDialog>> = {},
) {
  return render(
    <DeleteAvailabilityDialog
      open={true}
      onOpenChange={onOpenChange}
      target={target}
      restaurantId="rest-1"
      timezone={TIMEZONE}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAvailabilityMock.mockReturnValue({ mutate: deleteAvailabilityMutate, isPending: false });
  deleteExceptionMock.mockReturnValue({ mutate: deleteExceptionMutate, isPending: false });
});

describe('DeleteAvailabilityDialog', () => {
  it('renders nothing when there is no deletion target', () => {
    const { container } = renderDialog(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('available variant: no hero warning, no ack checkbox, and the confirm button is enabled', () => {
    renderDialog({ kind: 'availability', row: availableRow, personName: 'Jamie Chen' });

    expect(screen.getByRole('heading', { name: /remove availability\?/i })).toBeInTheDocument();
    expect(screen.getByText(/low impact/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/guardrail/i)).not.toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: /remove availability/i });
    expect(confirmButton).toBeEnabled();
  });

  it('shows TZ-aware local time for a recurring window, anchored to today', () => {
    renderDialog({ kind: 'availability', row: availableRow, personName: 'Jamie Chen' });

    const expectedStart = expectedLocalTime('14:00:00', TIMEZONE, new Date());
    const expectedEnd = expectedLocalTime('22:00:00', TIMEZONE, new Date());
    expect(
      screen.getByText(new RegExp(`${expectedStart}.*${expectedEnd}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/Wednesday/)).toBeInTheDocument();
  });

  it('unavailable variant: renders the guardrail hero and gates the confirm button until acknowledged', async () => {
    renderDialog({ kind: 'availability', row: unavailableRow, personName: 'Jamie Chen' });

    expect(screen.getByRole('heading', { name: /delete this block\?/i })).toBeInTheDocument();
    expect(screen.getByText(/high impact/i)).toBeInTheDocument();
    expect(screen.getByText(/this block is a guardrail/i)).toBeInTheDocument();
    expect(screen.getByText(/jamie chen told you they can't work/i)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: /delete block/i });
    expect(confirmButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', {
      name: /i understand shifts can be booked during a time jamie chen marked off/i,
    });
    await userEvent.click(checkbox);
    expect(confirmButton).toBeEnabled();
  });

  it('resets the acknowledgment checkbox when a new target is opened', async () => {
    const { rerender } = renderDialog({
      kind: 'availability',
      row: unavailableRow,
      personName: 'Jamie Chen',
    });

    const checkbox = screen.getByRole('checkbox');
    await userEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /delete block/i })).toBeEnabled();

    rerender(
      <DeleteAvailabilityDialog
        open={true}
        onOpenChange={onOpenChange}
        target={{ kind: 'availability', row: { ...unavailableRow, id: 'avail-3' }, personName: 'Alex Rivera' }}
        restaurantId="rest-1"
        timezone={TIMEZONE}
      />,
    );

    expect(screen.getByRole('button', { name: /delete block/i })).toBeDisabled();
  });

  it('exception variant: shows the exception date instead of a weekday label', () => {
    renderDialog({ kind: 'exception', row: exceptionRow, personName: 'Jamie Chen' });

    expect(screen.getByText(/Jul 24/)).toBeInTheDocument();
    expect(screen.queryByText(/Wednesday/)).not.toBeInTheDocument();

    const expectedStart = expectedLocalTime('18:00:00', TIMEZONE, parseDateOnly('2026-07-24'));
    const expectedEnd = expectedLocalTime('22:00:00', TIMEZONE, parseDateOnly('2026-07-24'));
    expect(
      screen.getByText(new RegExp(`${expectedStart}.*${expectedEnd}`)),
    ).toBeInTheDocument();
  });

  it('calls useDeleteAvailability.mutate with {id, restaurantId} and closes on success for a recurring row', () => {
    deleteAvailabilityMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
    renderDialog({ kind: 'availability', row: availableRow, personName: 'Jamie Chen' });

    screen.getByRole('button', { name: /remove availability/i }).click();

    expect(deleteAvailabilityMutate).toHaveBeenCalledWith(
      { id: 'avail-1', restaurantId: 'rest-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(deleteExceptionMutate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls useDeleteAvailabilityException.mutate for an exception target', async () => {
    renderDialog({ kind: 'exception', row: exceptionRow, personName: 'Jamie Chen' });

    await userEvent.click(screen.getByRole('button', { name: /remove availability/i }));

    expect(deleteExceptionMutate).toHaveBeenCalledWith(
      { id: 'exc-1', restaurantId: 'rest-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(deleteAvailabilityMutate).not.toHaveBeenCalled();
  });

  it('control-group gating: disables Cancel and the confirm button while a delete is in-flight', () => {
    deleteAvailabilityMock.mockReturnValue({ mutate: deleteAvailabilityMutate, isPending: true });
    renderDialog({ kind: 'availability', row: availableRow, personName: 'Jamie Chen' });

    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /removing/i })).toBeDisabled();
  });

  it('control-group gating: an in-flight exception delete also disables Cancel', () => {
    deleteExceptionMock.mockReturnValue({ mutate: deleteExceptionMutate, isPending: true });
    renderDialog({ kind: 'exception', row: exceptionRow, personName: 'Jamie Chen' });

    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });
});
