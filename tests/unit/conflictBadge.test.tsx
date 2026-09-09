/**
 * Tests for ConflictBadge — the shared triangle-with-popover affordance.
 *
 * Invariants:
 * 1. Renders a type="button" with the conflict text in aria-label.
 * 2. A click does NOT bubble to the parent (the ShiftCell tap-to-assign
 *    onClick must not fire from the badge).
 * 3. No render when lines is empty.
 * 4. The trigger is keyboard-focusable so the popover is reachable
 *    without a mouse.
 * 5. A click opens the popover with every conflict line — a popover, not
 *    a tooltip, so touch devices can open it (CodeRabbit finding).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ConflictBadge } from '@/components/scheduling/ShiftPlanner/ConflictBadge';

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const LINES = [
  'Employee has approved time-off from 2026-04-21 to 2026-04-22',
  'Shift on Mon, Apr 20 is outside availability',
];

describe('ConflictBadge', () => {
  it('renders a button whose aria-label carries the full conflict text', () => {
    renderWithTooltip(<ConflictBadge lines={LINES} />);
    const button = screen.getByRole('button', { name: `Conflicts: ${LINES.join('. ')}` });
    expect(button).toBeTruthy();
    expect(button.getAttribute('type')).toBe('button');
  });

  it('does not bubble a click to the parent', () => {
    const parentClick = vi.fn();
    renderWithTooltip(
      <div onClick={parentClick}>
        <ConflictBadge lines={LINES} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Conflicts:/ }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('renders nothing when lines is empty', () => {
    const { container } = renderWithTooltip(<ConflictBadge lines={[]} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('is keyboard-focusable (no negative tabIndex)', () => {
    renderWithTooltip(<ConflictBadge lines={LINES} />);
    const button = screen.getByRole('button', { name: /^Conflicts:/ });
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it('opens the popover with every line on click (touch-reachable)', () => {
    renderWithTooltip(<ConflictBadge lines={LINES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Conflicts:/ }));
    for (const line of LINES) {
      expect(screen.getByText(`• ${line}`)).toBeTruthy();
    }
  });
});
