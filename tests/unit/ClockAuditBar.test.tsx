/**
 * Behavioral tests for src/components/payroll/ClockAuditBar.tsx
 *
 * Pins the summary bar above the payroll table:
 *   - chip counts and labels come from the audit summary,
 *   - a chip click sets the active filter; a second click clears it,
 *   - a zero-count chip renders disabled,
 *   - the tolerance select reports a new value,
 *   - loading shows a skeleton line, error shows an alert line.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ClockAuditBar } from '@/components/payroll/ClockAuditBar';
import type { AuditSummary } from '@/utils/scheduleClockAudit';

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) =>
    React.createElement(
      'select',
      {
        'data-testid': 'tolerance-select',
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
    React.createElement('option', { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const summary: AuditSummary = {
  missingClock: 2,
  openClock: 1,
  timeMismatch: 3,
  unscheduledClock: 1,
  inProgress: 4,
  matched: 6,
  draft: 2,
};

const zeroSummary: AuditSummary = {
  missingClock: 0,
  openClock: 0,
  timeMismatch: 0,
  unscheduledClock: 0,
  inProgress: 0,
  matched: 0,
  draft: 0,
};

const renderBar = (overrides: Partial<React.ComponentProps<typeof ClockAuditBar>> = {}) => {
  const onToleranceChange = vi.fn();
  const onFilterChange = vi.fn();
  render(
    <ClockAuditBar
      summary={summary}
      loading={false}
      error={null}
      tolerance={10}
      onToleranceChange={onToleranceChange}
      activeFilter={null}
      onFilterChange={onFilterChange}
      {...overrides}
    />,
  );
  return { onToleranceChange, onFilterChange };
};

describe('ClockAuditBar', () => {
  it('shows chip counts and labels from the summary', () => {
    renderBar();
    // to fix = missingClock + timeMismatch = 5
    expect(screen.getByRole('button', { name: '5 to fix' })).toBeInTheDocument();
    // no clock-out = openClock = 1
    expect(screen.getByRole('button', { name: '1 no clock-out' })).toBeInTheDocument();
    // info = unscheduledClock + inProgress + draft = 7
    expect(screen.getByRole('button', { name: '7 info' })).toBeInTheDocument();
    // matched = 6
    expect(screen.getByRole('button', { name: '6 matched' })).toBeInTheDocument();
  });

  it('toggles aria-pressed and reports the filter class on click', () => {
    const { onFilterChange } = renderBar();
    const toFixChip = screen.getByRole('button', { name: '5 to fix' });
    expect(toFixChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toFixChip);
    expect(onFilterChange).toHaveBeenCalledWith('to_fix');
  });

  it('clears the filter on a second click of the active chip', () => {
    const { onFilterChange } = renderBar({ activeFilter: 'to_fix' });
    const toFixChip = screen.getByRole('button', { name: '5 to fix' });
    expect(toFixChip).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toFixChip);
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  it('disables a chip whose count is zero', () => {
    renderBar({ summary: zeroSummary });
    expect(screen.getByRole('button', { name: '0 to fix' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '0 no clock-out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '0 info' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '0 matched' })).toBeDisabled();
  });

  it('reports a new tolerance value from the select', () => {
    const { onToleranceChange } = renderBar();
    const select = screen.getByTestId('tolerance-select');
    fireEvent.change(select, { target: { value: '30' } });
    expect(onToleranceChange).toHaveBeenCalledWith(30);
  });

  it('shows a skeleton line while loading, and no chips', () => {
    renderBar({ loading: true });
    expect(screen.queryByRole('button', { name: /to fix/ })).not.toBeInTheDocument();
  });

  it('shows an alert line on error, and no chips', () => {
    renderBar({ error: new Error('audit query failed') });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('audit query failed');
    expect(screen.queryByRole('button', { name: /to fix/ })).not.toBeInTheDocument();
  });
});
