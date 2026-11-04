import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { PunchLocationFlag } from '@/components/time-clock/PunchLocationFlag';
import type { TimePunch } from '@/types/timeTracking';

describe('PunchLocationFlag', () => {
  it('shows the distance for an off-site location', () => {
    render(
      <PunchLocationFlag
        location={{ within_geofence: false, distance_meters: 1234 }}
      />
    );

    expect(screen.getByText('1.2 km away')).toBeInTheDocument();
  });

  it('marks the icon as decorative', () => {
    const { container } = render(
      <PunchLocationFlag
        location={{ within_geofence: false, distance_meters: 1234 }}
      />
    );

    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows "No location" when the device has no location', () => {
    render(<PunchLocationFlag location={{ location_unavailable: true }} />);

    expect(screen.getByText('No location')).toBeInTheDocument();
  });

  it('renders an empty container when there is no flag', () => {
    const location: TimePunch['location'] = undefined;
    const { container } = render(<PunchLocationFlag location={location} />);

    expect(container.firstChild).toBeNull();
  });
});
