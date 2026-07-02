/**
 * Unit tests for ShiftTimeline sub-components:
 *   - CoverageCurve
 *   - NowIndicator
 *   - TimelineAxis
 *   - TimelineLane
 *   - TimelineShiftPopover
 *
 * These tests exercise the rendering paths that bring the new-code coverage
 * above the SonarCloud 80% threshold for this PR.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CoverageCurve } from '@/components/scheduling/ShiftTimeline/CoverageCurve';
import { NowIndicator } from '@/components/scheduling/ShiftTimeline/NowIndicator';
import { TimelineAxis } from '@/components/scheduling/ShiftTimeline/TimelineAxis';
import { TimelineLane } from '@/components/scheduling/ShiftTimeline/TimelineLane';
import { TimelineShiftPopover } from '@/components/scheduling/ShiftTimeline/TimelineShiftPopover';
import type { TimelineLane as TimelineLaneModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';

import type { TimelineWindow, TimelineBar as TimelineBarModel } from '@/components/scheduling/ShiftTimeline/useTimelineModel';
import type { Shift } from '@/types/scheduling';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const WINDOW: TimelineWindow = { startMin: 600, endMin: 1080 }; // 10:00-18:00

function minToPct(min: number): number {
  return ((min - WINDOW.startMin) / (WINDOW.endMin - WINDOW.startMin)) * 100;
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
    notes: '',
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
    label: 'Ann Smith',
    ariaLabel: 'Ann Smith, Server, 10a to 4p, 6.0 hours',
    color: {
      bg: 'bg-blue-500/15',
      border: 'border-blue-500/30',
      text: 'text-blue-700 dark:text-blue-300',
    },
    ...overrides,
  };
}

// ─── CoverageCurve ─────────────────────────────────────────────────────────────

describe('CoverageCurve', () => {
  it('renders an SVG with role="img" when coverage is non-empty', () => {
    render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 2 }, { min: 615, count: 3 }]}
        demand={null}
        gaps={[]}
        minToPct={minToPct}
      />,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('returns null when coverage array is empty', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[]}
        demand={null}
        gaps={[]}
        minToPct={minToPct}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the demand dashed line when demand is provided', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 2 }]}
        demand={[{ min: 600, target: 3 }]}
        gaps={[]}
        minToPct={minToPct}
      />,
    );
    // Two <path> elements: coverage area + demand line
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it('renders gap shading rectangles for understaffed windows', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 1 }]}
        demand={[{ min: 600, target: 3 }]}
        gaps={[{ startMin: 600, endMin: 615 }]}
        minToPct={minToPct}
      />,
    );
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });

  it('includes a title and desc for accessibility', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 2 }]}
        demand={null}
        gaps={[]}
        minToPct={minToPct}
      />,
    );
    expect(container.querySelector('title')).toBeInTheDocument();
    expect(container.querySelector('desc')).toBeInTheDocument();
  });

  it('mentions correct gap count in desc (plural)', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 1 }]}
        demand={null}
        gaps={[{ startMin: 600, endMin: 615 }, { startMin: 660, endMin: 675 }]}
        minToPct={minToPct}
      />,
    );
    const desc = container.querySelector('desc');
    expect(desc?.textContent).toContain('2 understaffed windows');
  });

  it('mentions singular gap count in desc', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 1 }]}
        demand={null}
        gaps={[{ startMin: 600, endMin: 615 }]}
        minToPct={minToPct}
      />,
    );
    const desc = container.querySelector('desc');
    expect(desc?.textContent).toContain('1 understaffed window');
    expect(desc?.textContent).not.toContain('windows');
  });

  it('renders with a custom height prop', () => {
    const { container } = render(
      <CoverageCurve
        window={WINDOW}
        coverage={[{ min: 600, count: 2 }]}
        demand={null}
        gaps={[]}
        minToPct={minToPct}
        height={120}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toContain('120');
  });
});

// ─── NowIndicator ─────────────────────────────────────────────────────────────

describe('NowIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a vertical line when current time is within the window', () => {
    // Set system time to 2026-07-11 13:00 UTC = 08:00 America/Chicago (CDT UTC-5)
    // 08:00 CDT = 480 min, which is inside WINDOW (600-1080)... actually no.
    // Let's use a time inside the window: 14:00 CDT = 14:00 local = 840 min.
    // 2026-07-11 19:00 UTC = 14:00 CDT (UTC-5)
    vi.setSystemTime(new Date('2026-07-11T19:00:00Z'));
    const { container } = render(
      <NowIndicator
        dateStr="2026-07-11"
        tz="America/Chicago"
        window={WINDOW}
        minToPct={minToPct}
      />,
    );
    // Should render a div (the vertical line)
    const line = container.querySelector('[aria-hidden]');
    expect(line).toBeInTheDocument();
  });

  it('returns null when current time is before the window', () => {
    // 2026-07-11 08:00 UTC = 03:00 CDT = 180 min — before window start (600)
    vi.setSystemTime(new Date('2026-07-11T08:00:00Z'));
    const { container } = render(
      <NowIndicator
        dateStr="2026-07-11"
        tz="America/Chicago"
        window={WINDOW}
        minToPct={minToPct}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when the selected day is not today', () => {
    // System time is 2026-07-11 14:00 CDT, but dateStr = 2026-07-12 (tomorrow)
    vi.setSystemTime(new Date('2026-07-11T19:00:00Z'));
    const { container } = render(
      <NowIndicator
        dateStr="2026-07-12"
        tz="America/Chicago"
        window={WINDOW}
        minToPct={minToPct}
      />,
    );
    // The line is outside the window for tomorrow's date range
    // nowMin relative to 2026-07-12 baseline will be negative (yesterday)
    expect(container).toBeEmptyDOMElement();
  });
});

// ─── TimelineAxis ─────────────────────────────────────────────────────────────

describe('TimelineAxis', () => {
  it('renders tick labels for each hour in the window', () => {
    // Window 600 (10:00) to 720 (12:00) → ticks at 600, 660, 720
    render(
      <TimelineAxis
        window={{ startMin: 600, endMin: 720 }}
        minToPct={minToPct}
      />,
    );
    // minutesToCompact(600) = "10a", minutesToCompact(660) = "11a", minutesToCompact(720) = "12p"
    expect(screen.getByText('10a')).toBeInTheDocument();
    expect(screen.getByText('11a')).toBeInTheDocument();
    expect(screen.getByText('12p')).toBeInTheDocument();
  });

  it('renders the full-width baseline', () => {
    const { container } = render(
      <TimelineAxis window={WINDOW} minToPct={minToPct} />,
    );
    // The outer div is aria-hidden
    const axis = container.firstChild as HTMLElement;
    expect(axis.getAttribute('aria-hidden')).toBe('true');
  });

  it('normalises overnight tick labels (e.g. 1500 → "1a")', () => {
    // Window 1380 (23:00) to 1500 (01:00 next day)
    render(
      <TimelineAxis
        window={{ startMin: 1380, endMin: 1500 }}
        minToPct={(m) => ((m - 1380) / (1500 - 1380)) * 100}
      />,
    );
    expect(screen.getByText('11p')).toBeInTheDocument();
    expect(screen.getByText('12a')).toBeInTheDocument();
    expect(screen.getByText('1a')).toBeInTheDocument();
  });
});

// ─── TimelineLane ─────────────────────────────────────────────────────────────

function makeLane(overrides: Partial<TimelineLaneModel> = {}): TimelineLaneModel {
  return {
    key: 'Front',
    label: 'Front',
    hours: 6,
    bars: [makeBar()],
    ...overrides,
  };
}

describe('TimelineLane', () => {
  it('renders the lane label', () => {
    render(
      <TimelineLane lane={makeLane()} minToPct={minToPct} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('Front')).toBeInTheDocument();
  });

  it('shows "Unassigned" when label is empty', () => {
    render(
      <TimelineLane lane={makeLane({ key: 'unknown', label: '', hours: 0, bars: [] })} minToPct={minToPct} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows plural "shifts" when there are multiple bars', () => {
    const bars = [
      makeBar({ shift: makeShift({ id: 's1' }), row: 0 }),
      makeBar({ shift: makeShift({ id: 's2' }), row: 1 }),
    ];
    render(
      <TimelineLane lane={makeLane({ hours: 12, bars })} minToPct={minToPct} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/2 shifts/)).toBeInTheDocument();
  });

  it('shows singular "shift" when there is one bar', () => {
    render(
      <TimelineLane lane={makeLane({ key: 'Back', label: 'Back', hours: 8 })} minToPct={minToPct} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/1 shift\b/)).toBeInTheDocument();
  });

  it('displays the total hours for the lane', () => {
    render(
      <TimelineLane lane={makeLane({ key: 'Bar', label: 'Bar', hours: 7.5 })} minToPct={minToPct} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/7\.5h/)).toBeInTheDocument();
  });

  it('calls onSelect when a shift bar button is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TimelineLane lane={makeLane()} minToPct={minToPct} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

// ─── TimelineShiftPopover ─────────────────────────────────────────────────────

describe('TimelineShiftPopover', () => {
  it('renders nothing when activeShift is null', () => {
    const { container } = render(
      <TimelineShiftPopover
        activeShift={null}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the shift position when a shift is active', () => {
    render(
      <TimelineShiftPopover
        activeShift={makeShift({ position: 'Bartender' })}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Bartender')).toBeInTheDocument();
  });

  it('shows status in title-case', () => {
    render(
      <TimelineShiftPopover
        activeShift={makeShift({ status: 'scheduled' })}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('shows notes row when notes are present', () => {
    render(
      <TimelineShiftPopover
        activeShift={makeShift({ notes: 'Check inventory' })}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Check inventory')).toBeInTheDocument();
  });

  it('does not show notes row when notes are empty', () => {
    render(
      <TimelineShiftPopover
        activeShift={makeShift({ notes: '' })}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('calls onClose when the popover is dismissed', async () => {
    const onClose = vi.fn();
    render(
      <TimelineShiftPopover
        activeShift={makeShift()}
        tz="America/Chicago"
        dateStr="2026-07-11"
        onClose={onClose}
      />,
    );
    // The popover is open; pressing Escape should close it
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
