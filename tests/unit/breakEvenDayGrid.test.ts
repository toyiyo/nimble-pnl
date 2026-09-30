import { describe, it, expect } from 'vitest';
import { buildDayGridCells } from '@/lib/breakEvenDayGrid';
import type { BreakEvenData } from '@/types/operatingCosts';

type HistoryRow = BreakEvenData['history'][number];

function makeRow(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    date: '2026-09-15',
    sales: 1000,
    breakEven: 1000,
    delta: 0,
    status: 'at',
    isPartial: false,
    ...overrides,
  };
}

describe('buildDayGridCells', () => {
  it('keeps the same order as the input history', () => {
    const history = [
      makeRow({ date: '2026-09-13' }),
      makeRow({ date: '2026-09-14' }),
      makeRow({ date: '2026-09-15' }),
    ];

    const cells = buildDayGridCells(history);

    expect(cells.map((cell) => cell.date)).toEqual([
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ]);
  });

  it('returns an empty list for an empty history', () => {
    expect(buildDayGridCells([])).toEqual([]);
  });

  it('checks isPartial before status for the fill and the aria-label', () => {
    const row = makeRow({
      date: '2026-09-28',
      sales: 2000,
      status: 'below',
      isPartial: true,
    });

    const [cell] = buildDayGridCells([row]);

    expect(cell.isPartial).toBe(true);
    expect(cell.fillClass).toBe('bg-muted-foreground/30');
    expect(cell.ariaLabel).toBe('Sep 28: $2,000 sales so far');
  });

  it('builds the above-break-even aria-label with the day, sales and delta', () => {
    const row = makeRow({
      date: '2026-09-28',
      sales: 4210,
      breakEven: 3590,
      delta: 620,
      status: 'above',
      isPartial: false,
    });

    const [cell] = buildDayGridCells([row]);

    expect(cell.fillClass).toBe('bg-foreground/80');
    expect(cell.ariaLabel).toBe(
      'Sep 28: $4,210 sales, $620 above break-even'
    );
  });

  it('builds the below-break-even aria-label with the day, sales and delta', () => {
    const row = makeRow({
      date: '2026-09-05',
      sales: 1500,
      breakEven: 1800,
      delta: -300,
      status: 'below',
      isPartial: false,
    });

    const [cell] = buildDayGridCells([row]);

    expect(cell.fillClass).toBe('bg-destructive/60');
    expect(cell.ariaLabel).toBe(
      'Sep 5: $1,500 sales, $300 below break-even'
    );
  });

  it('builds the at-break-even aria-label with the day and sales', () => {
    const row = makeRow({
      date: '2026-09-10',
      sales: 1000,
      breakEven: 1000,
      delta: 0,
      status: 'at',
      isPartial: false,
    });

    const [cell] = buildDayGridCells([row]);

    expect(cell.fillClass).toBe('bg-muted-foreground/50');
    expect(cell.ariaLabel).toBe('Sep 10: $1,000 sales, at break-even');
  });

  it('reads the day number from the date string, not the local timezone', () => {
    const row = makeRow({ date: '2026-01-01' });

    const [cell] = buildDayGridCells([row]);

    expect(cell.dayNumber).toBe(1);
  });
});
