import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendingUp } from 'lucide-react';
import { DashboardMetricCard } from '@/components/DashboardMetricCard';

describe('DashboardMetricCard caption', () => {
  it('renders the caption when given', () => {
    render(
      <DashboardMetricCard
        title="Gross Profit"
        value="$100"
        icon={TrendingUp}
        caption="Before other expenses"
      />
    );
    expect(screen.getByText('Before other expenses')).toBeTruthy();
  });

  it('renders no caption when the prop is absent', () => {
    render(<DashboardMetricCard title="Gross Profit" value="$100" icon={TrendingUp} />);
    expect(screen.queryByText('Before other expenses')).toBeNull();
  });
});
