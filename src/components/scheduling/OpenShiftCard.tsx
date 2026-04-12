import { memo } from 'react';

import { Button } from '@/components/ui/button';

import { Calendar, Clock, MapPin, Users } from 'lucide-react';

import type { OpenShift } from '@/types/scheduling';

import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { parseDateLocal } from '@/lib/dateUtils';
import { formatCompactTime } from '@/lib/openShiftHelpers';

interface OpenShiftCardProps {
  openShift: OpenShift;
  hasConflict: boolean;
  onClaim: (openShift: OpenShift) => void;
  isClaiming: boolean;
}

export const OpenShiftCard = memo(function OpenShiftCard({
  openShift,
  hasConflict,
  onClaim,
  isClaiming,
}: OpenShiftCardProps) {
  const dateLabel = format(parseDateLocal(openShift.shift_date), 'EEE, MMM d');
  const timeLabel = `${formatCompactTime(openShift.start_time)}-${formatCompactTime(openShift.end_time)}`;
  const spotsLabel = openShift.open_spots === 1 ? '1 spot left' : `${openShift.open_spots} spots left`;

  return (
    <div
      className={cn(
        'group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors',
        hasConflict && 'opacity-60',
      )}
    >
      {/* Left side */}
      <div className="min-w-0 space-y-1.5">
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 font-medium">
          OPEN SHIFT
        </span>
        <div className="text-[14px] font-medium text-foreground truncate">
          {openShift.template_name}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {dateLabel}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {timeLabel}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {openShift.position}
            {openShift.area ? ` / ${openShift.area}` : ''}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {spotsLabel}
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="ml-4 flex-shrink-0">
        {hasConflict ? (
          <span className="text-[13px] text-muted-foreground">Schedule conflict</span>
        ) : (
          <Button
            onClick={() => onClaim(openShift)}
            disabled={isClaiming}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            aria-label={`Claim shift ${openShift.template_name} on ${dateLabel}`}
          >
            {isClaiming ? 'Claiming...' : 'Claim'}
          </Button>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.openShift.template_id === next.openShift.template_id &&
    prev.openShift.shift_date === next.openShift.shift_date &&
    prev.openShift.open_spots === next.openShift.open_spots &&
    prev.hasConflict === next.hasConflict &&
    prev.isClaiming === next.isClaiming
  );
});
