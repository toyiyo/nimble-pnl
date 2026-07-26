import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplhSlider, SPLH_SLIDER_MIN, SPLH_SLIDER_MAX, SPLH_SLIDER_STEP } from '@/components/scheduling/ShiftTimeline/SplhSlider';

// wage=15, splh=50 -> pct = 30; targetLaborPct=25 -> overTarget (30 > 25.05)
// consistent = 15 / (25/100) = 60
const BASE_PROPS = {
  value: 50,
  wage: 15,
  targetLaborPct: 25,
  canSave: true,
  isSaving: false,
  onChange: vi.fn(),
  onSave: vi.fn(),
  onReset: vi.fn(),
};

function renderSlider(overrides: Partial<typeof BASE_PROPS> = {}) {
  const props = { ...BASE_PROPS, ...overrides };
  render(<SplhSlider {...props} />);
  return props;
}

describe('SplhSlider', () => {
  it('CRITICAL: renders a native range input bounded 25-120 step 5 at the given value', () => {
    renderSlider();
    const slider = screen.getByRole('slider', { name: 'Sales per labor hour target, in dollars' });
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', String(SPLH_SLIDER_MIN));
    expect(slider).toHaveAttribute('max', String(SPLH_SLIDER_MAX));
    expect(slider).toHaveAttribute('step', String(SPLH_SLIDER_STEP));
    expect(slider).toHaveValue('50');
    expect(SPLH_SLIDER_MIN).toBe(25);
    expect(SPLH_SLIDER_MAX).toBe(120);
    expect(SPLH_SLIDER_STEP).toBe(5);
  });

  it('CRITICAL: dragging the slider calls onChange with the new numeric value', () => {
    const props = renderSlider();
    const slider = screen.getByRole('slider', { name: 'Sales per labor hour target, in dollars' });
    fireEvent.change(slider, { target: { value: '65' } });
    expect(props.onChange).toHaveBeenCalledWith(65);
  });

  it('CRITICAL: shows the live implied-labor readout (pct + wage) computed from impliedLabor', () => {
    renderSlider();
    // wage=15, splh=50 -> pct = 30
    expect(screen.getByText(/30(\.0)?% labor/)).toBeInTheDocument();
    expect(screen.getByText(/\$15(\.00)?\/hr/)).toBeInTheDocument();
  });

  it('CRITICAL: pill reads "Over target" and carries destructive styling when pct exceeds target+0.05', () => {
    renderSlider(); // 30% > 25.05% target
    const pill = screen.getByTestId('splh-slider-pill');
    expect(pill).toHaveTextContent(/over target/i);
    expect(pill.className).toMatch(/destructive/);
  });

  it('CRITICAL: pill reads "On target" and carries success styling when at/under target+0.05', () => {
    // wage=15, splh=70 -> pct ≈ 21.43, under 25.05 target
    renderSlider({ value: 70 });
    const pill = screen.getByTestId('splh-slider-pill');
    expect(pill).toHaveTextContent(/on target/i);
    expect(pill.className).toMatch(/success/);
  });

  it('renders a notch at laborConsistentSplh, labeled with the consistent $ value and target labor %', () => {
    renderSlider(); // consistent = 15 / 0.25 = 60
    const notch = screen.getByTestId('splh-slider-notch');
    expect(notch).toHaveTextContent('$60');
    expect(notch).toHaveTextContent('25% labor');
  });

  it('Reset button calls onReset when clicked', () => {
    const props = renderSlider();
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: Save button is hidden entirely for non-managers (canSave=false)', () => {
    renderSlider({ canSave: false });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    // Reset still available to everyone
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });

  it('CRITICAL: Save button calls onSave when clicked for managers (canSave=true)', () => {
    const props = renderSlider();
    fireEvent.click(screen.getByRole('button', { name: /^save sales per labor hour target$/i }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: Save button shows a pending "Saving…" state and is disabled while isSaving', () => {
    renderSlider({ isSaving: true });
    const button = screen.getByRole('button', { name: /^saving sales per labor hour target$/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Saving…');
  });

  it('CRITICAL: aria-valuetext includes the implied labor percentage', () => {
    renderSlider();
    const slider = screen.getByRole('slider', { name: 'Sales per labor hour target, in dollars' });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/30(\.0)?%/);
  });
});
