import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Regression guard (Codex PR #623 finding): the server-aggregated Grouped view
// is cached under the separate ['unified-sales-grouped'] key, which a prefix
// invalidation of ['unified-sales'] does NOT match. Any hook that invalidates
// unified-sales after a POS write must also invalidate the grouped key, or the
// Grouped view shows stale totals/filter membership until staleTime elapses.
const FILES = [
  'src/hooks/useUnifiedSales.tsx',
  'src/hooks/useCategorizePosSale.tsx',
  'src/hooks/useCategorizePosSales.tsx',
  'src/hooks/useBulkPosSaleActions.tsx',
  'src/hooks/useSplitTransactionHelpers.ts',
  'src/hooks/useCategorizationRulesV2.tsx',
  'src/pages/Index.tsx',
];

describe('grouped query invalidation parity', () => {
  it.each(FILES)('%s invalidates the unified-sales-grouped query key', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '../../', rel), 'utf8');
    expect(src).toMatch(/queryKey:\s*\['unified-sales-grouped'\]/);
  });
});
