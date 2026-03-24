// tests/unit/MobileTabBar.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MobileTabBar } from '@/components/employee/MobileTabBar';

const renderWithRouter = (currentPath: string) => {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <MobileTabBar />
    </MemoryRouter>
  );
};

describe('MobileTabBar', () => {
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
});
