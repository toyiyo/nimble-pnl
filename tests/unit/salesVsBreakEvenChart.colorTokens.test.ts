import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Design doc section C ("Colors"): the widget's bar fills and legend swatches
// must resolve through `hsl(var(--success))` / `hsl(var(--destructive))` /
// `hsl(var(--warning))` — not the hardcoded HSL triplets finding #7 flagged
// (`hsl(142.1, 76.2%, 36.3%)`, `hsl(0, 84.2%, 60.2%)`, `hsl(45.4, 93.4%, 47.5%)`).
// The three `text-green-600` literals (summary stats + COGS chip) fold into
// the same `text-success` token so the file doesn't mix a raw Tailwind color
// alongside the new semantic classes.
//
// A source scan (not a render assertion) because the point is that literal
// color values must not exist anywhere in the file, including places no
// current test happens to render (e.g. the legend swatches, which are never
// queried by class/text in the RTL tests).
describe('SalesVsBreakEvenChart — semantic color tokens', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/components/budget/SalesVsBreakEvenChart.tsx'),
    'utf8',
  );

  it('contains no raw hsl(...) triplet — every hsl( call wraps a --token var()', () => {
    // hsl(var(--success)) etc. are fine; hsl(142.1, 76.2%, 36.3%) is not.
    const rawHslCalls = src.match(/hsl\((?!var\()[^)]*\)/g) ?? [];
    expect(rawHslCalls).toEqual([]);
  });

  it('contains no text-green-* literal', () => {
    expect(src).not.toMatch(/text-green-\d/);
  });
});
