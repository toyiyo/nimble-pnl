import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * `src/App.tsx` is a large provider/router tree (Auth, Restaurant context,
 * collaborator role gating, etc.) that isn't practically unit-rendered —
 * see the existing `appNoVercelAnalytics.test.ts` for the established
 * source-text-assertion pattern this test follows.
 *
 * Design doc: docs/superpowers/specs/2026-07-20-labor-financial-view-design.md
 * Plan task F1: add `/labor` (ProtectedRoute, eager import beside `/payroll`).
 */
describe('App.tsx registers the /labor route', () => {
  const appSource = readFileSync(
    path.resolve(__dirname, '../../src/App.tsx'),
    'utf-8'
  );

  it('eagerly imports the Labor page component', () => {
    expect(appSource).toMatch(
      /import\s+Labor\s+from\s+["']\.\/pages\/Labor["'];/
    );
  });

  it('imports Labor beside the Payroll import', () => {
    const payrollImportIndex = appSource.indexOf(
      'import Payroll from "./pages/Payroll";'
    );
    const laborImportIndex = appSource.indexOf(
      'import Labor from "./pages/Labor";'
    );
    expect(payrollImportIndex).toBeGreaterThan(-1);
    expect(laborImportIndex).toBeGreaterThan(-1);
    // "beside" = the two imports are adjacent lines (no other import between)
    const between = appSource.slice(
      Math.min(payrollImportIndex, laborImportIndex),
      Math.max(payrollImportIndex, laborImportIndex)
    );
    expect(between.trim().split('\n').filter(Boolean).length).toBe(1);
  });

  it('registers a /labor route wrapped in ProtectedRoute rendering <Labor />', () => {
    expect(appSource).toMatch(
      /<Route\s+path="\/labor"\s+element=\{<ProtectedRoute><Labor\s*\/><\/ProtectedRoute>\}\s*\/>/
    );
  });
});
