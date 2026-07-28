import { describe, it, expect } from 'vitest';

import {
  parseThemeTokens,
  hslTokenToRgb,
  composite,
  contrastRatio,
  resolveColorUtility,
} from '../helpers/contrast';

/**
 * Unit coverage for the contrast helpers themselves.
 *
 * `ViewModeSwitch.contrast.test.tsx` uses these against the real `src/index.css`,
 * so a silent parsing bug there would weaken that guard without failing it. These
 * tests pin the parser's edge cases against hand-written CSS instead.
 */
describe('parseThemeTokens', () => {
  it('reads the :root and .dark tables', () => {
    const themes = parseThemeTokens(`
      :root { --background: 40 33% 98%; --foreground: 30 15% 15%; }
      .dark { --background: 30 15% 10%; --foreground: 40 20% 92%; }
    `);

    expect(themes.light['--background']).toBe('40 33% 98%');
    expect(themes.dark['--background']).toBe('30 15% 10%');
  });

  it('ignores a decoy selector hidden inside a comment', () => {
    const themes = parseThemeTokens(`
      /* :root { --background: 0 0% 0%; } */
      :root { --background: 40 33% 98%; }
      .dark { --background: 30 15% 10%; }
    `);

    expect(themes.light['--background']).toBe('40 33% 98%');
  });

  it('is not truncated by an unbalanced brace inside a comment', () => {
    // A bare `{` in prose is exactly the kind of thing that lives in a real
    // stylesheet, and a naive depth counter never returns from it.
    const themes = parseThemeTokens(`
      :root {
        /* use hsl(var(--background)) — note the missing } in this sentence { */
        --background: 40 33% 98%;
      }
      .dark { --background: 30 15% 10%; }
    `);

    expect(themes.light['--background']).toBe('40 33% 98%');
    expect(themes.dark['--background']).toBe('30 15% 10%');
  });

  it('keeps reading past a nested at-rule inside the block', () => {
    const themes = parseThemeTokens(`
      :root {
        --background: 40 33% 98%;
        @media (min-width: 40rem) { --gap: 2rem; }
        --foreground: 30 15% 15%;
      }
      .dark { --background: 30 15% 10%; }
    `);

    expect(themes.light['--foreground']).toBe('30 15% 15%');
  });

  it('throws a named error when a selector is missing', () => {
    expect(() => parseThemeTokens(':root { --background: 0 0% 0%; }')).toThrow(/\.dark/);
  });
});

describe('hslTokenToRgb', () => {
  it('converts the achromatic extremes', () => {
    expect(hslTokenToRgb('0 0% 100%')).toEqual([255, 255, 255]);
    expect(hslTokenToRgb('0 0% 0%')).toEqual([0, 0, 0]);
  });

  it('converts a saturated hue', () => {
    expect(hslTokenToRgb('0 100% 50%')).toEqual([255, 0, 0]);
  });
});

describe('composite', () => {
  it('returns the foreground at full alpha and the background at zero', () => {
    expect(composite([255, 255, 255], 1, [0, 0, 0])).toEqual([255, 255, 255]);
    expect(composite([255, 255, 255], 0, [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('blends linearly in between', () => {
    // The 1.03:1 defect this whole helper exists for came from exactly this
    // maths: a light layer at 40% over a dark surface lands on mid-gray.
    expect(composite([255, 255, 255], 0.4, [0, 0, 0])).toEqual([102, 102, 102]);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio([30, 40, 50], [200, 210, 220])).toBeCloseTo(
      contrastRatio([200, 210, 220], [30, 40, 50]),
      10
    );
  });
});

describe('resolveColorUtility', () => {
  const tokens = { '--personal-view': '214 32% 91%', '--foreground': '30 15% 15%' };

  it('skips non-colour utilities that share the text- prefix', () => {
    // `text-[13px]` and `text-center` sort before `text-foreground` in the
    // class list; a first-match resolver picks the wrong one and blows up.
    expect(
      resolveColorUtility('text-[13px] text-center font-medium text-foreground', 'text', tokens)
    ).toEqual({ token: '--foreground', alpha: 1 });
  });

  it('reads an alpha suffix as a fraction', () => {
    expect(resolveColorUtility('bg-personal-view/40', 'bg', tokens)).toEqual({
      token: '--personal-view',
      alpha: 0.4,
    });
  });

  it('defaults to full alpha with no suffix', () => {
    expect(resolveColorUtility('bg-personal-view', 'bg', tokens)?.alpha).toBe(1);
  });

  it('returns null when no class names a known token', () => {
    expect(resolveColorUtility('rounded-lg p-2.5', 'bg', tokens)).toBeNull();
  });

  it('ignores variant classes unless that variant is requested', () => {
    const cls = 'text-personal-view-foreground/80 hover:text-foreground';
    const withToken = { ...tokens, '--personal-view-foreground': '215 25% 27%' };

    expect(resolveColorUtility(cls, 'text', withToken)?.token).toBe('--personal-view-foreground');
    expect(resolveColorUtility(cls, 'text', withToken, 'hover')?.token).toBe('--foreground');
  });
});
