import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

// Regression guard: the "Uncategorized"/"Pending Review"/"Categorized" Status
// tabs must query the DB directly (useUnifiedSales) instead of only filtering
// whatever page of rows happens to already be loaded client-side. See design
// doc docs/superpowers/specs/2026-07-08-uncategorized-list-server-filter-design.md.
describe('POSSales — categorizationFilter is wired into useUnifiedSales', () => {
  it('passes categorizationFilter into the useUnifiedSales(...) options object', () => {
    const useUnifiedSalesCallMatch = SOURCE.match(
      /=\s*useUnifiedSales\(selectedRestaurant\?\.restaurant_id \|\| null,\s*\{([\s\S]*?)\}\);/,
    );
    expect(useUnifiedSalesCallMatch).not.toBeNull();
    const optionsBody = useUnifiedSalesCallMatch![1];
    expect(optionsBody).toMatch(/categorizationFilter/);
  });

  it('keeps the existing client-side categorization filter intact (redundant, not removed)', () => {
    // Design doc: client-side filter stays as a harmless redundant pass,
    // mirroring how searchTerm is both server ilike + client filter.
    expect(SOURCE).toMatch(/if \(categorizationFilter === 'uncategorized'\)/);
    expect(SOURCE).toMatch(/if \(categorizationFilter === 'categorized'\)/);
  });
});
