import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * `src/pages/Index.tsx` is a large provider/router-dependent dashboard page
 * (Auth, Restaurant context, dozens of data hooks) that isn't practically
 * unit-rendered — see `tests/unit/appLaborRoute.test.ts` for the established
 * source-text-assertion pattern this test follows.
 *
 * Design doc: docs/superpowers/specs/2026-07-20-labor-financial-view-design.md
 * Plan task F2: mount a collapsible "Labor cost" section on Index.tsx with
 * `LaborPnlCard`, defaulting closed, in the financial cluster near
 * `SalesVsBreakEvenChart` / Performance Overview — NOT adjacent to the
 * existing scheduling `LaborEfficiencyCard` section.
 */
describe('Index.tsx mounts the "Labor cost" collapsible section', () => {
  const indexSource = readFileSync(
    path.resolve(__dirname, '../../src/pages/Index.tsx'),
    'utf-8'
  );

  it('imports LaborPnlCard', () => {
    expect(indexSource).toMatch(
      /import\s+\{\s*LaborPnlCard\s*\}\s+from\s+["']@\/components\/dashboard\/LaborPnlCard["'];/
    );
  });

  it('declares laborCostOpen collapsible state, defaulting closed', () => {
    expect(indexSource).toMatch(
      /const\s+\[laborCostOpen,\s*setLaborCostOpen\]\s*=\s*useState\(false\);/
    );
  });

  it('renders a "Labor cost" heading with the design-specified subtitle', () => {
    expect(indexSource).toContain(
      '<h2 className="text-[17px] font-semibold text-foreground">Labor cost</h2>'
    );
    expect(indexSource).toContain('What your team costs against sales.');
  });

  it('mounts LaborPnlCard scoped to the selected restaurant inside the collapsible', () => {
    expect(indexSource).toMatch(
      /<LaborPnlCard\s+restaurantId=\{selectedRestaurant\.restaurant_id\}\s*\/>/
    );
  });

  it('wires the section to a Collapsible using laborCostOpen/setLaborCostOpen', () => {
    expect(indexSource).toMatch(
      /<Collapsible\s+open=\{laborCostOpen\}\s+onOpenChange=\{setLaborCostOpen\}>/
    );
  });

  it('is placed in the financial cluster after SalesVsBreakEvenChart, not adjacent to the scheduling Labor Efficiency section', () => {
    const breakEvenChartIndex = indexSource.indexOf('<SalesVsBreakEvenChart');
    const laborCostSectionIndex = indexSource.indexOf(
      'open={laborCostOpen} onOpenChange={setLaborCostOpen}'
    );
    const laborEfficiencySectionIndex = indexSource.indexOf(
      '{/* Labor Efficiency - Collapsible */}'
    );

    expect(breakEvenChartIndex).toBeGreaterThan(-1);
    expect(laborCostSectionIndex).toBeGreaterThan(-1);
    expect(laborEfficiencySectionIndex).toBeGreaterThan(-1);

    // Financial cluster: mounted after the break-even chart...
    expect(laborCostSectionIndex).toBeGreaterThan(breakEvenChartIndex);
    // ...and not adjacent to (i.e. clearly separated from) the scheduling
    // Labor Efficiency section further down the page.
    expect(laborEfficiencySectionIndex).toBeGreaterThan(laborCostSectionIndex);
    expect(laborEfficiencySectionIndex - laborCostSectionIndex).toBeGreaterThan(2000);
  });
});
