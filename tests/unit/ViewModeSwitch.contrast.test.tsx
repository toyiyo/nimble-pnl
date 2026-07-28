/**
 * Contrast guard for `ViewModeSwitch` — the "You're viewing as" persona card.
 *
 * PR #660 shipped this card with `text-muted-foreground` labels on a
 * `bg-personal-view/40` background. Every existing test confirmed the classes
 * were semantic tokens, and they were — but the card is mounted in
 * `SidebarFooter`, where `--sidebar-background` is dark *even in light theme*,
 * so a 40%-alpha light slate composited to mid-gray and the labels measured
 * 1.05:1 against it on a real screen.
 *
 * Class-name assertions structurally cannot catch that. These tests resolve
 * the component's actual rendered utilities against the actual token values in
 * `src/index.css`, composite the layer stack over each mount surface, and do
 * the WCAG arithmetic.
 *
 * See docs/superpowers/specs/2026-07-28-persona-card-contrast-design.md
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  parseThemeTokens,
  hslTokenToRgb,
  contrastRatio,
  resolveColorUtility,
  paintStack,
  textOn,
  type Rgb,
  type ThemeName,
  type TokenMap,
} from '../helpers/contrast';

const mockUseViewMode = vi.fn();
vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => mockUseViewMode(),
}));

import { ViewModeSwitch } from '@/components/ViewModeSwitch';

/** WCAG 1.4.3 for normal-size text. Every label here is 11-13px. */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * The two places `ViewModeSwitch` is mounted, and the opaque token whose
 * surface it lands on. Keep in sync with `AppSidebar.tsx` and
 * `UserProfileDropdown.tsx`.
 */
const MOUNTS = [
  { name: 'sidebar footer', surfaceToken: '--sidebar-background' },
  // NOT `--popover`: `UserProfileDropdown` passes `bg-background/95` to
  // `DropdownMenuContent`, and tailwind-merge drops the primitive's own
  // `bg-popover`. The two tokens differ in both themes (light `40 33% 98%` vs
  // `0 0% 100%`), so modelling the wrong one would model the wrong surface.
  { name: 'account dropdown', surfaceToken: '--background' },
] as const;

let themes: Record<ThemeName, TokenMap>;

beforeAll(() => {
  // vitest runs from the project root (`root` is unset in vitest.config.ts).
  themes = parseThemeTokens(readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8'));
});

interface Labels {
  card: HTMLElement;
  eyebrow: HTMLElement;
  hint: HTMLElement;
  track: HTMLElement;
  pressed: HTMLElement;
  unpressed: HTMLElement;
}

function renderCard(): Labels {
  mockUseViewMode.mockReturnValue({
    viewMode: 'admin',
    canUseWorkView: true,
    enterWorkMode: vi.fn(),
    exitWorkMode: vi.fn(),
  });

  const { container } = render(<ViewModeSwitch />);
  const card = container.firstElementChild as HTMLElement;
  expect(card).not.toBeNull();

  return {
    card,
    eyebrow: screen.getByText(/you're viewing as/i),
    hint: screen.getByText(/switch to clock in/i),
    track: screen.getByRole('group', { name: 'View mode' }),
    pressed: screen.getByRole('button', { name: 'Admin' }),
    unpressed: screen.getByRole('button', { name: 'My Work' }),
  };
}

/** Read a required `bg-*` utility off an element, failing loudly if absent. */
function bgOf(theme: ThemeName, el: HTMLElement, what: string) {
  const layer = resolveColorUtility(el.className, 'bg', themes[theme]);
  if (!layer) throw new Error(`expected a themed bg-* utility on the ${what}`);
  return layer;
}

/** Read a required resting `text-*` utility off an element. */
function textOf(theme: ThemeName, el: HTMLElement, what: string) {
  const color = resolveColorUtility(el.className, 'text', themes[theme]);
  if (!color) throw new Error(`expected a themed text-* utility on the ${what}`);
  return color;
}

describe('ViewModeSwitch contrast', () => {
  describe.each(MOUNTS)('mounted in the $name', ({ surfaceToken }) => {
    describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
      const base = (): Rgb => hslTokenToRgb(themes[theme][surfaceToken]);

      it('renders the eyebrow label at 4.5:1 or better', () => {
        const { card, eyebrow } = renderCard();
        const surface = paintStack(themes[theme], base(), [bgOf(theme, card, 'card')]);
        const color = textOn(themes[theme], surface, textOf(theme, eyebrow, 'eyebrow'));

        expect(contrastRatio(color, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it('renders the hint line at 4.5:1 or better', () => {
        const { card, hint } = renderCard();
        const surface = paintStack(themes[theme], base(), [bgOf(theme, card, 'card')]);
        const color = textOn(themes[theme], surface, textOf(theme, hint, 'hint line'));

        expect(contrastRatio(color, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it('renders the unpressed segment label at 4.5:1 or better', () => {
        const { card, track, unpressed } = renderCard();
        const surface = paintStack(themes[theme], base(), [
          bgOf(theme, card, 'card'),
          bgOf(theme, track, 'segment track'),
        ]);
        const color = textOn(themes[theme], surface, textOf(theme, unpressed, 'unpressed segment'));

        expect(contrastRatio(color, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it('renders the pressed segment label at 4.5:1 or better', () => {
        const { card, track, pressed } = renderCard();
        const surface = paintStack(themes[theme], base(), [
          bgOf(theme, card, 'card'),
          bgOf(theme, track, 'segment track'),
          bgOf(theme, pressed, 'pressed segment'),
        ]);
        const color = textOn(themes[theme], surface, textOf(theme, pressed, 'pressed segment'));

        expect(contrastRatio(color, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it('keeps the unpressed segment legible on hover', () => {
        const { card, track, unpressed } = renderCard();
        const hover = resolveColorUtility(unpressed.className, 'text', themes[theme], 'hover');
        if (!hover) throw new Error('expected a hover:text-* utility on the unpressed segment');

        const surface = paintStack(themes[theme], base(), [
          bgOf(theme, card, 'card'),
          bgOf(theme, track, 'segment track'),
        ]);

        expect(
          contrastRatio(textOn(themes[theme], surface, hover), surface)
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    });
  });

  it('paints the card opaquely so it does not inherit the mount surface', () => {
    // The whole defect was alpha letting a dark sidebar bleed into a light
    // slate card. An opaque card renders identically in both mounts, which is
    // what makes the ratios above mount-independent rather than coincidental.
    const { card } = renderCard();

    expect(bgOf('light', card, 'card').alpha).toBe(1);
  });
});
