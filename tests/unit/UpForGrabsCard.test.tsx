import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { UpForGrabsCard, shouldShowUpForGrabs } from '@/components/employee/UpForGrabsCard';
import type { ClaimableTrade, MarketplaceTrade } from '@/lib/claimableTrades';

const TZ = 'America/Chicago';
// 10:00 CDT on Friday 2026-09-25.
const NOW = new Date('2026-09-25T15:00:00Z');
const HOUR = 60 * 60 * 1000;

function claimable(
  id: string,
  startIso: string,
  overrides: { name?: string; position?: string; reason?: string | null } = {},
): ClaimableTrade {
  const startsAt = new Date(startIso);
  const trade: MarketplaceTrade = {
    id,
    restaurant_id: 'rest-1',
    offered_shift_id: `shift-${id}`,
    offered_by_employee_id: `emp-${id}`,
    requested_shift_id: null,
    target_employee_id: null,
    accepted_by_employee_id: null,
    status: 'open',
    reason: overrides.reason ?? null,
    manager_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    offered_shift: {
      id: `shift-${id}`,
      start_time: startsAt.toISOString(),
      end_time: new Date(startsAt.getTime() + 6 * HOUR).toISOString(),
      position: overrides.position ?? 'Server',
      break_duration: 0,
      is_published: true,
    },
    offered_by: {
      id: `emp-${id}`,
      name: overrides.name ?? 'Maria Lopez',
      email: null,
      position: 'Server',
      area: null,
    },
    hasConflict: false,
  };
  return { trade, startsAt, isUrgent: startsAt.getTime() - NOW.getTime() <= 24 * HOUR };
}

// 17:00 CDT today (7 h away): urgent, "Starts in 7 h".
const today = claimable('a', '2026-09-25T22:00:00Z', {
  name: 'Maria Lopez',
  position: 'Server',
  reason: 'Family event',
});
// 17:00 CDT tomorrow (31 h away): not urgent, "Tomorrow".
const tomorrow = claimable('b', '2026-09-26T22:00:00Z', { name: 'Ken Ito', position: 'Host' });
// Monday 2026-09-28 (3 days away): no chip.
const later = claimable('c', '2026-09-28T22:00:00Z', { name: 'Ana Ruiz', position: 'Cook' });
const latest = claimable('d', '2026-09-29T22:00:00Z', { name: 'Bo Chen', position: 'Bar' });

type Props = React.ComponentProps<typeof UpForGrabsCard>;

