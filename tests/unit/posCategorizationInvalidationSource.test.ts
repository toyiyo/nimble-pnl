import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// All three categorization mutation hooks must invalidate the
// ['unified-sales-totals'] query key on success — otherwise the new
// uncategorized/pending-review counts on the POS Sales page (sig:539980c1fe88)
// stay stale until the next 30s refetch.

const HOOK_FILES = [
  'src/hooks/useCategorizePosSale.tsx',
  'src/hooks/useCategorizePosSales.tsx',
  'src/hooks/useBulkPosSaleActions.tsx',
];

const INVALIDATION_REGEX =
  /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]unified-sales-totals['"]\s*\]\s*\}\)/;

describe('POS categorization mutations invalidate unified-sales-totals', () => {
  HOOK_FILES.forEach((relative) => {
    it(`${relative} invalidates ['unified-sales-totals']`, () => {
      const src = readFileSync(resolve(__dirname, '../../', relative), 'utf8');
      expect(src).toMatch(INVALIDATION_REGEX);
    });
  });
});
