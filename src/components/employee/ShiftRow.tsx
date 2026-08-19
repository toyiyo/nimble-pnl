import { isFuture, isPast, differenceInMinutes } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeftRight,
  Calendar,
  CheckCircle,
  Clock,
  ClockIcon,
  Coffee,
  MapPin,
  XCircle,
} from 'lucide-react';
import { Shift } from '@/types/scheduling';
import { cn } from '@/lib/utils';
import { RestaurantClock } from '@/hooks/useRestaurantClock';

function formatShiftDuration(startTime: string, endTime: string, breakMinutes: number): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  // Clamped: a break longer than the shift is a data-entry slip, and "-1h 30m"
  // on an employee's own schedule reads as a bug in the app rather than one in
  // the shift.
  const netMinutes = Math.max(0, differenceInMinutes(end, start) - breakMinutes);
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Two kinds of question live here. "Is this shift today?" is a calendar-day
// question: it must use the restaurant's business day (`clock.toBusinessDay`
// vs `clock.today`), not the viewer's. "Is this shift over, in progress, or
// not yet started?" is an instant question: an instant compares the same way
// in every timezone, so `isPast`, `isFuture` and the `now` range check stay
// exactly as they are — do not route them through the clock.
function getShiftStatusBadge(shift: Shift, clock: RestaurantClock): JSX.Element | null {
  const startTime = new Date(shift.start_time);
  const endTime = new Date(shift.end_time);
  const now = new Date();

  if (shift.status === 'cancelled') {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        Cancelled
      </Badge>
    );
  }

  if (isPast(endTime)) {
    return (
      <Badge variant="outline" className="flex items-center gap-1 bg-muted">
        <CheckCircle className="h-3 w-3" />
        Completed
      </Badge>
    );
  }

  if (now >= startTime && now <= endTime) {
    return (
      <Badge className="flex items-center gap-1 bg-green-500">
        <ClockIcon className="h-3 w-3" />
        In Progress
      </Badge>
    );
  }

  if (clock.toBusinessDay(shift.start_time) === clock.today) {
    return (
      <Badge variant="default" className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Today
      </Badge>
    );
  }

  if (isFuture(startTime)) {
    return (
      <Badge variant="outline" className="flex items-center gap-1">
        <Calendar className="h-3 w-3" />
        Upcoming
      </Badge>
    );
  }

  return null;
}

type ShiftRowVariant = 'day' | 'upcoming';

interface ShiftRowProps {
  shift: Shift;
  /**
   * `'day'` is the weekly grid row; `'upcoming'` is the Upcoming Shifts card,
   * which leads with a date block. Both take the identical draft branch — that
   * shared branch is the reason this is one component and not two.
   */
  variant?: ShiftRowVariant;
  onTrade?: (shift: Shift) => void;
  clock: RestaurantClock;
}

/** Cancelled outranks draft, which outranks the per-variant default. */
function getSurfaceClass(isCancelled: boolean, isDraft: boolean, variant: ShiftRowVariant): string {
  if (isCancelled) return 'bg-destructive/10 line-through';
  if (isDraft) return 'bg-muted/20 border border-dashed border-border/60';
  if (variant === 'upcoming') return 'bg-background border';
  return 'bg-muted/50';
}

export function ShiftRow({ shift, variant = 'day', onTrade, clock }: ShiftRowProps): JSX.Element {
  const isDraft = !shift.is_published;
  const isCancelled = shift.status === 'cancelled';

  // Drafts get a visual treatment only, no explanatory copy: many restaurants
  // never publish, so words like "not confirmed" read as a threat on shifts
  // that are, in practice, final. The dashed muted surface and the lighter
  // type mark "draft" for sighted users; the sr-only label below carries the
  // same fact to screen readers. The Trade button is NOT a draft signal: the
  // draft-trade design (docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md)
  // lets an employee offer a draft shift, marked tentative on the trade side.
  const surface = getSurfaceClass(isCancelled, isDraft, variant);
  const timeText = isDraft ? 'font-normal text-muted-foreground' : 'font-medium';

  const canTrade = !!onTrade && !isCancelled && isFuture(new Date(shift.start_time));

  const tradeButton = canTrade ? (
    <Button
      size="sm"
      variant="outline"
      onClick={() => onTrade!(shift)}
      className="min-h-[44px]"
    >
      <ArrowLeftRight className="h-4 w-4 mr-1" />
      Trade
    </Button>
  ) : null;

  const statusBadge = getShiftStatusBadge(shift, clock);

  // Color and border alone would fail a screen reader and WCAG 1.4.1.
  const draftSrLabel =
    isDraft && !isCancelled ? <span className="sr-only">Draft</span> : null;

  if (variant === 'upcoming') {
    return (
      <div className={cn('flex items-center justify-between p-3 rounded-lg', surface)}>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-sm font-medium text-muted-foreground">
              {clock.formatInstant(shift.start_time, 'EEE')}
            </div>
            <div className={cn('text-2xl', isDraft ? 'font-normal text-muted-foreground' : 'font-bold')}>
              {clock.formatInstant(shift.start_time, 'd')}
            </div>
            <div className="text-xs text-muted-foreground">
              {clock.formatInstant(shift.start_time, 'MMM')}
            </div>
          </div>
          <div>
            <div className={timeText}>
              {clock.formatInstant(shift.start_time, 'h:mm a')} -{' '}
              {clock.formatInstant(shift.end_time, 'h:mm a')}
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" />
              {shift.position}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {shift.break_duration > 0 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Coffee className="h-3 w-3" />
              {shift.break_duration}m break
            </div>
          )}
          {statusBadge}
          {draftSrLabel}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg',
        surface
      )}
    >
      <div className="flex items-center gap-4">
        <div>
          <div className={timeText}>
            {clock.formatInstant(shift.start_time, 'h:mm a')} -{' '}
            {clock.formatInstant(shift.end_time, 'h:mm a')}
          </div>
          <div className="text-sm text-muted-foreground">{shift.position}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-muted-foreground">
          {formatShiftDuration(shift.start_time, shift.end_time, shift.break_duration)}
        </div>
        {shift.break_duration > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Coffee className="h-3 w-3" />
            {shift.break_duration}m
          </div>
        )}
        {statusBadge}
        {draftSrLabel}
        {tradeButton}
      </div>
    </div>
  );
}
