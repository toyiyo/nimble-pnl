import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeOffRow } from '../../src/components/timeoff/TimeOffRow';
import type { TimeOffRequest } from '../../src/types/scheduling';

const baseRequest: TimeOffRequest = {
  id: 'r1',
  restaurant_id: 'rest-1',
  employee_id: 'e1',
  start_date: '2026-05-31',
  end_date: '2026-06-07',
  reason: 'Family wedding',
  status: 'pending',
  requested_at: '2026-05-08T17:20:00Z',
  created_at: '2026-05-08T17:20:00Z',
  updated_at: '2026-05-08T17:20:00Z',
  employee: {
    id: 'e1',
    restaurant_id: 'rest-1',
    name: 'Shy Harrison',
    user_id: 'u1',
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  } as any,
};

const fixedNow = new Date('2026-05-10T12:00:00Z');

describe('TimeOffRow (variant=pending)', () => {
  it('renders Approve and Reject buttons that are visible without hover', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const approve = screen.getByRole('button', { name: /approve/i });
    const reject = screen.getByRole('button', { name: /reject/i });
    expect(approve).toBeInTheDocument();
    expect(reject).toBeInTheDocument();
    // Critical regression: action buttons must NOT be hover-only.
    expect(approve.className).not.toMatch(/opacity-0/);
    expect(reject.className).not.toMatch(/opacity-0/);
  });

  it('renders the days-since-requested counter', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/requested 2 days ago/i)).toBeInTheDocument();
  });

  it('renders "today" instead of "0 days ago" when requested today', () => {
    render(
      <TimeOffRow
        variant="pending"
        request={{ ...baseRequest, created_at: '2026-05-10T10:00:00Z' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/requested today/i)).toBeInTheDocument();
  });

  it('truncates long reasons and exposes the full text via title attribute', () => {
    const longReason = 'A'.repeat(120);
    render(
      <TimeOffRow
        variant="pending"
        request={{ ...baseRequest, reason: longReason }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const reason = screen.getByTestId('time-off-row-reason');
    expect(reason.textContent?.length).toBeLessThan(longReason.length);
    expect(reason).toHaveAttribute('title', longReason);
  });

  it('calls onApprove with the request id', () => {
    const onApprove = vi.fn();
    render(
      <TimeOffRow
        variant="pending"
        request={baseRequest}
        now={fixedNow}
        onApprove={onApprove}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith(baseRequest);
  });
});

describe('TimeOffRow (variant=decided)', () => {
  it('renders status badge and no approve/reject buttons', () => {
    render(
      <TimeOffRow
        variant="decided"
        request={{ ...baseRequest, status: 'approved' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it('does not render the days-since-requested counter on decided rows', () => {
    render(
      <TimeOffRow
        variant="decided"
        request={{ ...baseRequest, status: 'approved' }}
        now={fixedNow}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText(/requested .* ago/i)).not.toBeInTheDocument();
  });
});
