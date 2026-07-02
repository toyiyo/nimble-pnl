import { minutesToCompact } from '@/lib/shiftCoverage';
import type { TimelineGap } from './useTimelineModel';
import { STEP_MIN } from './useTimelineModel';

interface CoverageGapListProps {
  readonly gaps: TimelineGap[];
}

/**
 * Accessible list of understaffed time windows.
 *
 * Renders each gap as a visible list item with a red indicator dot so the
 * understaffed windows are identifiable without relying solely on color
 * (WCAG 1.4.1).  Returns null when there are no gaps so no empty container
 * is mounted.
 */
export function CoverageGapList({ gaps }: CoverageGapListProps) {
  if (gaps.length === 0) return null;

  return (
    <ul aria-label="Understaffed windows" className="mt-3 space-y-1">
      {gaps.map((g) => (
        <li
          key={g.startMin}
          className="text-[13px] text-muted-foreground flex items-center gap-2"
        >
          <span aria-hidden className="h-2 w-2 rounded-sm bg-destructive" />
          Below demand {minutesToCompact(g.startMin)}–{minutesToCompact((g.endMin + STEP_MIN) % 1440)}
        </li>
      ))}
    </ul>
  );
}
