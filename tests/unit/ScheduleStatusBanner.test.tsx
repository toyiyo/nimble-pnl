import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScheduleStatusBanner } from '@/components/employee/ScheduleStatusBanner';
import { SchedulePublication } from '@/types/scheduling';

const TZ = 'America/Chicago';

function publication(overrides: Partial<SchedulePublication> = {}): SchedulePublication {
  return {
    id: 'pub-1',
    restaurant_id: 'r1',
    week_start_date: '2026-08-03',
    week_end_date: '2026-08-09',
    // 15:00Z is 10:00 CDT -- the assertions below depend on the restaurant's
    // zone being applied, not the runner's.
    published_at: '2026-08-01T15:00:00Z',
    published_by: 'u1',
    notes: null,
    shift_count: 12,
    open_shifts_broadcast_at: null,
    open_shifts_broadcast_by: null,
    notification_sent: true,
    ...overrides,
  };
}

function renderBanner(props: Partial<React.ComponentProps<typeof ScheduleStatusBanner>> = {}) {
  return render(
    <ScheduleStatusBanner
      state="published"
      publication={publication()}
      timezone={TZ}
      {...props}
    />
  );
}

/**
 * The banner never warns. Every alert this slot has carried — "not published
 * yet", "still being finalized", "pulled back for changes" — told employees
 * their real shifts were tentative, and caused no-shows at restaurants that
 * use publish/unpublish as a routine edit cycle or never publish at all.
 */
describe('ScheduleStatusBanner', () => {
  it('says nothing at all while the status is still unknown', () => {
    const { container } = renderBanner({ state: null });

    // The slot still occupies its height so the page does not jump when the
    // answer arrives.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('.min-h-\\[76px\\]')).toBeInTheDocument();
  });

  it('reduces a fully published week to one quiet line, in the restaurant timezone', () => {
    renderBanner({ state: 'published' });

    // 2026-08-01T15:00Z is 10:00 CDT on Sat Aug 1 -- not 15:00, and not Aug 2.
    expect(screen.getByText(/Published Sat, Aug 1 at 10:00/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing about an unpublished week', () => {
    const { container } = renderBanner({ state: 'not_published', publication: null });

    expect(container.textContent).toBe('');
    expect(container.querySelector('.min-h-\\[76px\\]')).toBeInTheDocument();
  });

  it('shows only the quiet published line while a week is being revised', () => {
    renderBanner({ state: 'published_revising' });

    expect(screen.getByText(/Published Sat, Aug 1 at 10:00/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing about a retracted week', () => {
    // The "pulled back for changes" alert was the exact message a confused
    // employee quoted. Restaurants unpublish to edit; the alert read as
    // "your shifts are cancelled".
    const { container } = renderBanner({ state: 'retracted' });

    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('.min-h-\\[76px\\]')).toBeInTheDocument();
  });

  it('shows no stale "Published" line on a retracted week', () => {
    // A retracted week still has a publication row with a published_at. The
    // line must not appear: "Published Fri at 22:17" over draft-hued rows
    // would claim a publish state the week no longer has.
    renderBanner({ state: 'retracted' });

    expect(screen.queryByText(/Published/)).not.toBeInTheDocument();
  });
});
