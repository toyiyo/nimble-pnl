import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8'
);

describe('POSSales grouped/sort/load-more contract', () => {
  it('no longer renders a "Load more" button', () => {
    expect(SRC).not.toMatch(/Load more/);
    expect(SRC).not.toMatch(/loadMoreSales/);
  });

  it('uses the server-side grouped hook, not a local grouped memo', () => {
    expect(SRC).toMatch(/useUnifiedSalesGrouped/);
    // The old client-side Map-based grouping is gone.
    expect(SRC).not.toMatch(/new Map<string, \{ total_quantity/);
  });

  it('wires auto-load with the cap escape hatch', () => {
    expect(SRC).toMatch(/autoLoadAll:\s*true/);
    expect(SRC).toMatch(/loadAllRemaining/);
    expect(SRC).toMatch(/reachedCap/);
  });

  it('has a view-aware grouped sort control', () => {
    expect(SRC).toMatch(/groupedSortBy/);
  });
});
