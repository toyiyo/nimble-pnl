import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

// Regression guard: when a Status tab (Uncategorized/Pending Review/Categorized)
// legitimately returns 0 rows, that is a success state (everything reviewed),
// not a "loosen your filters" state. And the results header should name the
// active status so it's clear the count is scoped to that tab. See design doc
// docs/superpowers/specs/2026-07-08-uncategorized-list-server-filter-design.md.
describe('POSSales — tab-aware empty state + results header', () => {
  it('shows tab-specific empty-state sub-copy when a Status tab is active and no search term', () => {
    // Sub-copy is per-tab: an empty "categorized" tab means nothing categorized
    // yet (NOT "everything reviewed"), so the copy must differ by tab.
    expect(SOURCE).toMatch(/Everything in this date range has been reviewed\./);
    expect(SOURCE).toMatch(/Nothing has been categorized in this date range yet\./);
    expect(SOURCE).toMatch(/CATEGORIZATION_EMPTY_SUBCOPY\[categorizationFilter\]/);
    // The success-state heading should be conditioned on categorizationFilter,
    // not always "No sales found".
    expect(SOURCE).toMatch(/No \{CATEGORIZATION_FILTER_LABELS\[categorizationFilter\]\} sales/);
  });

  it('still shows the generic "no sales found" copy when categorizationFilter is "all"', () => {
    expect(SOURCE).toMatch(/No sales found/);
    expect(SOURCE).toMatch(/Try adjusting your filters or date range\./);
  });

  it('conditions the empty-state branch on an active Status tab with no other narrowing filter', () => {
    // Must also require recipeFilter === 'all' and no search term, so the
    // reassurance copy isn't shown when a different filter caused the 0 rows.
    expect(SOURCE).toMatch(/categorizationFilter !== 'all' && !searchTerm && recipeFilter === 'all'/);
  });

  it('includes the active status label in the results header count when a tab is active', () => {
    // e.g. "203 uncategorized sales" — the header text should reference the
    // active tab's label when categorizationFilter !== 'all'.
    const markerIndex = SOURCE.indexOf('Results header bar');
    expect(markerIndex).toBeGreaterThan(-1);
    const resultsHeaderSection = SOURCE.slice(markerIndex, markerIndex + 1200);
    expect(resultsHeaderSection).toMatch(/categorizationFilter !== 'all'/);
  });
});
