import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * `src/pages/Index.tsx` is a large provider/router-dependent dashboard page
 * that isn't practically unit-rendered — see
 * `tests/unit/indexLaborCostSection.test.ts` for the established
 * source-text-assertion pattern this test follows.
 *
 * Design doc: docs/superpowers/specs/2026-09-30-runway-30-day-burn-design.md
 * Plan task 4: wire `getRunwayWindow` and `buildCashRunwayAlert` into
 * `Index.tsx`, and `getRunwayWindow` into `BankSnapshotSection.tsx`.
 */
describe('Index.tsx wires the 30-day cash runway', () => {
  const indexSource = readFileSync(
    path.resolve(__dirname, '../../src/pages/Index.tsx'),
    'utf-8'
  );

  it('calls getRunwayWindow', () => {
    expect(indexSource).toContain('getRunwayWindow(');
  });

  it('calls buildCashRunwayAlert', () => {
    expect(indexSource).toContain('buildCashRunwayAlert(');
  });

  it('does not call useLiquidityMetrics with todayStart, todayEnd', () => {
    expect(indexSource).not.toContain('useLiquidityMetrics(\n    todayStart,\n    todayEnd');
    expect(indexSource).not.toMatch(/useLiquidityMetrics\(\s*todayStart,\s*todayEnd/);
  });

  it('does not compute a daily average spending estimate', () => {
    expect(indexSource).not.toContain('dailyAvgSpending');
  });

  it('does not auto-load all bank transactions for a spending estimate', () => {
    expect(indexSource).not.toContain('autoLoadAll');
  });

  it('sets cashRunway to null while liquidityLoading is true, or when liquidityMetrics is missing', () => {
    expect(indexSource).toMatch(
      /const\s+cashRunway\s*=\s*liquidityLoading\s*\|\|\s*!liquidityMetrics\s*\?\s*null\s*:/
    );
  });

  it('does not fall back cashRunway to 0', () => {
    expect(indexSource).not.toMatch(/const\s+cashRunway\s*=[^\n]*\|\|\s*0/);
    expect(indexSource).not.toMatch(/const\s+cashRunway\s*=[^\n]*\?\?\s*0/);
  });
});

describe('BankSnapshotSection.tsx uses the shared runway window', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../../src/components/BankSnapshotSection.tsx'),
    'utf-8'
  );

  it('calls getRunwayWindow', () => {
    expect(source).toContain('getRunwayWindow(');
  });

  it('does not call subDays(today, 30)', () => {
    expect(source).not.toContain('subDays(today, 30)');
  });
});
