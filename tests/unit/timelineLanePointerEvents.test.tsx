/**
 * Regression test for the "shared-row shift bar can't be hovered/edited" bug.
 *
 * `TimelineLane` wraps every bar in a full-width (`absolute left-0 right-0`)
 * div positioned at the bar's row band. When two shifts share a row (the
 * first-fit `assignRows` packer places a later, non-overlapping shift on the
 * same row), the later-rendered bar's full-width wrapper paints on top of the
 * earlier bar's narrow rect and — with the default `pointer-events: auto` —
 * swallows all hover/click/drag over it, making the earlier bar inert. This
 * was reported in production for the *earlier* bar in a shared row, whose
 * shifts were verified `locked: false` (not a lock bug). Fixtures below use
 * fictional names — no PII in the repo.
 *
 * The fix scopes pointer capture to the bar's real rect:
 *   - the full-width wrapper is `pointer-events-none` (empty band ignores
 *     pointer events; they fall through to the lane's paint-to-create layer),
 *   - the bar rect (`absolute inset-y-0.5`, scoped by left%/width%) is
 *     `pointer-events-auto`, so only the actual bar captures events and
 *     siblings on the same row no longer overlap in the hit-test region.
 *
 * jsdom performs no layout / hit-testing, so we assert the structural class
 * invariant that prevents the overlap rather than simulating a real click.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TimelineLane } from '@/components/scheduling/ShiftTimeline/TimelineLane';
import type {
  TimelineLane as TimelineLaneModel,
  TimelineBar as TimelineBarModel,
} from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { Shift } from '@/types/scheduling';

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1380 }; // 10:00–23:00

function minToPct(min: number): number {
  return ((min - WINDOW.startMin) / (WINDOW.endMin - WINDOW.startMin)) * 100;
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-06T15:00:00Z',
    end_time: '2026-07-06T19:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    notes: '',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const COLOR = {
  bg: 'bg-blue-500/15',
  border: 'border-blue-500/30',
  text: 'text-blue-700 dark:text-blue-300',
} as const;

function makeBar(overrides: Partial<TimelineBarModel> = {}): TimelineBarModel {
  return {
    shift: makeShift(),
    row: 0,
    leftMin: 600,
    endMin: 840,
    label: 'Ann Smith',
    ariaLabel: 'Ann Smith, Server, 10a to 2p, 4.0 hours',
    color: COLOR,
    ...overrides,
  };
}

/** Two abutting, non-overlapping shifts packed onto the SAME row (row 0). */
function makeSharedRowLane(): TimelineLaneModel {
  const earlier = makeBar({
    shift: makeShift({ id: 'bar-a', employee_id: 'bar-a' }),
    row: 0,
    leftMin: 600, // 10:00
    endMin: 840, //  14:00
    label: 'Ada Early',
    ariaLabel: 'Ada Early, Server, 10a to 2p, 4.0 hours',
  });
  const later = makeBar({
    shift: makeShift({ id: 'bar-b', employee_id: 'bar-b' }),
    row: 0,
    leftMin: 840, //  14:00  (abuts Ada — same row)
    endMin: 1290, // 21:30
    label: 'Bess Late',
    ariaLabel: 'Bess Late, Server, 2p to 930p, 7.5 hours',
  });
  return {
    key: 'Server',
    label: 'Server',
    hours: 11.5,
    bars: [earlier, later], // render order: earlier first, later on top
  };
}

function renderSharedRowLane() {
  return render(
    <TimelineLane
      lane={makeSharedRowLane()}
      minToPct={minToPct}
      window={WINDOW}
      onSelect={vi.fn()}
      onPaintCommit={vi.fn()}
      onBarDraftChange={vi.fn()}
      onBarDragCommit={vi.fn()}
    />,
  );
}

describe('TimelineLane — shared-row bars do not steal each other’s pointer events', () => {
  it('renders the full-width bar wrapper with pointer-events-none', () => {
    renderSharedRowLane();

    for (const name of [/ada early/i, /bess late/i]) {
      const button = screen.getByRole('button', { name });
      // button → bar rect (inset-y-0.5) → full-width wrapper (left-0 right-0)
      const wrapper = button.parentElement?.parentElement as HTMLElement;
      expect(wrapper.className).toContain('left-0');
      expect(wrapper.className).toContain('right-0');
      expect(wrapper).toHaveClass('pointer-events-none');
    }
  });

  it('renders each bar rect with pointer-events-auto so the real bar stays interactive', () => {
    renderSharedRowLane();

    for (const name of [/ada early/i, /bess late/i]) {
      const button = screen.getByRole('button', { name });
      const rect = button.parentElement as HTMLElement;
      expect(rect.className).toContain('inset-y-0.5');
      expect(rect).toHaveClass('pointer-events-auto');
    }
  });
});
