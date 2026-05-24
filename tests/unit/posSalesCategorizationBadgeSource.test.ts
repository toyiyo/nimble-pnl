import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

// Regression guards: badge counts must come from server-side RPC aggregates,
// not from .filter()/.length on the paginated client `sales` array. The AI
// banner additionally uses an unfiltered (no searchTerm) totals call so its
// counts + button-gate are not scoped to the active search.
describe('POSSales — categorization badge counts use server totals', () => {
  it('AI banner uncategorized count comes from unfilteredTotals (search-independent)', () => {
    expect(SOURCE).toMatch(/unfilteredTotals\.uncategorizedCount/);
  });

  it('AI banner pending-review count comes from unfilteredTotals (search-independent)', () => {
    expect(SOURCE).toMatch(/unfilteredTotals\.pendingReviewCount/);
  });

  it('AI banner pending-review badge visibility is server-driven', () => {
    expect(SOURCE).toMatch(/unfilteredTotals\.pendingReviewCount\s*>\s*0/);
  });

  it('AI Categorize button is disabled while unfilteredTotals are loading', () => {
    // Both: blocked during load (prevents premature click on unknown state)
    // and blocked at zero (prevents no-op call once data is known).
    expect(SOURCE).toMatch(/unfilteredTotalsLoading/);
    expect(SOURCE).toMatch(/unfilteredTotals\.uncategorizedCount\s*===\s*0/);
  });

  it('segmented-control tab counts come from serverTotals (filtered)', () => {
    expect(SOURCE).toMatch(/count:\s*serverTotals\.uncategorizedCount/);
    expect(SOURCE).toMatch(/count:\s*serverTotals\.pendingReviewCount/);
  });

  it('does NOT compute uncategorized count by client-side filter over sales', () => {
    expect(SOURCE).not.toMatch(/sales\.filter\(\s*sale\s*=>\s*!sale\.is_categorized\s*&&\s*!sale\.suggested_category_id\s*\)/);
    expect(SOURCE).not.toMatch(/uncategorizedSalesCount/);
  });

  it('AI card pending-review badge does NOT key off suggestedSales.length', () => {
    expect(SOURCE).not.toMatch(/suggestedSales\.length\s*>\s*0/);
  });
});
