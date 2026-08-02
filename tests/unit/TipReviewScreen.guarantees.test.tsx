import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TipReviewScreen } from '@/components/tips/TipReviewScreen';
import type { TipShare } from '@/utils/tipPooling';

const shares: TipShare[] = [
  {
    employeeId: '1',
    name: 'Manager Mo',
    hours: 2,
    role: 'Manager',
    amountCents: 3000,
    appliedRule: { mode: 'at_least', percentage: 30 },
    lifted: true,
  },
  { employeeId: '2', name: 'Server Sam', hours: 8, role: 'Server', amountCents: 7000 },
];

const baseProps = {
  totalTipsCents: 10000,
  initialShares: shares,
  shareMethod: 'hours' as const,
  onApprove: vi.fn(),
  onSaveDraft: vi.fn(),
};

describe('TipReviewScreen guarantees', () => {
  it('shows a percentage of pool column', () => {
    render(<TipReviewScreen {...baseProps} />);

    expect(screen.getByText('% of pool')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();
    expect(screen.getByText('70.0%')).toBeInTheDocument();
  });

  it('badges an employee whose share came from a guarantee', () => {
    render(<TipReviewScreen {...baseProps} />);

    expect(screen.getByText('Guaranteed 30%')).toBeInTheDocument();
  });

  it('badges an employee pinned to a fixed share', () => {
    render(
      <TipReviewScreen
        {...baseProps}
        initialShares={[
          {
            employeeId: '1',
            name: 'Chef Cal',
            amountCents: 10000,
            appliedRule: { mode: 'exactly', percentage: 15 },
          },
        ]}
      />,
    );

    expect(screen.getByText('Fixed 15%')).toBeInTheDocument();
  });

  it('warns when guarantees were scaled down', () => {
    render(<TipReviewScreen {...baseProps} scaledDownFactor={0.8} />);

    expect(
      screen.getByText('Guarantees totalled more than the pool and were reduced proportionally.'),
    ).toBeInTheDocument();
  });

  it('warns when leftover cents were redistributed', () => {
    render(<TipReviewScreen {...baseProps} redistributedLeftoverCents={2500} />);

    expect(
      screen.getByText(
        'No hourly staff worked; the remaining $25.00 was split across the fixed percentages.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no advisory when neither branch fired', () => {
    render(<TipReviewScreen {...baseProps} scaledDownFactor={null} redistributedLeftoverCents={0} />);

    expect(screen.queryByText(/reduced proportionally/)).not.toBeInTheDocument();
    expect(screen.queryByText(/split across the fixed percentages/)).not.toBeInTheDocument();
  });
});
