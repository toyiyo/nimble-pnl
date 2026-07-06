import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineBar } from '@/components/scheduling/ShiftTimeline/TimelineBar';
import type { TimelineBar as TimelineBarModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { TimelineWindow } from '@/lib/timelineModel';
import type { Shift } from '@/types/scheduling';

const WINDOW: TimelineWindow = { startMin: 600, endMin: 960 };

// TimelineBar's pointer drag-move/edge-resize gesture (Stage D) is covered
// exhaustively in tests/unit/timelineBarDrag.test.tsx. These tests only need
// the bar's pre-existing label/color/select rendering, so the drag-related
// props are supplied as inert defaults (a null plot rect means every drag
// computation bails out early, leaving click-to-select as the only reachable
// interaction here).
function dragExtraProps() {
  return {
    window: WINDOW,
    getPlotRect: () => null,
    onDraftChange: vi.fn(),
    onDragCommit: vi.fn(),
  };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-11T15:00:00Z',
    end_time: '2026-07-11T21:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeBar(overrides: Partial<TimelineBarModel> = {}): TimelineBarModel {
  return {
    shift: makeShift(),
    row: 0,
    leftMin: 600,
    endMin: 960,
    label: 'Carolina Sanchez',
    ariaLabel: 'Carolina Sanchez, Server, 10a to 4p, 6.0 hours',
    color: {
      bg: 'bg-blue-500/15',
      border: 'border-blue-500/30',
      text: 'text-blue-700 dark:text-blue-300',
    },
    ...overrides,
  };
}

describe('TimelineBar', () => {
  const minToPct = (min: number) => ((min - 600) / (960 - 600)) * 100;

  it('renders a button with the correct aria-label', () => {
    const onSelect = vi.fn();
    render(
      <TimelineBar
        bar={makeBar()}
        minToPct={minToPct}
        onSelect={onSelect}
        {...dragExtraProps()}
      />,
    );
    const btn = screen.getByRole('button', { name: /Carolina Sanchez, Server/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Carolina Sanchez, Server, 10a to 4p, 6.0 hours');
  });

  it('calls onSelect with the shift when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const bar = makeBar();
    render(
      <TimelineBar
        bar={bar}
        minToPct={minToPct}
        onSelect={onSelect}
        {...dragExtraProps()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(bar.shift);
  });

  it('displays the bar label text', () => {
    render(
      <TimelineBar
        bar={makeBar({ label: 'Jane Doe' })}
        minToPct={minToPct}
        onSelect={vi.fn()}
        {...dragExtraProps()}
      />,
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('applies the bar color classes', () => {
    render(
      <TimelineBar
        bar={makeBar()}
        minToPct={minToPct}
        onSelect={vi.fn()}
        {...dragExtraProps()}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-blue-500/15');
  });
});
