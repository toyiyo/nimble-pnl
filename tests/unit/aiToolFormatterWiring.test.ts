import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getTools } from '../../supabase/functions/_shared/tools-registry';

// ai-execute-tool/index.ts has Deno URL imports, so Vitest cannot import it.
// These source checks pin that it uses the tested pure formatters.
const src = readFileSync(
  resolve(__dirname, '../../supabase/functions/ai-execute-tool/index.ts'),
  'utf8',
);

describe('ai-execute-tool uses aiToolFormatters', () => {
  it.each([
    'POS_SALE_PREVIEW_COLUMNS',
    'mapTopSoldItems',
    'buildCashFlowSummary',
    'computeCashCoverage',
    'incomeStatementBasis',
    'monthlyPnlBasis',
  ])('imports and calls %s', (name) => {
    expect(src).toMatch(new RegExp(`import[^;]*\\b${name}\\b[^;]*from ['"]\\.\\./_shared/aiToolFormatters\\.ts['"]`));
    expect(src.split(name).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('has no _7d cash-flow keys (D4)', () => {
    expect(src).not.toMatch(/_7d\b/);
  });

});

describe('P&L tool descriptions point the model at basis (D6)', () => {
  it.each(['get_financial_statement', 'generate_report'])('%s mentions basis', (name) => {
    const def = getTools('rest-1', 'owner').find((t) => t.name === name);
    expect(def?.description).toMatch(/\bbasis\b/);
  });
});
