import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useOutflowByCategory', () => ({
  useOutflowByCategory: () => ({
    data: { categories: [], totalOutflows: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { OutflowByCategoryCard } from '@/components/dashboard/OutflowByCategoryCard';

const props = {
  startDate: new Date(2026, 8, 30),
  endDate: new Date(2026, 8, 30),
  periodLabel: 'Today',
};

describe('OutflowByCategoryCard empty state', () => {
  it('asks the owner to connect a bank when no bank is connected', () => {
    render(
      <MemoryRouter>
        <OutflowByCategoryCard {...props} hasConnectedBank={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Connect Bank' })).toBeInTheDocument();
  });

  it('names the period and shows no connect button when a bank is connected', () => {
    render(
      <MemoryRouter>
        <OutflowByCategoryCard {...props} hasConnectedBank />
      </MemoryRouter>,
    );
    expect(screen.getByText('No bank outflows in this period (Today).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Bank' })).not.toBeInTheDocument();
  });
});
