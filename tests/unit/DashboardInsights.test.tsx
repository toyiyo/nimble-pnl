import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DashboardInsights } from '@/components/DashboardInsights';

describe('DashboardInsights', () => {
  it('shows the section heading and the healthy row when there are no issues', () => {
    render(<DashboardInsights insights={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Smart Alerts' })).toBeInTheDocument();
    expect(screen.getByText('Restaurant looks healthy')).toBeInTheDocument();
  });

  it('shows one list item per insight and no healthy row when an issue exists', () => {
    render(
      <DashboardInsights
        insights={[
          { type: 'critical', title: 'Food cost is high', description: 'Check your prices.' },
          { type: 'tip', title: 'Add recipes', description: 'Link recipes to sales.' },
        ]}
      />
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Restaurant looks healthy')).not.toBeInTheDocument();
    expect(screen.getByText('Food cost is high')).toBeInTheDocument();
  });
});
