import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissingAvailabilityBanner } from '@/components/scheduling/availability/MissingAvailabilityBanner';

describe('MissingAvailabilityBanner', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(
      <MissingAvailabilityBanner
        count={0}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an alert with pluralized text and two CTA buttons', () => {
    render(
      <MissingAvailabilityBanner
        count={3}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveTextContent(/3 employees can.+t be scheduled/i);
    expect(screen.getByRole('button', { name: /set defaults/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /email reminder/i })).toBeEnabled();
  });

  it('singularizes "1 employee can\'t be scheduled"', () => {
    render(
      <MissingAvailabilityBanner
        count={1}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/1 employee can.+t be scheduled/i);
  });

  it('invokes callbacks on click', () => {
    const onSetDefaults = vi.fn();
    const onSendReminder = vi.fn();
    render(
      <MissingAvailabilityBanner
        count={2}
        onSetDefaults={onSetDefaults}
        onSendReminder={onSendReminder}
        reminderPending={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /email reminder/i }));
    expect(onSetDefaults).toHaveBeenCalledTimes(1);
    expect(onSendReminder).toHaveBeenCalledTimes(1);
  });

  it('disables the reminder button and shows a spinner while reminderPending', () => {
    render(
      <MissingAvailabilityBanner
        count={2}
        onSetDefaults={vi.fn()}
        onSendReminder={vi.fn()}
        reminderPending
      />,
    );
    const reminderBtn = screen.getByRole('button', { name: /email reminder/i });
    expect(reminderBtn).toBeDisabled();
    expect(reminderBtn.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
