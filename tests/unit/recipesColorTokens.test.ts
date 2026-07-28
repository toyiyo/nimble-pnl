import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// CLAUDE.md "No Direct Colors": profit/loss and the POS-mapped check resolve
// through `text-success` / `text-destructive` rather than `text-green-600` /
// `text-red-600`. Both tokens carry a `.dark` override (src/index.css:104-111),
// so the token is theme-aware on its own -- which is the whole reason the raw
// literals had to be paired with manual `dark:` variants elsewhere.
//
// Same shape as tests/unit/salesVsBreakEvenChart.colorTokens.test.ts: a source
// scan, not a render assertion, because the point is that the literal must not
// exist anywhere in the file -- including branches no current test renders (the
// loss branch only appears when profit_per_serving <= 0).
//
// The amber `NoIngredientsBadge` is deliberately NOT covered here: `bg-amber-500/10`
// with an `amber-500/N` border is the badge/panel pattern CLAUDE.md itself
// documents ("AI suggestion panel"), so it is house style rather than a stray
// literal. Converting it is a separate, repo-wide call.
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('recipes list -- semantic color tokens', () => {
  const sources: Array<[string, string]> = [
    ['src/components/recipes/MemoizedRecipeRow.tsx', read('src/components/recipes/MemoizedRecipeRow.tsx')],
    ['src/pages/Recipes.tsx', read('src/pages/Recipes.tsx')],
  ];

  it.each(sources)('%s contains no text-green-* literal', (_path, src) => {
    expect(src).not.toMatch(/text-green-\d/);
  });

  it.each(sources)('%s contains no text-red-* literal', (_path, src) => {
    expect(src).not.toMatch(/text-red-\d/);
  });

  it('renders profit through the success token and loss through destructive', () => {
    const row = read('src/components/recipes/MemoizedRecipeRow.tsx');
    expect(row).toMatch(/profitIsPositive \? 'text-success' : 'text-destructive'/);
  });
});
