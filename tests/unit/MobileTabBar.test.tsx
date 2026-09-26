// tests/unit/MobileTabBar.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileTabBar } from '@/components/employee/MobileTabBar';

const mocks = vi.hoisted(() => ({
  badge: { count: 0, hasUrgentTrade: false },
}));

vi.mock('@/hooks/useClaimableTradeBadge', () => ({
  useClaimableTradeBadge: () => mocks.badge,
}));

const renderWithRouter = (currentPath: string) => {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <MobileTabBar />
    </MemoryRouter>
  );
};

function setClaimable(urgentFlags: boolean[]) {
  mocks.badge = {
    count: urgentFlags.length,
    hasUrgentTrade: urgentFlags.some(Boolean),
  };
}

describe('MobileTabBar', () => {
  beforeEach(() => {
    setClaimable([]);
  });

  it('renders all 4 tabs', () => {
    renderWithRouter('/employee/schedule');
    expect(screen.getByRole('link', { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pay/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /clock/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /more/i })).toBeInTheDocument();
  });

  it('highlights Schedule tab when on /employee/schedule', () => {
    renderWithRouter('/employee/schedule');
    const scheduleTab = screen.getByRole('link', { name: /schedule/i });
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('highlights Pay tab when on /employee/pay', () => {
    renderWithRouter('/employee/pay');
    const payTab = screen.getByRole('link', { name: /pay/i });
    expect(payTab).toHaveAttribute('aria-current', 'page');
  });

  it('highlights More tab when on a sub-page like /employee/timecard', () => {
    renderWithRouter('/employee/timecard');
    const moreTab = screen.getByRole('link', { name: /more/i });
    expect(moreTab).toHaveAttribute('aria-current', 'page');
  });

  it('links to correct routes', () => {
    renderWithRouter('/employee/schedule');
    expect(screen.getByRole('link', { name: /schedule/i })).toHaveAttribute('href', '/employee/schedule');
    expect(screen.getByRole('link', { name: /pay/i })).toHaveAttribute('href', '/employee/pay');
    expect(screen.getByRole('link', { name: /clock/i })).toHaveAttribute('href', '/employee/clock');
    expect(screen.getByRole('link', { name: /more/i })).toHaveAttribute('href', '/employee/more');
  });

  describe('claimable trade badge', () => {
    it('keeps the name "More" and shows no badge with 0 trades', () => {
      renderWithRouter('/employee/schedule');
      const moreTab = screen.getByRole('link', { name: 'More' });
      expect(moreTab.querySelector('[aria-hidden="true"].rounded-full')).toBeNull();
    });

    it('names the More tab "More, 1 shift up for grabs" for one trade', () => {
      setClaimable([false]);
      renderWithRouter('/employee/schedule');
      expect(screen.getByRole('link', { name: 'More, 1 shift up for grabs' })).toBeInTheDocument();
    });

    it('names the More tab "More, 2 shifts up for grabs" and shows the badge', () => {
      setClaimable([false, false]);
      renderWithRouter('/employee/schedule');
      const moreTab = screen.getByRole('link', { name: 'More, 2 shifts up for grabs' });
      const badge = screen.getByText('2');
      expect(moreTab).toContainElement(badge);
      expect(badge).toHaveAttribute('aria-hidden', 'true');
      expect(badge).toHaveClass('bg-foreground');
    });

    it('shows the amber badge when a trade is urgent', () => {
      setClaimable([false, true]);
      renderWithRouter('/employee/schedule');
      expect(screen.getByText('2')).toHaveClass('bg-amber-600');
    });
  });
});
