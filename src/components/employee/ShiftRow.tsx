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
  PencilLine,
  XCircle,
} from 'lucide-react';
import { format, parseISO, isToday, isFuture, isPast, differenceInMinutes } from 'date-fns';
import { Shift } from '@/types/scheduling';
import { cn } from '@/lib/utils';

const formatShiftDuration = (
  startTime: string,
  endTime: string,
  breakMinutes: number
) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const netMinutes = differenceInMinutes(end, start) - breakMinutes;
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const getShiftStatusBadge = (shift: Shift) => {
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

  if (isToday(startTime)) {
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
};

/**
 * Deliberately NOT variant="outline". The pre-existing "Upcoming" badge is an
 * outline pill in this exact slot, so an outline draft badge would be a second
 * identical grey pill and read as just another status — the precise failure the
 * tentative treatment exists to avoid. The amber matches the "being revised"
 * banner so "amber = not final" is one language across the page. The icon is
 * supplementary; the text carries the meaning.
 */
const DraftBadge = () => (
  <Badge className="flex items-center gap-1 bg-amber-500/15 text-foreground border-amber-500/30 hover:bg-amber-500/15">
    <PencilLine className="h-3 w-3" />
    Draft — not confirmed
  </Badge>
);

interface ShiftRowProps {
  shift: Shift;
  /**
   * `'day'` is the weekly grid row; `'upcoming'` is the Upcoming Shifts card,
   * which leads with a date block. Both take the identical draft branch — that
   * shared branch is the reason this is one component and not two.
   */
  variant?: 'day' | 'upcoming';
  onTrade?: (shift: Shift) => void;
}

export function ShiftRow({ shift, variant = 'day', onTrade }: ShiftRowProps) {
  const isDraft = !shift.is_published;
  const isCancelled = shift.status === 'cancelled';

  // Every one of these signals is load-bearing and redundant on purpose: the
  // dashed border, the badge copy, the muted type and the missing Trade button
  // each say "not final" on their own, because the banner above may go unread
  // on a fast mobile glance.
  const surface = isCancelled
    ? 'bg-destructive/10 line-through'
    : isDraft
      ? 'bg-muted/20 border border-dashed border-border/60'
      : variant === 'upcoming'
        ? 'bg-background border'
        : 'bg-muted/50';

  const timeText = isDraft ? 'font-normal text-muted-foreground' : 'font-medium';

  const canTrade =
    !!onTrade && shift.is_published && !isCancelled && isFuture(parseISO(shift.start_time));

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

  // "Is this real" outranks "when is this", so the draft badge takes the slot
  // the status badge would otherwise occupy rather than sitting beside it.
  const statusBadge = isDraft ? <DraftBadge /> : getShiftStatusBadge(shift);

  if (variant === 'upcoming') {
    return (
      <div className={cn('flex items-center justify-between p-3 rounded-lg', surface)}>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-sm font-medium text-muted-foreground">
              {format(parseISO(shift.start_time), 'EEE')}
            </div>
            <div className={cn('text-2xl', isDraft ? 'font-normal text-muted-foreground' : 'font-bold')}>
              {format(parseISO(shift.start_time), 'd')}
            </div>
            <div className="text-xs text-muted-foreground">
              {format(parseISO(shift.start_time), 'MMM')}
            </div>
          </div>
          <div>
            <div className={timeText}>
              {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
              {format(parseISO(shift.end_time), 'h:mm a')}
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
            {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
            {format(parseISO(shift.end_time), 'h:mm a')}
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
        {tradeButton}
      </div>
    </div>
  );
}
