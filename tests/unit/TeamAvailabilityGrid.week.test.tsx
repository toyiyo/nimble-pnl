/**
 * The availability grid shows the shared week from the URL.
 * The Previous, Next, and Today buttons write the week param.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TeamAvailabilityGrid } from '@/components/scheduling/TeamAvailabilityGrid';

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [], loading: false, error: null }),
  useAvailabilityExceptions: () => ({ exceptions: [], loading: false, error: null }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', name: 'Test', timezone: 'UTC' } },
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderGrid(initialEntry: string) {
  window.history.replaceState({}, '', initialEntry);
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TeamAvailabilityGrid
        restaurantId="r1"
        onOpenAvailabilityDialog={vi.fn()}
        onOpenExceptionDialog={vi.fn()}
        onRequestDelete={vi.fn()}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('TeamAvailabilityGrid week param', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Monday 2026-03-02 local.
    vi.setSystemTime(new Date(2026, 2, 2, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('shows the week from the URL', () => {
    renderGrid('/?week=2026-03-16');
    expect(screen.getByText(/Mar 16/)).toBeInTheDocument();
  });

  it('writes the next week to the URL', () => {
    renderGrid('/?week=2026-03-16');
    fireEvent.click(screen.getByLabelText('Next week'));
    expect(screen.getByTestId('search').textContent).toContain('week=2026-03-23');
  });

  it('writes the previous week to the URL', () => {
    renderGrid('/?week=2026-03-16');
    fireEvent.click(screen.getByLabelText('Previous week'));
    expect(screen.getByTestId('search').textContent).toContain('week=2026-03-09');
  });

  it('writes this week to the URL from Today', () => {
    renderGrid('/?week=2026-03-16');
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    expect(screen.getByTestId('search').textContent).toContain('week=2026-03-02');
  });

  it.each([
    ['no week param', '/'],
    ['an empty week param', '/?week='],
    ['an invalid week param', '/?week=not-a-date'],
  ])('falls back to this week with %s', (_label, url) => {
    renderGrid(url);
    expect(screen.getByText(/Mar 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next week'));
    expect(screen.getByTestId('search').textContent).toContain('week=2026-03-09');
  });

  it('writes the week before this week from a fallback week', () => {
    renderGrid('/?week=not-a-date');
    fireEvent.click(screen.getByLabelText('Previous week'));
    expect(screen.getByTestId('search').textContent).toContain('week=2026-02-23');
  });
});
