import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Any file that queries a high-volume table must import a paged fetch
// helper, or sit in the allowlist below. The allowlist may only SHRINK:
// remove an entry when its file converts to fetchAllRows.
const HIGH_VOLUME_TABLES = [
  'unified_sales',
  'inventory_transactions',
  'time_punches',
  'bank_transactions',
  'pending_outflows',
];

const FROM_RE = new RegExp(
  `\\.from\\(\\s*['"](?:${HIGH_VOLUME_TABLES.join('|')})['"]`
);
const PAGED_IMPORT_RE = /@\/(?:utils\/fetchAllRows|services\/cogsFetch)/;

const ALLOWLIST = new Set([
  'src/components/POSSalesImportReview.tsx',
  'src/components/ReceiptMappingReview.tsx',
  'src/components/ReconciliationItemDetail.tsx',
  'src/components/VarianceAnalysis.tsx',
  'src/components/financial-statements/BalanceSheet.tsx',
  'src/hooks/adapters/useCloverSalesAdapter.tsx',
  'src/hooks/adapters/useRevelSalesAdapter.tsx',
  'src/hooks/adapters/useShift4SalesAdapter.tsx',
  'src/hooks/adapters/useSquareSalesAdapter.tsx',
  'src/hooks/adapters/useToastSalesAdapter.tsx',
  'src/hooks/useAlertsIntelligence.tsx',
  'src/hooks/useAttachments.ts',
  'src/hooks/useAutomaticInventoryDeduction.tsx',
  'src/hooks/useBankReconciliation.tsx',
  'src/hooks/useBankStatementImport.tsx',
  'src/hooks/useBankTransactions.tsx',
  'src/hooks/useBreakEvenAnalysis.tsx',
  'src/hooks/useBulkPosSaleActions.tsx',
  'src/hooks/useBulkTransactionActions.tsx',
  'src/hooks/useCalculateOpeningBalance.tsx',
  'src/hooks/useCashFlowInsights.tsx',
  'src/hooks/useConsumptionIntelligence.tsx',
  'src/hooks/useExpenseHealth.tsx',
  'src/hooks/useHourlySalesPattern.ts',
  'src/hooks/useInventoryAudit.tsx',
  'src/hooks/useInventoryDeduction.tsx',
  'src/hooks/useInventoryMetrics.tsx',
  'src/hooks/useInventoryPurchases.tsx',
  'src/hooks/useLaborCostsFromTransactions.tsx',
  'src/hooks/useLiquidityMetrics.tsx',
  'src/hooks/usePendingOutflows.tsx',
  'src/hooks/usePredictableExpenses.tsx',
  'src/hooks/usePredictiveMetrics.tsx',
  'src/hooks/useReceiptImport.tsx',
  'src/hooks/useRecipeIntelligence.tsx',
  'src/hooks/useReconcileTransactions.tsx',
  'src/hooks/useReconciliation.tsx',
  'src/hooks/useRevenueBreakdown.tsx',
  'src/hooks/useRevenueHealth.tsx',
  'src/hooks/useSplhData.ts',
  'src/hooks/useSplitPosSale.tsx',
  'src/hooks/useSupplierPriceAnalytics.tsx',
  'src/hooks/useTopVendors.tsx',
  'src/hooks/useUncategorizedTotals.tsx',
  'src/hooks/useUnifiedSales.tsx',
  'src/hooks/useWeekStaffingSuggestions.ts',
  'src/lib/expenseDataFetcher.ts',
  'src/pages/Banking.tsx',
  'src/services/inventoryTransactions.service.ts',
  'src/services/recipeAnalytics.service.ts',
  'src/utils/offlineQueue.ts',
]);

const repoRoot = join(__dirname, '..', '..');
const srcRoot = join(repoRoot, 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('high-volume query guard', () => {
  it('finds no unpaged high-volume queries outside the allowlist', () => {
    const offenders: string[] = [];
    for (const full of walk(srcRoot)) {
      const repoPath = relative(repoRoot, full);
      if (ALLOWLIST.has(repoPath)) continue;
      const content = readFileSync(full, 'utf8');
      if (FROM_RE.test(content) && !PAGED_IMPORT_RE.test(content)) {
        offenders.push(repoPath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist shrink-only', () => {
    for (const repoPath of ALLOWLIST) {
      const full = join(repoRoot, repoPath);
      expect(
        existsSync(full),
        `${repoPath} no longer exists — remove it from ALLOWLIST`
      ).toBe(true);
      const content = readFileSync(full, 'utf8');
      expect(
        FROM_RE.test(content),
        `${repoPath} no longer queries a high-volume table — remove it from ALLOWLIST`
      ).toBe(true);
      expect(
        PAGED_IMPORT_RE.test(content),
        `${repoPath} now pages with fetchAllRows — remove it from ALLOWLIST`
      ).toBe(false);
    }
  });
});
