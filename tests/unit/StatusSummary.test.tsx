import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusSummary } from '@/components/time-clock/StatusSummary';

const baseProps = {
  kioskActive: true,
  totalHours: 4,
  employeesWithPins: 2,
  totalEmployees: 2,
  date: '2026-09-28',
};

describe('StatusSummary off-site and no-location pills', () => {
  it('shows the off-site pill and calls onShowOffsite on click', async () => {
    const user = userEvent.setup();
    const onShowOffsite = vi.fn();
    render(
      <StatusSummary
        {...baseProps}
        offsiteCount={2}
        onShowOffsite={onShowOffsite}
      />
    );

    const button = screen.getByRole('button', {
      name: '2 off-site punches. Show them in the punch list.',
    });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onShowOffsite).toHaveBeenCalledTimes(1);
  });

  it('hides the off-site pill when offsiteCount is 0', () => {
    render(
      <StatusSummary
        {...baseProps}
        offsiteCount={0}
        onShowOffsite={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /off-site punches/ })
    ).not.toBeInTheDocument();
  });

  it('shows the no-location pill and calls onShowLocationUnavailable on click', async () => {
    const user = userEvent.setup();
    const onShowLocationUnavailable = vi.fn();
    render(
      <StatusSummary
        {...baseProps}
        locationUnavailableCount={1}
        onShowLocationUnavailable={onShowLocationUnavailable}
      />
    );

    const button = screen.getByRole('button', {
      name: '1 no-location punches. Show them in the punch list.',
    });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onShowLocationUnavailable).toHaveBeenCalledTimes(1);
  });

  it('hides the no-location pill when locationUnavailableCount is 0', () => {
    render(
      <StatusSummary
        {...baseProps}
        locationUnavailableCount={0}
        onShowLocationUnavailable={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /no-location punches/ })
    ).not.toBeInTheDocument();
  });
});
