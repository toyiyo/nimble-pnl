import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';

describe('DashboardSkeleton', () => {
  it('shows one today card placeholder', () => {
    render(<DashboardSkeleton />);
    expect(screen.getByTestId('skeleton-today-card')).toBeInTheDocument();
  });

  it('shows two half-card placeholders side by side', () => {
    render(<DashboardSkeleton />);
    expect(screen.getByTestId('skeleton-half-card-attention')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-half-card-month')).toBeInTheDocument();
  });

  it('does not show a day grid row placeholder', () => {
    render(<DashboardSkeleton />);
    expect(screen.queryByTestId('skeleton-day-grid')).not.toBeInTheDocument();
  });
});
