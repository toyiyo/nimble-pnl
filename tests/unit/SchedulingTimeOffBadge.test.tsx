import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeOffTabBadge } from '../../src/pages/SchedulingTimeOffTabBadge';

describe('TimeOffTabBadge', () => {
  it('renders the count when count > 0', () => {
    render(<TimeOffTabBadge count={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing when count is 0', () => {
    const { container } = render(<TimeOffTabBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for negative counts (defensive)', () => {
    const { container } = render(<TimeOffTabBadge count={-1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for NaN counts (defensive)', () => {
    const { container } = render(<TimeOffTabBadge count={Number.NaN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses warning-tinted styling consistent with the trades badge', () => {
    render(<TimeOffTabBadge count={1} />);
    const badge = screen.getByText('1');
    expect(badge).toHaveClass('bg-warning');
  });
});
