/**
 * Task 5: SPLH ↔ labor-% consistency hint in the Planner's inline staffing panel.
 * Tests: hint hidden without real wage data / with non-finite-positive SPLH;
 *        warns with the labor-consistent SPLH when over target; renders muted
 *        when within target; directional helper line always shows alongside
 *        the hint; hint announces via aria-live="polite".
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StaffingConfigPanel } from '@/components/scheduling/ShiftPlanner/StaffingConfigPanel';

const baseSettings = {
  target_splh: 30,
  target_labor_pct: 25,
  min_staff: 1,
  min_crew: null,
};

const defaultProps = {
  onSettingsChange: vi.fn(),
  onImmediateSettingsChange: vi.fn(),
  onSaveDefaults: vi.fn(),
  isSaving: false,
  hasPendingChanges: false,
  employeePositions: [],
  actualSplh: null,
  lookbackWeeks: 8,
};

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(
    <StaffingConfigPanel
      {...defaultProps}
      settings={baseSettings}
      avgHourlyRateCents={1500}
      hasWageData={true}
      {...overrides}
    />,
  );
}

describe('StaffingConfigPanel — SPLH ↔ labor % consistency hint', () => {
  it('should hide the hint when there is no real wage data', () => {
    renderPanel({ settings: baseSettings, avgHourlyRateCents: 1500, hasWageData: false });
    expect(screen.queryByText(/labor at current wage/)).not.toBeInTheDocument();
  });

  it('should hide the hint when the SPLH target is not a finite positive number', () => {
    renderPanel({ settings: { ...baseSettings, target_splh: Number.NaN }, avgHourlyRateCents: 1000, hasWageData: true });
    expect(screen.queryByText(/labor at current wage/)).not.toBeInTheDocument();
  });

  it('should warn with the labor-consistent SPLH for the $10/hr, $30, 25% case', () => {
    renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
    const line = screen.getByText(/33% labor at current wage/);
    expect(line).toHaveClass('text-warning');
    expect(line).toHaveTextContent('above your 25% target, try $40');
  });

  it('should render the implied line muted when within target', () => {
    renderPanel({ settings: { ...baseSettings, target_splh: 40 }, avgHourlyRateCents: 1000, hasWageData: true });
    const line = screen.getByText(/25% labor at current wage/);
    expect(line).not.toHaveClass('text-warning');
    expect(line).not.toHaveTextContent('above your');
  });

  it('should always show the directional helper line when the hint renders', () => {
    renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
    expect(screen.getByText('Lower SPLH → more staff recommended.')).toBeInTheDocument();
  });

  it('should announce the hint politely', () => {
    const { container } = renderPanel({ settings: baseSettings, avgHourlyRateCents: 1000, hasWageData: true });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
