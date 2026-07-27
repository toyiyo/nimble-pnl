/**
 * Tests for `ViewModeSwitch` — the "You're viewing as" persona card.
 *
 * Renders `null` when `!canUseWorkView` (fail closed, no empty shell). When
 * eligible, shows the eyebrow label + a two-button segmented control inside
 * `role="group"` `aria-label="View mode"`, with `aria-pressed` reflecting the
 * current effective `viewMode`. Clicking "My Work" calls `enterWorkMode`;
 * clicking "Admin" calls `exitWorkMode`.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Mock-exact copy & layout" / "Three-state / a11y" sections).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseViewMode = vi.fn();
vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => mockUseViewMode(),
}));

import { ViewModeSwitch } from '@/components/ViewModeSwitch';

const enterWorkMode = vi.fn();
const exitWorkMode = vi.fn();

describe('ViewModeSwitch', () => {
  beforeEach(() => {
    enterWorkMode.mockClear();
    exitWorkMode.mockClear();
  });

  it('renders null when !canUseWorkView', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'admin',
      canUseWorkView: false,
      enterWorkMode,
      exitWorkMode,
    });

    const { container } = render(<ViewModeSwitch />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the eyebrow label and both toggle buttons when eligible', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'admin',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);

    expect(screen.getByText(/you're viewing as/i)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'View mode' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Work' })).toBeInTheDocument();
  });

  it('reflects viewMode via aria-pressed on each button (admin active)', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'admin',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);

    expect(screen.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'My Work' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('reflects viewMode via aria-pressed on each button (work active)', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'work',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);

    expect(screen.getByRole('button', { name: 'Admin' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: 'My Work' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('clicking "My Work" calls enterWorkMode', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'admin',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'My Work' }));

    expect(enterWorkMode).toHaveBeenCalledTimes(1);
    expect(exitWorkMode).not.toHaveBeenCalled();
  });

  it('clicking "Admin" calls exitWorkMode', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'work',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));

    expect(exitWorkMode).toHaveBeenCalledTimes(1);
    expect(enterWorkMode).not.toHaveBeenCalled();
  });

  it('shows the hint line under the segmented control', () => {
    mockUseViewMode.mockReturnValue({
      viewMode: 'admin',
      canUseWorkView: true,
      enterWorkMode,
      exitWorkMode,
    });

    render(<ViewModeSwitch />);

    expect(
      screen.getByText('Switch to clock in, view your schedule, timecard, and pay.')
    ).toBeInTheDocument();
  });
});
