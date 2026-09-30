import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { CriticalAlert } from '@/types/dashboard';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { DashboardAttentionList } from '@/components/dashboard/DashboardAttentionList';

function renderList(alerts: CriticalAlert[]) {
  return render(
    <MemoryRouter>
      <DashboardAttentionList alerts={alerts} />
    </MemoryRouter>
  );
}

const alert: CriticalAlert = {
  id: 'a1',
  type: 'cash',
  severity: 'critical',
  title: 'Cash runway is low',
  description: 'Runway drops below 14 days.',
  action: { label: 'View cash flow', path: '/cash-flow' },
};

describe('DashboardAttentionList', () => {
  it('shows the empty state text when there are no alerts', () => {
    renderList([]);
    expect(screen.getByText('Nothing needs your attention.')).toBeInTheDocument();
  });

  it('shows a count badge with the number of alerts', () => {
    renderList([alert, { ...alert, id: 'a2' }]);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders one list item per alert', () => {
    renderList([alert, { ...alert, id: 'a2', title: 'Food cost is high' }]);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Cash runway is low')).toBeInTheDocument();
    expect(screen.getByText('Food cost is high')).toBeInTheDocument();
  });

  it('navigates to the action path when the action button is clicked', () => {
    renderList([alert]);
    fireEvent.click(screen.getByRole('button', { name: 'View cash flow' }));
    expect(mockNavigate).toHaveBeenCalledWith('/cash-flow');
  });
});
