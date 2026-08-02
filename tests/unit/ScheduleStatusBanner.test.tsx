import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScheduleStatusBanner } from '@/components/employee/ScheduleStatusBanner';
import { SchedulePublication } from '@/types/scheduling';

const TZ = 'America/Chicago';
const WEEK_RANGE = 'Aug 3 - Aug 9';

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
      publishedCount={4}
      draftCount={0}
      weekRange={WEEK_RANGE}
      timezone={TZ}
      {...props}
    />
  );
}

describe('ScheduleStatusBanner', () => {
  it('says nothing at all while the status is still unknown', () => {
    const { container } = renderBanner({ state: null });

    // A wrong banner is worse than no banner. The slot still occupies its
    // height so the page does not jump when the answer arrives.
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

  it('tells an employee a draft-only week is not theirs yet', () => {
    renderBanner({ state: 'not_published', publication: null, publishedCount: 0, draftCount: 3 });

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Schedule not published yet');
    expect(banner).toHaveTextContent(`Your manager hasn't finalized the week of ${WEEK_RANGE}`);
    // The count is the part that connects the banner to the rows below it.
    expect(banner).toHaveTextContent('The 3 shifts below are still drafts');
  });

  it('omits the shift-count sentence when there is nothing on the grid to explain', () => {
    renderBanner({ state: 'not_published', publication: null, publishedCount: 0, draftCount: 0 });

    expect(screen.getByRole('status')).not.toHaveTextContent('shifts below');
  });

  it('singularizes the draft sentence for a lone shift', () => {
    renderBanner({ state: 'not_published', publication: null, publishedCount: 0, draftCount: 1 });

    expect(screen.getByRole('status')).toHaveTextContent('The 1 shift below is still a draft');
  });

  it('splits confirmed from unconfirmed while a week is being revised', () => {
    renderBanner({ state: 'published_revising', publishedCount: 3, draftCount: 2 });

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Some shifts are still being finalized');
    expect(banner).toHaveTextContent('3 of your shifts this week are confirmed');
    expect(banner).toHaveTextContent('2 more are drafts');
  });

  it('announces a retraction assertively, naming when the week had been published', () => {
    renderBanner({ state: 'retracted', publishedCount: 0, draftCount: 5 });

    // role="alert", not "status": this is correcting a belief the employee may
    // already hold from a "New Schedule Published" email in their inbox.
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('This schedule was pulled back for changes');
    expect(banner).toHaveTextContent(`Your manager published ${WEEK_RANGE} on Sat, Aug 1 at 10:00`);
    expect(banner).toHaveTextContent("check back once it's republished");
  });

  it('passes along a reason a manager actually wrote', () => {
    renderBanner({
      state: 'retracted',
      publishedCount: 0,
      draftCount: 5,
      retractionReason: 'Two callouts, rebuilding the weekend',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reason: Two callouts, rebuilding the weekend'
    );
  });

  it('omits the reason line when the manager gave none', () => {
    // `schedule_retractions.reason` is NULL in that case — the RPC's
    // "Schedule unpublished for date range…" default goes to
    // schedule_change_logs, which the banner never reads. Whitespace stands in
    // for a manager who opened the box and typed nothing.
    renderBanner({
      state: 'retracted',
      publishedCount: 0,
      draftCount: 5,
      retractionReason: '   ',
    });

    expect(screen.getByRole('alert')).not.toHaveTextContent('Reason:');
  });

  it('still renders the retraction when the publication row is missing', () => {
    renderBanner({ state: 'retracted', publication: null, publishedCount: 0, draftCount: 5 });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('This schedule was pulled back for changes');
    // With no publication row there is no published_at to format, so the
    // " on {day} at {time}" clause must be absent entirely -- not rendered
    // empty, which would read as "published  on , then unpublished it".
    expect(banner).not.toHaveTextContent(/ on \w/);
  });
});
