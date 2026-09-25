// tests/unit/EmployeeMore.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EmployeeMore from '@/pages/EmployeeMore';

const mocks = vi.hoisted(() => ({
  claimable: { trades: [] as { urgent: boolean }[], count: 0 },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { restaurant_id: 'rest-1' } }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({ currentEmployee: { id: 'emp-1' }, loading: false, error: null }),
}));

vi.mock('@/hooks/useClaimableTrades', () => ({
  useClaimableTrades: () => ({ ...mocks.claimable, loading: false, error: null, refetch: vi.fn() }),
}));

describe('EmployeeMore', () => {
  beforeEach(() => {
    mocks.claimable = { trades: [], count: 0 };
  });

  const renderPage = () => render(
    <MemoryRouter>
      <EmployeeMore />
    </MemoryRouter>
  );

  it('renders all navigation items', () => {
    renderPage();
    expect(screen.getByText('Timecard')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Shift Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Tips')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('links to correct routes', () => {
    renderPage();
    expect(screen.getByText('Timecard').closest('a')).toHaveAttribute('href', '/employee/timecard');
    expect(screen.getByText('Requests').closest('a')).toHaveAttribute('href', '/employee/portal');
    expect(screen.getByText('Shift Marketplace').closest('a')).toHaveAttribute('href', '/employee/shifts');
    expect(screen.getByText('Tips').closest('a')).toHaveAttribute('href', '/employee/tips');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  it('shows no trade badge with 0 claimable trades', () => {
    renderPage();
    expect(screen.queryByText(/up for grabs/)).not.toBeInTheDocument();
  });

  it('shows the badge and the sr-only count on the marketplace row', () => {
    mocks.claimable = { trades: [{ urgent: false }, { urgent: true }], count: 2 };
    renderPage();
    const row = screen.getByText('Shift Marketplace').closest('a');
    const srText = screen.getByText('2 shifts up for grabs');
    expect(srText).toHaveClass('sr-only');
    expect(row).toContainElement(srText);
    const badge = screen.getByText('2');
    expect(row).toContainElement(badge);
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveClass('bg-amber-600');
  });
});
