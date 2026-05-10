import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecidedHistory } from '../../src/components/timeoff/DecidedHistory';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (id: string, status: TimeOffRequest['status']): TimeOffRequest => ({
  id,
  restaurant_id: 'rest-1',
  employee_id: `e-${id}`,
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  status,
  requested_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  employee: { id: `e-${id}`, restaurant_id: 'rest-1', name: `Emp ${id}`, user_id: `u-${id}`, is_active: true, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z' } as TimeOffRequest['employee'],
});

describe('DecidedHistory', () => {
  it('renders header showing the total count', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /decided/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('is collapsed by default — request rows are not visible', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText('Emp a')).not.toBeInTheDocument();
  });

  it('expands on header click and shows rows', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    expect(screen.getByText('Emp a')).toBeInTheDocument();
    expect(screen.getByText('Emp b')).toBeInTheDocument();
  });

  it('filters to Approved when the Approved chip is clicked', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    fireEvent.click(screen.getByRole('button', { name: /^approved$/i }));
    expect(screen.getByText('Emp a')).toBeInTheDocument();
    expect(screen.queryByText('Emp b')).not.toBeInTheDocument();
  });

  it('filters to Rejected when the Rejected chip is clicked', () => {
    render(
      <DecidedHistory
        requests={[make('a', 'approved'), make('b', 'rejected')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    fireEvent.click(screen.getByRole('button', { name: /^rejected$/i }));
    expect(screen.queryByText('Emp a')).not.toBeInTheDocument();
    expect(screen.getByText('Emp b')).toBeInTheDocument();
  });

  it('renders an empty placeholder when there are zero decided requests', () => {
    render(
      <DecidedHistory
        requests={[]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /decided/i }));
    expect(screen.getByText(/no decided requests yet/i)).toBeInTheDocument();
  });
});
