/**
 * Tests for `PersonalViewBanner` — the persistent slate banner shown while in
 * work mode, guiding the user back to admin.
 *
 * `variant="desktop"`: full-width bar with "You're in your personal view." +
 * subtitle, and a "Back to admin" button. `variant="mobile"`: slim strip with
 * "Personal view" + an "Admin ›" button (`aria-label="Back to admin"`). Both
 * variants are `role="status"`, use the `personal-view` semantic tokens, and
 * "Back to admin" calls `exitWorkMode`. The entrance animation is omitted
 * when the user prefers reduced motion.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Mock-exact copy & layout" / "Visual language" sections).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseViewMode = vi.fn();
vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => mockUseViewMode(),
}));

import { PersonalViewBanner } from '@/components/PersonalViewBanner';

const exitWorkMode = vi.fn();

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('PersonalViewBanner', () => {
  beforeEach(() => {
    exitWorkMode.mockClear();
    mockUseViewMode.mockReturnValue({
      viewMode: 'work',
      canUseWorkView: true,
      enterWorkMode: vi.fn(),
      exitWorkMode,
    });
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('variant="desktop"', () => {
    it('renders as a status region with the personal-view copy', () => {
      render(<PersonalViewBanner variant="desktop" />);

      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      expect(screen.getByText("You're in your personal view.")).toBeInTheDocument();
      expect(
        screen.getByText("Seeing your own schedule & pay — not the restaurant's admin tools.")
      ).toBeInTheDocument();
    });

    it('renders a "Back to admin" button that calls exitWorkMode', () => {
      render(<PersonalViewBanner variant="desktop" />);

      const button = screen.getByRole('button', { name: /back to admin/i });
      fireEvent.click(button);

      expect(exitWorkMode).toHaveBeenCalledTimes(1);
    });

    it('uses the personal-view token surface', () => {
      render(<PersonalViewBanner variant="desktop" />);

      const status = screen.getByRole('status');
      expect(status.className).toMatch(/bg-personal-view\b/);
      expect(status.className).toMatch(/text-personal-view-foreground/);
      expect(status.className).toMatch(/border-personal-view-border/);
    });
  });

  describe('variant="mobile"', () => {
    it('renders the compact "Personal view" strip', () => {
      render(<PersonalViewBanner variant="mobile" />);

      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      expect(screen.getByText('Personal view')).toBeInTheDocument();
    });

    it('renders a labeled "Back to admin" control that calls exitWorkMode', () => {
      render(<PersonalViewBanner variant="mobile" />);

      const button = screen.getByRole('button', { name: 'Back to admin' });
      fireEvent.click(button);

      expect(exitWorkMode).toHaveBeenCalledTimes(1);
    });

    it('shows the "Admin ›" label text', () => {
      render(<PersonalViewBanner variant="mobile" />);

      expect(screen.getByText(/admin/i, { selector: 'button *' })).toBeInTheDocument();
    });
  });

  describe('reduced motion', () => {
    it('applies an entrance animation class by default', () => {
      mockMatchMedia(false);
      render(<PersonalViewBanner variant="desktop" />);

      const status = screen.getByRole('status');
      expect(status.className).toMatch(/animate-in/);
    });

    it('omits the animation class when prefers-reduced-motion is set', () => {
      mockMatchMedia(true);
      render(<PersonalViewBanner variant="desktop" />);

      const status = screen.getByRole('status');
      expect(status.className).not.toMatch(/animate-in/);
    });
  });
});
