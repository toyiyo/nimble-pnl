import { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock } from 'lucide-react';
import { WeekScheduleState } from '@/hooks/useSchedulePublish';
import { SchedulePublication } from '@/types/scheduling';
import { pluralize } from '@/lib/scheduling/deletionCopy';
import { formatDayLabel, formatLocalDateInTz, formatLocalHHMMInTz } from '@/lib/shiftInterval';

/** The fixed-height slot every state renders into; see the banner's own doc comment. */
function slot(children: ReactNode): JSX.Element {
  return <div className="min-h-[76px]">{children}</div>;
}

interface ScheduleStatusBannerProps {
  state: WeekScheduleState | null;
  publication: SchedulePublication | null;
  publishedCount: number;
  draftCount: number;
  weekRange: string;
  timezone: string;
  /** `schedule_retractions.reason`, set only when a manager wrote one. */
  retractionReason?: string | null;
}

/**
 * Owns a fixed-height slot at the top of the page.
 *
 * The height is constant across all four states on purpose. If the slot
 * collapsed while the publication lookup was in flight, the banner's arrival
 * would push `MyShiftTradesCard` and everything under it down on an
 * already-painted page — a layout shift, and on mobile a live mis-tap hazard
 * for anyone who started tapping during that beat. State B, which has no
 * banner, fills the slot with the same information in one quiet line.
 */
export function ScheduleStatusBanner({
  state,
  publication,
  publishedCount,
  draftCount,
  weekRange,
  timezone,
  retractionReason,
}: ScheduleStatusBannerProps): JSX.Element {
  // Loading, or the lookup failed. A wrong banner is worse than no banner:
  // telling someone their week is "not published yet" when it is would have
  // them ignore real shifts.
  if (!state) return slot(null);

  // Restaurant timezone, not the browser's. An employee travelling, or a
  // manager publishing at 11pm from one zone over, must not see a date that
  // disagrees with the week the shifts were bucketed into.
  const publishedOn = publication?.published_at
    ? `${formatDayLabel(formatLocalDateInTz(new Date(publication.published_at), timezone))} at ${formatLocalHHMMInTz(publication.published_at, timezone)}`
    : null;

  if (state === 'published') {
    return slot(
      publishedOn ? (
        <p className="text-[13px] text-muted-foreground">Published {publishedOn}</p>
      ) : null
    );
  }

  if (state === 'not_published') {
    return slot(
      <Alert role="status" className="bg-muted/30 border-border/40">
        <Clock className="h-4 w-4" />
        <AlertTitle className="text-[14px] font-semibold text-foreground">
          Schedule not published yet
        </AlertTitle>
        <AlertDescription className="text-[13px] text-muted-foreground">
          Your manager hasn't finalized the week of {weekRange}.{' '}
          {draftCount > 0 && (
            <>
              The {draftCount} {pluralize(draftCount, 'shift', 'shifts')} below{' '}
              {pluralize(draftCount, 'is', 'are')} still {pluralize(draftCount, 'a draft', 'drafts')} —
              nothing is confirmed yet.{' '}
            </>
          )}
          Check back soon.
        </AlertDescription>
      </Alert>
    );
  }

  if (state === 'published_revising') {
    return slot(
      <Alert role="status" className="bg-amber-500/10 border-amber-500/20 text-foreground">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-[14px] font-semibold text-foreground">
          Some shifts are still being finalized
        </AlertTitle>
        <AlertDescription className="text-[13px] text-muted-foreground">
          {publishedCount} of your {publishedCount + draftCount}{' '}
          {pluralize(publishedCount + draftCount, 'shift', 'shifts')} this week{' '}
          {pluralize(publishedCount, 'is', 'are')} confirmed. {draftCount} more{' '}
          {pluralize(draftCount, 'is a draft', 'are drafts')} your manager hasn't published yet —
          treat {pluralize(draftCount, 'it', 'them')} as tentative until{' '}
          {pluralize(draftCount, 'it shows', 'they show')} a "Confirmed" badge.
        </AlertDescription>
      </Alert>
    );
  }

  // Retracted. The one state where being unmissable outranks being quiet — it
  // is actively correcting a belief the employee may already hold from a "New
  // Schedule Published" email sitting in their inbox. Keeps the primitive's
  // assertive role.
  // No boilerplate filter needed: `schedule_retractions.reason` stores the
  // manager's `p_reason` verbatim and stays NULL when they gave none. The RPC's
  // "Schedule unpublished for date range…" default is written only to
  // `schedule_change_logs`, which this never reads.
  const showReason = !!retractionReason?.trim();

  return slot(
    <Alert className="bg-destructive/10 border-destructive/30 text-foreground">
      <AlertTriangle className="h-4 w-4 text-destructive" />
      <AlertTitle className="text-[14px] font-semibold text-foreground">
        This schedule was pulled back for changes
      </AlertTitle>
      <AlertDescription className="text-[13px] text-muted-foreground">
        Your manager published {weekRange}
        {publishedOn ? ` on ${publishedOn}` : ''}, then unpublished it to make edits. Nothing below
        is final — check back once it's republished.
        {showReason && <span className="block mt-1">Reason: {retractionReason}</span>}
      </AlertDescription>
    </Alert>
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
