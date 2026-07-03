/**
 * Unit tests for CoverageDemandInfo — the "How is 'needed' set?" explainer popover.
 *
 * These tests verify:
 * 1. The trigger button is keyboard-focusable and has a meaningful aria-label.
 * 2. The popover content is accessible (describes demand formula).
 * 3. A link to Staffing settings is present.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import userEvent from '@testing-library/user-event';
import { CoverageDemandInfo } from '@/components/scheduling/ShiftTimeline/CoverageDemandInfo';

describe('CoverageDemandInfo', () => {
  it('renders a focusable trigger button with an accessible label', () => {
    render(<CoverageDemandInfo />);
    const trigger = screen.getByRole('button', { name: /how is needed staff calculated/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the popover and shows the demand formula when triggered', async () => {
    const user = userEvent.setup();
    render(<CoverageDemandInfo />);
    const trigger = screen.getByRole('button', { name: /how is needed staff calculated/i });
    await user.click(trigger);
    // Formula explanation should appear in the popover
    expect(screen.getByText(/sales per labor hour/i)).toBeInTheDocument();
  });

  it('shows a link to Staffing settings in the popover content', async () => {
    const user = userEvent.setup();
    render(<CoverageDemandInfo />);
    const trigger = screen.getByRole('button', { name: /how is needed staff calculated/i });
    await user.click(trigger);
    // A link pointing to the settings page should be visible
    const link = screen.getByRole('link', { name: /staffing settings/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('popover content mentions "Covered" and "Short" so users understand the verdict', async () => {
    const user = userEvent.setup();
    render(<CoverageDemandInfo />);
    await user.click(screen.getByRole('button', { name: /how is needed staff calculated/i }));
    expect(screen.getByText(/covered/i)).toBeInTheDocument();
    expect(screen.getByText(/short/i)).toBeInTheDocument();
  });

  it('can be opened and then dismissed via the Escape key', async () => {
    const user = userEvent.setup();
    render(<CoverageDemandInfo />);
    const trigger = screen.getByRole('button', { name: /how is needed staff calculated/i });
    await user.click(trigger);
    // Confirm popover is open
    expect(screen.getByText(/sales per labor hour/i)).toBeInTheDocument();
    // Dismiss with Escape
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/sales per labor hour/i)).not.toBeInTheDocument();
  });
});
