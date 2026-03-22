// tests/unit/MobileLayout.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MobileLayout } from '@/components/employee/MobileLayout';

describe('MobileLayout', () => {
  it('renders children and the tab bar', () => {
    render(
      <MemoryRouter initialEntries={['/employee/schedule']}>
        <MobileLayout>
          <div data-testid="page-content">Hello</div>
        </MobileLayout>
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /employee navigation/i })).toBeInTheDocument();
  });

  it('has bottom padding to clear the tab bar', () => {
    render(
      <MemoryRouter initialEntries={['/employee/schedule']}>
        <MobileLayout>
          <div>Content</div>
        </MobileLayout>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main.className).toContain('pb-20');
  });
});
