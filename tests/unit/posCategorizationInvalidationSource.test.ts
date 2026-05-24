import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// All three categorization mutation hooks must invalidate the
// ['unified-sales-totals', ...] query key on success — otherwise the new
// uncategorized/pending-review counts on the POS Sales page stay stale
// until the next 30s refetch.

const HOOK_FILES = [
  'src/hooks/useCategorizePosSale.tsx',
  'src/hooks/useCategorizePosSales.tsx',
  'src/hooks/useBulkPosSaleActions.tsx',
];

// Match invalidateQueries(...) whose body references the 'unified-sales-totals'
// key. Permissive about whether the key is bare, scoped by restaurantId, or
// wrapped in a conditional — all are acceptable invalidations.
const INVALIDATION_REGEX =
  /invalidateQueries\(\s*\{[\s\S]*?['"]unified-sales-totals['"][\s\S]*?\}\s*\)/;

describe('POS categorization mutations invalidate unified-sales-totals', () => {
  HOOK_FILES.forEach((relative) => {
    it(`${relative} invalidates ['unified-sales-totals'(, restaurantId)?]`, () => {
      const src = readFileSync(resolve(__dirname, '../../', relative), 'utf8');
      expect(src).toMatch(INVALIDATION_REGEX);
    });
  });
});
