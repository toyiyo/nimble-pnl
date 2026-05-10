import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingQueue } from '../../src/components/timeoff/PendingQueue';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (id: string, overrides: Partial<TimeOffRequest> = {}): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status: 'pending',
  requested_at: '2026-05-08T17:20:00Z',
  created_at: '2026-05-08T17:20:00Z',
  updated_at: '2026-05-08T17:20:00Z',
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
  ...overrides,
});

const fixedNow = new Date('2026-05-10T12:00:00Z');

describe('PendingQueue', () => {
  it('renders header with count and "Action needed" label', () => {
    render(
      <PendingQueue
        requests={[make('a'), make('b')]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the empty state when there are no pending requests', () => {
    render(
      <PendingQueue
        requests={[]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('renders one TimeOffRow per request', () => {
    render(
      <PendingQueue
        requests={[make('a'), make('b'), make('c')]}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button', { name: /^approve/i })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^reject/i })).toHaveLength(3);
  });
});
