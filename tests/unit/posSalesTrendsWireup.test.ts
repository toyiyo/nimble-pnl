import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

// Regression guard: SalesTrendsPanel must be mounted inside the "manual"
// (View Sales) tab, above the existing filter bar/list, wired to the page's
// restaurantId/startDate/endDate/timezone state, and default-expanded per
// a matchMedia('(min-width: 1024px)') check (design doc §4.2). Per the
// "read source as text" lesson for this ~30-hook page, this test never
// renders POSSales — see tests/unit/SalesTrendsPanel.test.tsx for the
// isolated, rendered panel coverage.
describe('POSSales — SalesTrendsPanel wired into the manual (View Sales) tab', () => {
  it('imports SalesTrendsPanel from the pos-sales components directory', () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*SalesTrendsPanel\s*\}\s*from\s*["']@\/components\/pos-sales\/SalesTrendsPanel["'];/,
    );
  });

  it('resolves an initial expanded state from matchMedia(min-width: 1024px)', () => {
    expect(SOURCE).toMatch(/matchMedia\(['"]\(min-width:\s*1024px\)['"]\)/);
  });

  it('renders <SalesTrendsPanel> inside the manual TabsContent, above the filter bar', () => {
    const manualTabMatch = SOURCE.match(
      /<TabsContent value="manual"[^>]*>([\s\S]*?)<TabsContent value="import"/,
    );
    expect(manualTabMatch).not.toBeNull();
    const manualTabBody = manualTabMatch![1];

    const panelIndex = manualTabBody.indexOf('<SalesTrendsPanel');
    const filterBarIndex = manualTabBody.indexOf('Apple/Notion-style filter bar');
    expect(panelIndex).toBeGreaterThan(-1);
    expect(filterBarIndex).toBeGreaterThan(-1);
    expect(panelIndex).toBeLessThan(filterBarIndex);
  });

  it('passes restaurantId, startDate, endDate, and timeZone into SalesTrendsPanel', () => {
    const panelMatch = SOURCE.match(/<SalesTrendsPanel([\s\S]*?)\/>/);
    expect(panelMatch).not.toBeNull();
    const panelProps = panelMatch![1];

    expect(panelProps).toMatch(/restaurantId=\{selectedRestaurant\?\.restaurant_id \|\| null\}/);
    expect(panelProps).toMatch(/startDate=\{startDate\}/);
    expect(panelProps).toMatch(/endDate=\{endDate\}/);
    expect(panelProps).toMatch(/timeZone=\{selectedRestaurant\?\.restaurant\?\.timezone\}/);
    expect(panelProps).toMatch(/defaultExpanded=/);
  });
});
