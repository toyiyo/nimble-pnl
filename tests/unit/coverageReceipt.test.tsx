import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CoverageReceipt } from '@/components/scheduling/ShiftTimeline/CoverageReceipt';
import type { CoverageHour } from '@/lib/coverageSummary';

const BASE_PARAMS = { minStaff: 4, weekdayKey: 'Monday', wage: 15, lookbackWeeks: 6, hasWageData: true };

function hourFixture(opts: Partial<CoverageHour> & { demand: number | null; scheduled: number }): CoverageHour {
  const { demand, scheduled, scheduledMax = scheduled, projectedSales = demand === null ? null : 100, ...rest } = opts;
  return {
    hour: 10,
    startMin: 600,
    scheduled,
    scheduledMax,
    needed: null,
    demand,
    delta: null,
    projectedSales,
    laborPct: null,
    ...rest,
  };
}

// Matches the worked example from coverageChartModel.test.ts / the design doc:
// $503 sales, demand 17 (⇒ implied target $30/hr), minStaff 4, scheduled 14 ⇒ crit.
const critHour = hourFixture({ demand: 17, scheduled: 14, projectedSales: 503 });
// demand=3, minStaff=5 pulls needed to 5; scheduled=4 meets demand but misses the floor.
const floorHour = hourFixture({ demand: 3, scheduled: 4, projectedSales: 90 });
const okHour = hourFixture({ demand: 5, scheduled: 5, projectedSales: 150 });
const spareHour = hourFixture({ demand: 5, scheduled: 7, projectedSales: 150 });
const nodataHour = hourFixture({ demand: null, scheduled: 5 });

