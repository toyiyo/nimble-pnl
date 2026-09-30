import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import { DashboardSectionRail } from '@/components/dashboard/DashboardSectionRail';
import type { DashboardSection } from '@/components/dashboard/dashboardSections';

const sections: DashboardSection[] = [
  { id: 'dash-today', label: 'Today' },
  { id: 'dash-attention', label: 'Attention' },
  { id: 'dash-cashflow', label: 'Cashflow' },
];

describe('DashboardSectionRail', () => {
  it('renders a nav landmark labeled "Dashboard sections"', () => {
    render(
      <DashboardSectionRail sections={sections} activeSectionId="dash-today" onNavigate={vi.fn()} />,
    );
    expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBeInTheDocument();
  });

  it('gives each link an aria-label "Go to <section>"', () => {
    render(
      <DashboardSectionRail sections={sections} activeSectionId="dash-today" onNavigate={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    expect(within(nav).getByRole('link', { name: 'Go to Today' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Go to Attention' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Go to Cashflow' })).toBeInTheDocument();
  });

  it('sets aria-current="location" on the active link only', () => {
    render(
      <DashboardSectionRail sections={sections} activeSectionId="dash-attention" onNavigate={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    expect(within(nav).getByRole('link', { name: 'Go to Attention' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(within(nav).getByRole('link', { name: 'Go to Today' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Go to Cashflow' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('calls onNavigate(id) when a link is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <DashboardSectionRail sections={sections} activeSectionId="dash-today" onNavigate={onNavigate} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Go to Cashflow' }));
    expect(onNavigate).toHaveBeenCalledWith('dash-cashflow');
  });

  it('renders the compact chip variant with its own nav label', () => {
    render(
      <DashboardSectionRail
        sections={sections}
        activeSectionId="dash-today"
        onNavigate={vi.fn()}
        variant="compact"
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections (compact)' });
    expect(within(nav).getByRole('link', { name: 'Go to Today' })).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Dashboard sections' }),
    ).not.toBeInTheDocument();
  });

  it('calls onNavigate(id) from the compact chip variant', () => {
    const onNavigate = vi.fn();
    render(
      <DashboardSectionRail
        sections={sections}
        activeSectionId="dash-today"
        onNavigate={onNavigate}
        variant="compact"
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections (compact)' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Go to Attention' }));
    expect(onNavigate).toHaveBeenCalledWith('dash-attention');
  });

  it('gives each rail link a visible keyboard focus ring', () => {
    render(
      <DashboardSectionRail sections={sections} activeSectionId="dash-today" onNavigate={vi.fn()} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.className).toContain('focus-visible:ring-2');
    }
  });

  it('gives each compact chip a visible keyboard focus ring', () => {
    render(
      <DashboardSectionRail
        sections={sections}
        activeSectionId="dash-today"
        onNavigate={vi.fn()}
        variant="compact"
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections (compact)' });
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.className).toContain('focus-visible:ring-2');
    }
  });
});
