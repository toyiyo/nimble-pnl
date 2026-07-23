import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

describe('POSSales — grouped view virtualization + own three-state', () => {
  it('sizes grouped grid columns responsively via a dedicated hook', () => {
    expect(SOURCE).toContain('useResponsiveColumns');
  });

  it('virtualizes the grouped grid with its own virtualizer instance', () => {
    expect(SOURCE).toContain('groupedVirtualizer');
    expect(SOURCE).toContain('groupedVirtualizer.getVirtualItems()');
    expect(SOURCE).toContain('groupedVirtualizer.getTotalSize()');
  });

  it('computes max revenue once via reduce, not per-card Math.max(...spread)', () => {
    expect(SOURCE).toContain('groupedMaxRevenue');
    expect(SOURCE).not.toMatch(/Math\.max\(\.\.\.groupedSales/);
  });

  it('grouped view renders its own loading and error states', () => {
    expect(SOURCE).toMatch(/groupedLoading\s*\?/);
    expect(SOURCE).toMatch(/groupedError\s*\?/);
  });

  it('the sales-list loading guard is scoped to the sales view (does not mask grouped view)', () => {
    expect(SOURCE).toMatch(/selectedView === ['"]sales['"] && loading/);
  });

  it('grouped cards still use stable item_name keys (not array index)', () => {
    expect(SOURCE).toMatch(/key=\{item\.item_name\}/);
  });
});