function renderCard(props: Partial<Props> = {}) {
  const onRetry = vi.fn();
  const utils = render(
    <MemoryRouter>
      <UpForGrabsCard
        trades={[today, tomorrow, later]}
        loading={false}
        error={null}
        onRetry={onRetry}
        restaurantId="rest-1"
        timezone={TZ}
        now={NOW}
        openShiftCount={0}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

describe('UpForGrabsCard', () => {
  it('renders nothing while loading', () => {
    const { container } = renderCard({ loading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with no trades', () => {
    const { container } = renderCard({ trades: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one error line with "Try again" that calls onRetry', () => {
    const { onRetry } = renderCard({ error: new Error('boom'), trades: [] });
    expect(screen.getByText('Could not load shifts that need cover.')).toHaveClass(
      'text-[13px]',
      'text-muted-foreground',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the title with the count', () => {
    renderCard({ trades: [today, tomorrow, later, latest] });
    const heading = screen.getByRole('heading', { name: /Teammates need cover/ });
    expect(heading).toHaveTextContent('4');
  });

  it('shows at most 3 rows, soonest first', () => {
    renderCard({ trades: [today, tomorrow, later, latest] });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Maria Lopez');
    expect(items[2]).toHaveTextContent('Ana Ruiz');
    expect(screen.queryByText(/Bo Chen/)).not.toBeInTheDocument();
  });

  it('shows the fit sub-line for many trades', () => {
    renderCard();
    expect(screen.getByText('All 3 fit around your shifts')).toBeInTheDocument();
  });

  it('shows the fit sub-line for one trade', () => {
    renderCard({ trades: [tomorrow] });
    const line = screen.getByText('It fits around your shifts');
    expect(line.closest('p')).toHaveClass('text-[12px]', 'text-muted-foreground');
    expect(line.closest('p')).not.toHaveClass('text-success');
    expect(line.closest('p')?.querySelector('svg')).toHaveClass('text-success');
  });

  it('shows the date tile in the restaurant zone', () => {
    renderCard({ trades: [tomorrow] });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Sat');
    expect(row).toHaveTextContent('26');
    expect(row).toHaveTextContent('Sep');
  });

  it('shows the poster name first, then the position', () => {
    renderCard({ trades: [tomorrow] });
    expect(screen.getByText('Ken Ito · Host')).toBeInTheDocument();
  });

  it('shows the time range and the reason', () => {
    renderCard({ trades: [today] });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('5:00 PM – 11:00 PM');
    expect(row).toHaveTextContent('· “Family event”');
  });

  it('shows no reason text for a trade without a reason', () => {
    renderCard({ trades: [tomorrow] });
    expect(screen.getByRole('listitem').textContent).not.toContain('“');
  });

  it('shows the amber chip for an urgent trade', () => {
    renderCard({ trades: [today] });
    const chip = screen.getByText('Starts in 7 h');
    expect(chip).toHaveClass('bg-amber-500/10', 'text-amber-700');
    expect(chip).toHaveAttribute('aria-label', 'Starts in 7 hours');
  });

  it('shows the muted "Tomorrow" chip for a trade after 24 h', () => {
    renderCard({ trades: [tomorrow] });
    const chip = screen.getByText('Tomorrow');
    expect(chip).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(chip).not.toHaveClass('bg-amber-500/10');
  });

  it('shows no chip for a later day', () => {
    renderCard({ trades: [later] });
    expect(screen.queryByText(/Starts in|Today|Tomorrow/)).not.toBeInTheDocument();
  });

  it('makes each row one link to the marketplace with from=home', () => {
    renderCard({ trades: [tomorrow] });
    const links = within(screen.getByRole('listitem')).getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'View Host shift on Saturday, September 26 from Ken Ito' });
    expect(link).toHaveAttribute('href', '/employee/shifts?trade=b&restaurant=rest-1&from=home');
    expect(link).toHaveClass('min-h-[64px]');
  });

  it('shows the open shift count and "Browse all shifts" in the footer', () => {
    renderCard({ openShiftCount: 2 });
    expect(screen.getByText('2 open shifts too')).toBeInTheDocument();
    const browse = screen.getByRole('link', { name: 'Browse all shifts' });
    expect(browse).toHaveAttribute('href', '/employee/shifts');
  });

  it('uses the singular for one open shift', () => {
    renderCard({ openShiftCount: 1 });
    expect(screen.getByText('1 open shift too')).toBeInTheDocument();
  });

  it('hides the open shift text with 0 open shifts', () => {
    renderCard({ openShiftCount: 0 });
    expect(screen.queryByText(/open shifts? too/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all shifts' })).toBeInTheDocument();
  });

  it('hides the open shift text when the count is not known', () => {
    renderCard({ openShiftCount: null });
    expect(screen.queryByText(/open shifts? too/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all shifts' })).toBeInTheDocument();
  });

  it('shows no number in the browse link', () => {
    renderCard({ openShiftCount: 4 });
    expect(screen.queryByRole('link', { name: /Browse all \d/ })).not.toBeInTheDocument();
  });
});

describe('shouldShowUpForGrabs', () => {
  it('is true only for loaded trades with no error', () => {
    expect(shouldShowUpForGrabs([today], false, null)).toBe(true);
    expect(shouldShowUpForGrabs([today], true, null)).toBe(false);
    expect(shouldShowUpForGrabs([today], false, new Error('boom'))).toBe(false);
    expect(shouldShowUpForGrabs([], false, null)).toBe(false);
  });
});
