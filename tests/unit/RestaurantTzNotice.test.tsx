import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RestaurantTzNotice } from '@/components/RestaurantTzNotice';

const mockClock = vi.fn();
vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => mockClock(),
}));

describe('RestaurantTzNotice', () => {
  beforeEach(() => {
    mockClock.mockReturnValue({
      tz: 'America/Chicago',
      tzAbbrev: 'CDT',
      viewerTzDiffers: true,
    });
  });

  it('renders nothing when the viewer shares the restaurant offset', () => {
    mockClock.mockReturnValue({ tz: 'America/Chicago', tzAbbrev: 'CDT', viewerTzDiffers: false });
    const { container } = render(<RestaurantTzNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the zone when the offsets differ', () => {
    render(<RestaurantTzNotice />);
    expect(screen.getByText(/times shown in restaurant time/i)).toBeInTheDocument();
    expect(screen.getByTitle('America/Chicago')).toHaveTextContent('CDT');
  });
});
