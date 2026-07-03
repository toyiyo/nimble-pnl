import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CoverageChart } from '@/components/scheduling/ShiftTimeline/CoverageChart';

// Two hours: one short (16 = 4 PM, delta -2) and one covered (17 = 5 PM, delta 0)
const hours = [
  { hour: 16, startMin: 960, scheduled: 3, needed: 5, delta: -2 },
  { hour: 17, startMin: 1020, scheduled: 5, needed: 5, delta: 0 },
];

// One hour with no demand (needed = null)
const hoursNoDemand = [
  { hour: 10, startMin: 600, scheduled: 3, needed: null, delta: null },
  { hour: 11, startMin: 660, scheduled: 4, needed: null, delta: null },
];

describe('CoverageChart — area view', () => {
  it('renders an accessible SVG with role="img"', () => {
    const { getByRole } = render(<CoverageChart hours={hours} view="area" />);
    expect(getByRole('img')).toBeInTheDocument();
  });

  it('renders a shortfall element for the short hour', () => {
    const { container } = render(<CoverageChart hours={hours} view="area" />);
    expect(container.querySelector('[data-shortfall]')).toBeTruthy();
  });

  it('does not render a shortfall element when every hour is covered', () => {
    const coveredHours = [
      { hour: 16, startMin: 960, scheduled: 5, needed: 5, delta: 0 },
      { hour: 17, startMin: 1020, scheduled: 6, needed: 5, delta: 1 },
    ];
    const { container } = render(<CoverageChart hours={coveredHours} view="area" />);
    expect(container.querySelector('[data-shortfall]')).toBeFalsy();
  });

  it('renders the legend labels (Scheduled and Needed)', () => {
    const { getAllByText, getByText } = render(<CoverageChart hours={hours} view="area" />);
    expect(getByText(/scheduled/i)).toBeInTheDocument();
    // "Needed" appears in both the SVG inline label and the legend — at least one must exist
    expect(getAllByText(/needed/i).length).toBeGreaterThanOrEqual(1);
  });

  it('does not render a Needed legend item when demand is absent', () => {
    const { queryByText } = render(<CoverageChart hours={hoursNoDemand} view="area" />);
    expect(queryByText(/needed/i)).not.toBeInTheDocument();
  });

  it('renders an SVG title for accessibility', () => {
    const { container } = render(<CoverageChart hours={hours} view="area" />);
    const title = container.querySelector('title');
    expect(title).toBeTruthy();
    expect(title?.textContent).toBeTruthy();
  });

  it('renders an SVG desc for accessibility', () => {
    const { container } = render(<CoverageChart hours={hours} view="area" />);
    const desc = container.querySelector('desc');
    expect(desc).toBeTruthy();
    expect(desc?.textContent).toBeTruthy();
  });
});

describe('CoverageChart — delta view', () => {
  it('renders one bar per hour via data-bar attribute', () => {
    const { container } = render(<CoverageChart hours={hours} view="delta" />);
    expect(container.querySelectorAll('[data-bar]').length).toBe(2);
  });

  it('renders a short bar for the negative-delta hour', () => {
    const { container } = render(<CoverageChart hours={hours} view="delta" />);
    const bars = container.querySelectorAll('[data-bar]');
    // The first bar (hour 16, delta -2) should be marked as short
    expect(bars[0].getAttribute('data-bar')).toBe('short');
  });

  it('renders a covered bar for the zero-delta hour', () => {
    const { container } = render(<CoverageChart hours={hours} view="delta" />);
    const bars = container.querySelectorAll('[data-bar]');
    // The second bar (hour 17, delta 0) should be "covered"
    expect(bars[1].getAttribute('data-bar')).toBe('covered');
  });

  it('renders an accessible SVG in delta view', () => {
    const { getByRole } = render(<CoverageChart hours={hours} view="delta" />);
    expect(getByRole('img')).toBeInTheDocument();
  });

  it('renders nothing when hours array is empty', () => {
    const { container } = render(<CoverageChart hours={[]} view="delta" />);
    // Should return null or empty
    expect(container.querySelector('svg')).toBeFalsy();
  });
});
