import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { TradeCountBadge } from '@/components/employee/TradeCountBadge';
import { shiftsUpForGrabsText } from '@/lib/claimableTrades';

describe('TradeCountBadge', () => {
  it('shows the count and hides itself from assistive technology', () => {
    render(<TradeCountBadge count={3} />);
    const badge = screen.getByText('3');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows 9+ for a count above 9', () => {
    render(<TradeCountBadge count={12} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('shows 9 for a count of 9', () => {
    render(<TradeCountBadge count={9} />);
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('renders nothing for a count of 0', () => {
    const { container } = render(<TradeCountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the neutral colors when not urgent', () => {
    render(<TradeCountBadge count={2} />);
    const badge = screen.getByText('2');
    expect(badge).toHaveClass('bg-foreground', 'text-background');
    expect(badge).not.toHaveClass('bg-amber-600');
  });

  it('uses the amber colors when urgent', () => {
    render(<TradeCountBadge count={2} urgent />);
    const badge = screen.getByText('2');
    expect(badge).toHaveClass('bg-amber-600', 'text-white', 'dark:bg-amber-500', 'dark:text-amber-950');
    expect(badge).not.toHaveClass('bg-foreground');
  });
});

describe('shiftsUpForGrabsText', () => {
  it('uses the singular for one shift and the plural for more', () => {
    expect(shiftsUpForGrabsText(1)).toBe('1 shift up for grabs');
    expect(shiftsUpForGrabsText(2)).toBe('2 shifts up for grabs');
  });
});