describe('CoverageReceipt', () => {
  it('CRITICAL: renders buildReceipt rows for a crit hour (label + value pairs)', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    const receipt = screen.getByTestId('coverage-receipt');
    expect(within(receipt).getByText('Avg Monday sales')).toBeInTheDocument();
    expect(within(receipt).getByText('$503')).toBeInTheDocument();
    expect(within(receipt).getByText('= demand')).toBeInTheDocument();
    expect(within(receipt).getByText('17 people')).toBeInTheDocument();
    expect(within(receipt).getByText('Short on demand')).toBeInTheDocument();
    expect(within(receipt).getByText('-3')).toBeInTheDocument();
  });

  it('renders buildReceipt asides below the ledger (implied SPLH note)', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    expect(screen.getByText(/implied SPLH is \$36\/hr/i)).toBeInTheDocument();
  });

  it('should omit the implied-SPLH aside when there is no real wage data', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} hasWageData={false} />);
    expect(screen.queryByText(/implied SPLH is/)).not.toBeInTheDocument();
  });

  it('should still show the implied-SPLH aside when wage data is real', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} hasWageData={true} />);
    expect(screen.getByText(/implied SPLH is/)).toBeInTheDocument();
  });

  it('CRITICAL: nodata hour renders no ledger rows, only the explanatory aside', () => {
    render(<CoverageReceipt hour={nodataHour} {...BASE_PARAMS} />);
    const receipt = screen.getByTestId('coverage-receipt');
    expect(within(receipt).queryByText('= demand')).not.toBeInTheDocument();
    expect(within(receipt).getAllByText(/No sales in the last 6 Mondays/).length).toBeGreaterThan(0);
  });

  it('CRITICAL: "Add shift for this hour" button renders for a crit hour and calls onQuickAdd with startMin', () => {
    const onQuickAdd = vi.fn();
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} onQuickAdd={onQuickAdd} />);
    const button = screen.getByRole('button', { name: /add shift for this hour/i });
    fireEvent.click(button);
    expect(onQuickAdd).toHaveBeenCalledWith(critHour.startMin);
  });

  it('CRITICAL: "Add shift for this hour" button renders for a floor hour', () => {
    const onQuickAdd = vi.fn();
    render(<CoverageReceipt hour={floorHour} {...BASE_PARAMS} minStaff={5} onQuickAdd={onQuickAdd} />);
    expect(screen.getByRole('button', { name: /add shift for this hour/i })).toBeInTheDocument();
  });

  it('CRITICAL: "Add shift for this hour" is absent for ok/spare/nodata hours even with onQuickAdd supplied', () => {
    const onQuickAdd = vi.fn();
    const { rerender } = render(<CoverageReceipt hour={okHour} {...BASE_PARAMS} minStaff={2} onQuickAdd={onQuickAdd} />);
    expect(screen.queryByRole('button', { name: /add shift for this hour/i })).not.toBeInTheDocument();

    rerender(<CoverageReceipt hour={spareHour} {...BASE_PARAMS} minStaff={2} onQuickAdd={onQuickAdd} />);
    expect(screen.queryByRole('button', { name: /add shift for this hour/i })).not.toBeInTheDocument();

    rerender(<CoverageReceipt hour={nodataHour} {...BASE_PARAMS} onQuickAdd={onQuickAdd} />);
    expect(screen.queryByRole('button', { name: /add shift for this hour/i })).not.toBeInTheDocument();
  });

  it('omitting onQuickAdd hides the button entirely even for a crit hour (back-compat)', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    expect(screen.queryByRole('button', { name: /add shift for this hour/i })).not.toBeInTheDocument();
  });

  it('CRITICAL: exposes an aria-live="polite" region carrying the receipt content', () => {
    render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    const region = screen.getByTestId('coverage-receipt-announcement');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toMatch(/= demand 17 people/);
  });

  it('CRITICAL: selecting a different hour updates the aria-live text immediately (no commit event needed)', () => {
    const { rerender } = render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    rerender(<CoverageReceipt hour={{ ...floorHour, startMin: 660 }} {...BASE_PARAMS} minStaff={5} />);
    const region = screen.getByTestId('coverage-receipt-announcement');
    expect(region.textContent).toMatch(/Short on floor -1/);
  });

  it('CRITICAL: dragging the slider (same hour, changing data) does NOT update aria-live text until a commit event (pointerup/keyup) fires', () => {
    const { rerender } = render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    const region = screen.getByTestId('coverage-receipt-announcement');
    const initialText = region.textContent;
    expect(initialText).toMatch(/Short on demand -3/);

    // Same startMin, different derived numbers — simulates a live slider-drag
    // frame re-running the staffing pipeline while the selected hour stays put.
    const draggedHour: CoverageHour = { ...critHour, demand: 20, scheduled: 10, delta: -10, projectedSales: 600 };
    rerender(<CoverageReceipt hour={draggedHour} {...BASE_PARAMS} minStaff={4} />);

    // Visual ledger redraws live even mid-drag...
    expect(screen.getByTestId('coverage-receipt').textContent).toMatch(/20 people/);
    // ...but the SR announcement text is still frozen on the pre-drag value.
    expect(screen.getByTestId('coverage-receipt-announcement').textContent).toBe(initialText);

    fireEvent.pointerUp(window);

    expect(screen.getByTestId('coverage-receipt-announcement').textContent).toMatch(/20 people/);
  });

  it('a keyup commit event also flushes the frozen aria-live text', () => {
    const { rerender } = render(<CoverageReceipt hour={critHour} {...BASE_PARAMS} minStaff={4} />);
    const draggedHour: CoverageHour = { ...critHour, demand: 22, scheduled: 10, delta: -12, projectedSales: 660 };
    rerender(<CoverageReceipt hour={draggedHour} {...BASE_PARAMS} minStaff={4} />);
    expect(screen.getByTestId('coverage-receipt-announcement').textContent).not.toMatch(/22 people/);

    fireEvent.keyUp(window);

    expect(screen.getByTestId('coverage-receipt-announcement').textContent).toMatch(/22 people/);
  });
});
