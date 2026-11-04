import { Badge } from '@/components/ui/badge';
import { PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Warning badge for a trade whose offered shift is not published yet.
 * The audience is the coworker who considers the trade, not the shift
 * owner, so the copy differs from ShiftRow's DraftBadge on purpose.
 * Same warning tokens as DraftBadge: one amber language for "not final".
 * The icon is supplementary; the text carries the meaning.
 *
 * Render it only on `offered_shift.is_published === false`. A cached row
 * from before the field existed is undefined, and undefined must not
 * read as tentative.
 */
export function TentativeDraftBadge({ className }: { className?: string }): JSX.Element {
  return (
    <Badge
      className={cn(
        'flex items-center gap-1 bg-warning/15 text-foreground border-warning/30 hover:bg-warning/15',
        className,
      )}
    >
      <PencilLine className="h-3 w-3" />
      Tentative — draft
    </Badge>
  );
}
