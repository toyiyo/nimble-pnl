/**
 * Guards the "Read the Sales vs Break-Even chart" section of the help doc
 * against drifting from `SalesVsBreakEvenChart.tsx`'s actual behavior.
 *
 * Phase 4 Task 16 updates this doc for the clarity-pass widget changes:
 * - the click target moved from the daily P&L report to POS Sales, and bars
 *   are now keyboard-reachable (Task 14)
 * - a verdict strip (net $ + plain-language clause + period) now sits above
 *   the chart (Task 5)
 * - a visible weekday-pattern insight sentence renders under the chart when
 *   the data supports one (Task 12)
 * - today's bar renders as an in-progress/hatched bar instead of a graded
 *   above/below outcome (Task 6)
 *
 * A plain `readFileSync` scan (not `import.meta.glob`) mirrors the existing
 * `laborColorTokens.test.ts` / `salesVsBreakEvenChart.colorTokens.test.ts`
 * source-scan convention for asserting on raw file text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOC_PATH = join(
  process.cwd(),
  'src/content/help/financials-and-accounting/budget-break-even.md',
);

function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf-8');
}

describe('budget-break-even.md — Sales vs Break-Even chart section', () => {
  const doc = readDoc();
  // Scope to the actual chart section, not the whole doc — an assertion
  // that can be satisfied by unrelated text elsewhere (the hero card's
  // "Today's sales" copy, the Tips section, etc.) doesn't actually pin the
  // chart section's own wording.
  const chartSection =
    doc.split('## Read the Sales vs Break-Even chart')[1]?.split('## Tips')[0] ?? '';

  it('no longer documents the stale P&L click target', () => {
    expect(doc).not.toContain('Click any bar to view P&L for that day');
    expect(doc.toLowerCase()).not.toContain('takes you to the daily p&l report');
  });

  it('documents the full POS Sales click target and keyboard contract', () => {
    // Scoped and specific enough that removing date filtering or Space
    // activation from the doc (or the widget) would fail this test — a
    // bare "POS Sales" + "press enter" match anywhere in the doc could
    // pass even with those regressed.
    const lower = chartSection.toLowerCase();
    expect(lower).toMatch(/pos sales\*\* page filtered to that specific date/);
    expect(lower).toMatch(/pressing enter or space/);
  });

  it('describes the verdict line: net figure, plain-language clause, and period covered', () => {
    expect(chartSection).toMatch(
      /verdict strip[\s\S]*[+-]\$[\d,]+[\s\S]*(ahead of|behind|exactly at) break-even[\s\S]*complete days?/i,
    );
  });

  it('describes the weekday-pattern insight sentence', () => {
    const lower = chartSection.toLowerCase();
    expect(lower).toContain('weekday');
    // It must also be documented as conditional — absent without enough data —
    // matching deriveWeekdayPattern's null-when-insufficient-data behavior.
    expect(lower).toMatch(/only appears|does not appear|not enough|at least 7/);
  });

  it("describes today's bar as in-progress rather than a graded above/below outcome", () => {
    const lower = chartSection.toLowerCase();
    expect(lower).toContain('in progress');
    expect(lower).toMatch(/hatch|diagonal|striped/);
  });
});
