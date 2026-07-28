/**
 * Colour-contrast helpers for token-level a11y guards.
 *
 * These exist because class-name assertions cannot see contrast. PR #660
 * shipped a persona card whose label text measured 1.05:1 against its own
 * background while every test happily confirmed the class was the semantic
 * token `text-muted-foreground`. The token was semantic; it was simply wrong
 * for the surface it landed on. Tests that want to catch that class of bug
 * have to resolve tokens to numbers and do the arithmetic.
 *
 * The values come from the real `src/index.css`, so a future edit to a theme
 * token is caught by the same assertion that caught the original defect.
 */

export type ThemeName = 'light' | 'dark';
export type TokenMap = Record<string, string>;
export type Rgb = readonly [number, number, number];

/**
 * Extract the custom-property block for a selector, honouring nesting so a
 * stray `{` inside a comment or nested rule cannot truncate the match.
 */
function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`contrast helper: "${selector}" not found in CSS`);

  const open = css.indexOf('{', start);
  if (open === -1) throw new Error(`contrast helper: no block opens after "${selector}"`);

  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`contrast helper: unterminated block for "${selector}"`);
}

/** Parse `--token: H S% L%;` declarations out of one selector's block. */
function parseTokens(block: string): TokenMap {
  const tokens: TokenMap = {};
  const decl = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(block)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** Parse the `:root` (light) and `.dark` token tables out of `src/index.css`. */
export function parseThemeTokens(css: string): Record<ThemeName, TokenMap> {
  return {
    light: parseTokens(extractBlock(css, ':root')),
    dark: parseTokens(extractBlock(css, '.dark')),
  };
}

/** Convert a Tailwind-style bare HSL triplet (`"214 32% 91%"`) to RGB 0-255. */
export function hslTokenToRgb(value: string): Rgb {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value.trim());
  if (!m) throw new Error(`contrast helper: "${value}" is not a bare HSL triplet`);

  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  if (s === 0) return [l * 255, l * 255, l * 255];

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/** Alpha-composite `fg` at `alpha` over an opaque `bg` (simple source-over). */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2],
  ];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(c: Rgb): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG 2.x contrast ratio; order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Resolve a Tailwind colour utility from a live `className` string to the CSS
 * custom property and alpha it paints with.
 *
 * `tokens` is required and is what makes this precise: the `text-` prefix is
 * shared with non-colour utilities (`text-[13px]`, `text-center`), so the
 * first `text-*` class in a list is frequently not the colour. Only a class
 * whose name resolves to a real token in the theme table is accepted.
 *
 * Matches only unprefixed utilities by default so `hover:text-foreground` does
 * not masquerade as the resting colour; pass `variant` to target one instead.
 * Returns `null` when the class list carries no such utility.
 */
export function resolveColorUtility(
  className: string,
  prefix: 'bg' | 'text',
  tokens: TokenMap,
  variant?: string
): { token: string; alpha: number } | null {
  const want = variant ? `${variant}:${prefix}-` : `${prefix}-`;
  for (const cls of className.split(/\s+/).filter(Boolean)) {
    // Reject a variant-prefixed class when none was asked for, and vice versa.
    const hasVariant = cls.includes(':');
    if (hasVariant !== Boolean(variant)) continue;
    if (!cls.startsWith(want)) continue;

    const [name, alphaPart] = cls.slice(want.length).split('/');
    const token = `--${name}`;
    if (!name || !(token in tokens)) continue;

    const alpha = alphaPart === undefined ? 1 : Number(alphaPart) / 100;
    if (!Number.isFinite(alpha)) continue;
    return { token, alpha };
  }
  return null;
}

/**
 * Paint a stack of `bg-*` utilities onto an opaque base surface, bottom-up,
 * and return the resulting opaque colour.
 */
export function paintStack(tokens: TokenMap, base: Rgb, layers: Array<{ token: string; alpha: number }>): Rgb {
  return layers.reduce<Rgb>((surface, layer) => {
    const value = tokens[layer.token];
    if (!value) throw new Error(`contrast helper: token ${layer.token} missing from theme`);
    return composite(hslTokenToRgb(value), layer.alpha, surface);
  }, base);
}

/** Resolve a `text-*` utility against an already-composited surface. */
export function textOn(
  tokens: TokenMap,
  surface: Rgb,
  text: { token: string; alpha: number }
): Rgb {
  const value = tokens[text.token];
  if (!value) throw new Error(`contrast helper: token ${text.token} missing from theme`);
  return composite(hslTokenToRgb(value), text.alpha, surface);
}
