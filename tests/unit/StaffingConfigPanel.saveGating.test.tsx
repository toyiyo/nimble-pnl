/**
 * Task 9: StaffingConfigPanel clarity — Save gating + help labels
 * Tests: Save button disabled when no pending changes; enabled when pending;
 *        helper text visible; HelpCircle tooltips have aria-labels.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StaffingConfigPanel } from '@/components/scheduling/ShiftPlanner/StaffingConfigPanel';

const defaultSettings = {
  target_splh: 50,
  target_labor_pct: 30,
  min_staff: 2,
  min_crew: null,
  open_shifts_enabled: true,
  require_shift_claim_approval: false,
};

const defaultProps = {
  settings: defaultSettings,
  onSettingsChange: vi.fn(),
  onImmediateSettingsChange: vi.fn(),
  onSaveDefaults: vi.fn(),
  isSaving: false,
  employeePositions: [],
  actualSplh: null,
  lookbackWeeks: 8,
};

describe('StaffingConfigPanel — Task 9 clarity', () => {
  // ── Test 1: Save button disabled when hasPendingChanges is false ─────────────
  it('disables "Save as Default" when hasPendingChanges is false', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={false}
      />,
    );

    // The button's aria-label is "Save staffing settings as default"; query by label substring
    const btn = document.querySelector('[aria-label="Save staffing settings as default"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  // ── Test 2: Save button enabled when hasPendingChanges is true ──────────────
  it('enables "Save as Default" when hasPendingChanges is true', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={true}
      />,
    );

    const btn = document.querySelector('[aria-label="Save staffing settings as default"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
  });

  // ── Test 3: Save button also disabled while isSaving (even if pending) ──────
  it('disables "Save as Default" while isSaving even if hasPendingChanges is true', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={true}
        isSaving={true}
      />,
    );

    const btn = document.querySelector('[aria-label="Save staffing settings as default"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  // ── Test 4: Helper text visible below Save button ───────────────────────────
  it('renders the helper text below the Save button', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={false}
      />,
    );

    expect(
      screen.getByText(/toggles save automatically/i),
    ).toBeTruthy();
  });

  // ── Test 5: HelpCircle for "Sales per Labor Hour" has aria-label ─────────────
  it('HelpTip for Sales per Labor Hour has an aria-label on its trigger', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={false}
      />,
    );

    const trigger = document.querySelector('[aria-label*="Help for Sales per Labor Hour"]');
    expect(trigger).toBeTruthy();
  });

  // ── Test 6: HelpCircle for "Labor Cost Target" has aria-label ───────────────
  it('HelpTip for Labor Cost Target has an aria-label on its trigger', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={false}
      />,
    );

    const trigger = document.querySelector('[aria-label*="Help for Labor Cost Target"]');
    expect(trigger).toBeTruthy();
  });

  // ── Test 7: HelpCircle for "Minimum Crew" has aria-label ────────────────────
  it('HelpTip for Minimum Crew has an aria-label on its trigger', () => {
    render(
      <StaffingConfigPanel
        {...defaultProps}
        hasPendingChanges={false}
      />,
    );

    const trigger = document.querySelector('[aria-label*="Help for Minimum Crew"]');
    expect(trigger).toBeTruthy();
  });
});
