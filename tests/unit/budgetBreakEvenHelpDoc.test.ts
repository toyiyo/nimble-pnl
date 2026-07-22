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

  it('no longer documents the stale P&L click target', () => {
    expect(doc).not.toContain('Click any bar to view P&L for that day');
    expect(doc.toLowerCase()).not.toContain('takes you to the daily p&l report');
  });

  it('documents the POS Sales click target and keyboard access', () => {
    expect(doc).toMatch(/POS Sales/);
    expect(doc.toLowerCase()).toContain('press enter');
  });

  it('describes the verdict line: net figure, plain-language clause, and period covered', () => {
    const lower = doc.toLowerCase();
    expect(lower).toMatch(/ahead of break-even|behind break-even|at break-even/);
    expect(lower).toContain('complete day');
  });

  it('describes the weekday-pattern insight sentence', () => {
    const lower = doc.toLowerCase();
    expect(lower).toContain('weekday');
    // It must also be documented as conditional — absent without enough data —
    // matching deriveWeekdayPattern's null-when-insufficient-data behavior.
    expect(lower).toMatch(/only appears|does not appear|not enough|at least 7/);
  });

  it("describes today's bar as in-progress rather than a graded above/below outcome", () => {
    const lower = doc.toLowerCase();
    expect(lower).toContain('in progress');
    expect(lower).toMatch(/hatch|diagonal|striped/);
  });
});
