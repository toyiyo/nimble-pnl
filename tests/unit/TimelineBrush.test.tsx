import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { startOfDay, endOfDay, subDays, addDays } from 'date-fns';
import { TimelineBrush } from '@/components/banking/cashflow/TimelineBrush';
import type { Period } from '@/components/PeriodSelector';

function mockMatchMedia(matches: Record<string, boolean>) {
  // `restoreAllMocks` does not undo a direct `window.matchMedia =` assignment.
  // Stub it through `vi.stubGlobal` so `vi.unstubAllGlobals()` in `afterEach`
  // restores the original value between tests.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function makePeriod(from: Date, to: Date): Period {
  return {
    type: 'custom',
    from: startOfDay(from),
    to: endOfDay(to),
    label: 'custom',
  };
}

describe('TimelineBrush', () => {
  beforeEach(() => {
    // Desktop by default: sm and lg both match.
    mockMatchMedia({
      '(min-width: 640px)': true,
      '(min-width: 1024px)': true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a start and end thumb with the required aria-labels', () => {
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    expect(screen.getByRole('slider', { name: 'Start date' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'End date' })).toBeInTheDocument();
  });

  it('gives both thumbs a 24px (h-6 w-6) target size', () => {
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    for (const thumb of screen.getAllByRole('slider')) {
      expect(thumb.className).toMatch(/\bh-6\b/);
      expect(thumb.className).toMatch(/\bw-6\b/);
    }
  });

  it('calls onPeriodChange with type "custom" when a thumb commits a new value', () => {
    const today = new Date();
    const onPeriodChange = vi.fn();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={onPeriodChange}
      />
    );

    const endThumb = screen.getByRole('slider', { name: 'End date' });
    endThumb.focus();
    fireEvent.keyDown(endThumb, { key: 'ArrowLeft' });

    expect(onPeriodChange).toHaveBeenCalled();
    const [call] = onPeriodChange.mock.calls.at(-1)!;
    expect(call.type).toBe('custom');
    expect(call.from).toBeInstanceOf(Date);
    expect(call.to).toBeInstanceOf(Date);
  });

  it('moves the thumbs when the period changes externally (e.g. a preset click)', () => {
    const today = new Date();
    const { rerender } = render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const before = screen
      .getByRole('slider', { name: 'Start date' })
      .getAttribute('aria-valuenow');

    rerender(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 5), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const after = screen
      .getByRole('slider', { name: 'Start date' })
      .getAttribute('aria-valuenow');

    expect(after).not.toBe(before);
  });

  it('uses a one-day step at sm and above', () => {
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const startThumb = screen.getByRole('slider', { name: 'Start date' });
    // Radix exposes the step via the underlying `step` attribute passed to Root,
    // which shows up as aria-valuenow deltas; assert the wrapper's data attribute instead.
    expect(startThumb.closest('[data-timeline-step]')?.getAttribute('data-timeline-step')).toBe(
      '1'
    );
  });

  it('uses a seven-day step below sm', () => {
    mockMatchMedia({
      '(min-width: 640px)': false,
      '(min-width: 1024px)': false,
    });
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const startThumb = screen.getByRole('slider', { name: 'Start date' });
    expect(startThumb.closest('[data-timeline-step]')?.getAttribute('data-timeline-step')).toBe(
      '7'
    );
  });

  it('shows a tick for every month at lg and above', () => {
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const ticks = screen.getAllByTestId('timeline-brush-tick');
    // 24-month domain -> every month shown means >= 20 ticks.
    expect(ticks.length).toBeGreaterThanOrEqual(20);
  });

  it('thins ticks to every third month below lg', () => {
    mockMatchMedia({
      '(min-width: 640px)': true,
      '(min-width: 1024px)': false,
    });
    const today = new Date();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 30), today)}
        onPeriodChange={vi.fn()}
      />
    );

    const ticks = screen.getAllByTestId('timeline-brush-tick');
    expect(ticks.length).toBeLessThanOrEqual(10);
  });

  it('includes the start year in the label when the range crosses a year boundary', () => {
    const from = new Date(2026, 11, 20); // Dec 20, 2026
    const to = new Date(2027, 0, 5); // Jan 5, 2027
    const onPeriodChange = vi.fn();
    render(<TimelineBrush selectedPeriod={makePeriod(from, to)} onPeriodChange={onPeriodChange} />);

    const endThumb = screen.getByRole('slider', { name: 'End date' });
    endThumb.focus();
    fireEvent.keyDown(endThumb, { key: 'ArrowLeft' });

    expect(onPeriodChange).toHaveBeenCalled();
    const [call] = onPeriodChange.mock.calls.at(-1)!;
    expect(call.label).toMatch(/^Dec 20, 2026 - /);
  });

  it('exposes the thumb dates through aria-valuetext', () => {
    const from = new Date(2026, 6, 1); // Jul 1, 2026
    const to = new Date(2026, 7, 19); // Aug 19, 2026
    render(<TimelineBrush selectedPeriod={makePeriod(from, to)} onPeriodChange={vi.fn()} />);

    expect(screen.getByRole('slider', { name: 'Start date' })).toHaveAttribute(
      'aria-valuetext',
      'Jul 1, 2026'
    );
    expect(screen.getByRole('slider', { name: 'End date' })).toHaveAttribute(
      'aria-valuetext',
      'Aug 19, 2026'
    );
  });

  it('renders a date bubble on each thumb with the thumb date', () => {
    const from = new Date(2026, 6, 1); // Jul 1, 2026
    const to = new Date(2026, 7, 19); // Aug 19, 2026
    render(<TimelineBrush selectedPeriod={makePeriod(from, to)} onPeriodChange={vi.fn()} />);

    const bubbles = screen.getAllByTestId('brush-thumb-date');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveTextContent('Jul 1, 2026');
    expect(bubbles[1]).toHaveTextContent('Aug 19, 2026');
  });

  it('extends the domain to a future custom period end instead of clamping it to today', () => {
    const today = new Date();
    const futureTo = addDays(today, 10);
    const onPeriodChange = vi.fn();
    render(
      <TimelineBrush
        selectedPeriod={makePeriod(subDays(today, 5), futureTo)}
        onPeriodChange={onPeriodChange}
      />
    );

    // Move only the start thumb; the end thumb's index should already
    // reflect the future end date, not a value clamped to today.
    const startThumb = screen.getByRole('slider', { name: 'Start date' });
    startThumb.focus();
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    expect(onPeriodChange).toHaveBeenCalled();
    const [call] = onPeriodChange.mock.calls.at(-1)!;
    expect(startOfDay(call.to).getTime()).toBe(startOfDay(futureTo).getTime());
  });
});
