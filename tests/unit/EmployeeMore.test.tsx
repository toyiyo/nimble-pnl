// tests/unit/EmployeeMore.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import EmployeeMore from '@/pages/EmployeeMore';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));

describe('EmployeeMore', () => {
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
});
