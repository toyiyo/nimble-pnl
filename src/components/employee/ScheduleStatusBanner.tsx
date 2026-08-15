import { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { WeekScheduleState } from '@/hooks/useSchedulePublish';
import { SchedulePublication } from '@/types/scheduling';
import { formatDayLabel, formatLocalDateInTz, formatLocalHHMMInTz } from '@/lib/shiftInterval';

/** The fixed-height slot every state renders into; see the banner's own doc comment. */
function slot(children: ReactNode): JSX.Element {
  return <div className="min-h-[76px]">{children}</div>;
}

interface ScheduleStatusBannerProps {
  state: WeekScheduleState | null;
  publication: SchedulePublication | null;
  timezone: string;
}

/**
 * Owns a fixed-height slot at the top of the page.
 *
 * The height is constant across all states on purpose. If the slot collapsed
 * while the publication lookup was in flight, the banner's arrival would push
 * `MyShiftTradesCard` and everything under it down on an already-painted page —
 * a layout shift, and on mobile a live mis-tap hazard for anyone who started
 * tapping during that beat.
 *
 * This component never warns. Many restaurants use publish/unpublish as a
 * routine edit cycle, or never publish at all. Every alert this slot has
 * carried — "not published yet", "still being finalized", "pulled back for
 * changes" — read as "your shifts are not real" and caused no-shows. The
 * muted row treatment in `ShiftRow` is the only draft signal. The one output
 * here is a quiet "Published {date}" line when a publication exists.
 */
export function ScheduleStatusBanner({
  state,
  publication,
  timezone,
}: ScheduleStatusBannerProps): JSX.Element {
  // Loading, or the lookup failed. A wrong line is worse than no line.
  if (!state) return slot(null);

  if (state !== 'published' && state !== 'published_revising') {
    return slot(null);
  }

  // Restaurant timezone, not the browser's. An employee travelling, or a
  // manager publishing at 11pm from one zone over, must not see a date that
  // disagrees with the week the shifts were bucketed into.
  const publishedOn = publication?.published_at
    ? `${formatDayLabel(formatLocalDateInTz(new Date(publication.published_at), timezone))} at ${formatLocalHHMMInTz(publication.published_at, timezone)}`
    : null;

  return slot(
    publishedOn ? (
      <p className="text-[13px] text-muted-foreground">Published {publishedOn}</p>
    ) : null
  );
}

/** "Updated since you last checked" pill, shown beside the Weekly Schedule heading. */
export function ScheduleUpdatedPill(): JSX.Element {
  return (
    <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10 text-[11px]">
      Updated since you last checked
    </Badge>
  );
}
