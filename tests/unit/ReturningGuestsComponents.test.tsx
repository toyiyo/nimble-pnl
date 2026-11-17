import React from 'react';
import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReturningGuestsSummary } from '@/components/returning-guests/ReturningGuestsSummary';
import { ReturningGuestsChart } from '@/components/returning-guests/ReturningGuestsChart';
import type { ReturningGuestTrends } from '@/lib/returningGuests';

const hookState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const ctxState = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('@/hooks/useReturningGuestTrends', () => ({
  useReturningGuestTrends: () => hookState.value,
}));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: ctxState.role,
      restaurant: { name: 'Cafe', timezone: 'America/Chicago' },
    },
  }),
}));

import ReturningGuests from '@/pages/ReturningGuests';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON: () => {} }),
  });
});

const period = (s: number) => ({
  spend_per_week: s,
  visits_per_card: 2,
  avg_check: 20,
  returning_cards: 10,
  new_cards: 5,
});

const trends = (over: Partial<ReturningGuestTrends> = {}): ReturningGuestTrends => ({
  source: 'toast',
  match_quality: 'fair',
  history_start: '2026-01-01',
  weeks_compared: 2,
  weeks: [
    { week_start: '2026-10-05', period: 'before', warmup: false, returning_spend: 100, new_spend: 50, returning_visits: 5, returning_cards: 4, new_cards: 3 },
    { week_start: '2026-10-12', period: 'after', warmup: false, returning_spend: 120, new_spend: 60, returning_visits: 6, returning_cards: 5, new_cards: 3 },
  ],
  summary: { before: period(100), after: period(112) },
  ...over,
});

describe('ReturningGuestsSummary', () => {
  it('shows three tiles with an sr-only change', () => {
    render(<ReturningGuestsSummary summary={trends().summary} weeksCompared={2} />);
    expect(screen.getAllByTestId('rg-tile')).toHaveLength(3);
    expect(screen.getAllByText(/increased 12 percent/).length).toBeGreaterThan(0);
  });

  it('shows dashes and a prompt when no week is compared', () => {
    render(<ReturningGuestsSummary summary={null} weeksCompared={0} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/Come back after the first full week/)).toBeInTheDocument();
  });
});

describe('ReturningGuestsChart', () => {
  it('renders an img wrapper and an sr-only table', () => {
    render(<ReturningGuestsChart weeks={trends().weeks} campaignStart="2026-10-12" />);
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(document.querySelector('table caption')).not.toBeNull();
    expect(document.querySelectorAll('table th[scope]').length).toBeGreaterThan(0);
  });
});

describe('ReturningGuests page', () => {
  const renderPage = (url = '/returning-guests?start=2026-10-12&weeks=8') =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <ReturningGuests />
      </MemoryRouter>,
    );

  beforeEach(() => {
    ctxState.role = 'owner';
    hookState.value = { data: trends(), isLoading: false, error: null, refetch: vi.fn() };
  });

  it('blocks a non owner or manager', () => {
    ctxState.role = 'staff';
    renderPage();
    expect(screen.getByText('Only owners and managers can see this page.')).toBeInTheDocument();
  });

  it('asks for a date when start is missing', () => {
    renderPage('/returning-guests');
    expect(screen.getByText(/Pick the date your campaign started/)).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    hookState.value = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
    renderPage();
    expect(screen.getAllByTestId('rg-skeleton').length).toBeGreaterThan(0);
  });

  it('shows an error with retry', () => {
    const refetch = vi.fn();
    hookState.value = { data: undefined, isLoading: false, error: new Error('x'), refetch };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows the unavailable message for source none', () => {
    hookState.value = {
      data: trends({ source: 'none', match_quality: 'none', weeks: [], summary: null, weeks_compared: 0 }),
      isLoading: false, error: null, refetch: vi.fn(),
    };
    renderPage();
    expect(screen.getByText(/Not available for your POS/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows tiles, chart and note with data', () => {
    renderPage();
    expect(screen.getAllByTestId('rg-tile')).toHaveLength(3);
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('note').textContent).toMatch(/Estimate\. We match guests by card brand/);
  });

  it('shows the warm-up note', () => {
    hookState.value = {
      data: trends({ weeks: trends().weeks.map((w) => ({ ...w, warmup: true })) }),
      isLoading: false, error: null, refetch: vi.fn(),
    };
    renderPage();
    expect(screen.getByRole('note').textContent).toMatch(/Your card history starts on 2026-01-01/);
  });
});
