import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

// Regression guards for sig:539980c1fe88 — the badge counts must come from
// serverTotals (the RPC aggregate), not from .filter()/.length on the paginated
// client `sales` array.
describe('POSSales — categorization badge counts use serverTotals', () => {
  it('reads uncategorized count from serverTotals.uncategorizedCount', () => {
    expect(SOURCE).toMatch(/serverTotals\.uncategorizedCount/);
  });

  it('reads pending review count from serverTotals.pendingReviewCount', () => {
    expect(SOURCE).toMatch(/serverTotals\.pendingReviewCount/);
  });

  it('AI card pending-review badge visibility is server-driven', () => {
    expect(SOURCE).toMatch(/serverTotals\.pendingReviewCount\s*>\s*0/);
  });

  it('AI Categorize button gates on totalsLoading to avoid load-state false-disable', () => {
    expect(SOURCE).toMatch(/!totalsLoading\s*&&\s*serverTotals\.uncategorizedCount\s*===\s*0/);
  });

  it('does NOT compute uncategorized count by client-side filter over sales', () => {
    expect(SOURCE).not.toMatch(/sales\.filter\(\s*sale\s*=>\s*!sale\.is_categorized\s*&&\s*!sale\.suggested_category_id\s*\)/);
    expect(SOURCE).not.toMatch(/uncategorizedSalesCount/);
  });

  it('AI card pending-review badge does NOT key off suggestedSales.length', () => {
    expect(SOURCE).not.toMatch(/suggestedSales\.length\s*>\s*0/);
  });
});
