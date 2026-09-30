import { memo } from 'react';

import { MapPin, MapPinOff } from 'lucide-react';

import { getPunchLocationFlag, formatDistance } from '@/utils/punchLocationFlag';
import type { TimePunch } from '@/types/timeTracking';

interface PunchLocationFlagProps {
  location: TimePunch['location'];
}

/**
 * Shows a small chip next to a punch when its location is off-site
 * or unavailable. Shows nothing when the punch has no flag.
 */
export const PunchLocationFlag = memo(function PunchLocationFlag({
  location,
}: PunchLocationFlagProps) {
  const flag = getPunchLocationFlag(location);

  if (flag === 'offsite') {
    const distance = location?.distance_meters;
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <MapPin className="h-3 w-3" aria-hidden="true" />
        {typeof distance === 'number' ? `${formatDistance(distance)} away` : 'Off-site'}
      </span>
    );
  }

  if (flag === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
        <MapPinOff className="h-3 w-3" aria-hidden="true" />
        No location
      </span>
    );
  }

  return null;
});
