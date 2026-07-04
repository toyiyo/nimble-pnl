import { describe, it, expect } from 'vitest';
import xml from '../fixtures/focus-datafeed-sample.xml?raw';
import { parseFocusDatafeed } from '../../supabase/functions/_shared/focusDatafeedParser.ts';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a document with a large dummy config/menu section that wraps the
 * <Checks> block — simulating the real 4.5 MB datafeed layout where ~90 % of
 * the bytes are non-check data that should be skipped by the parser.
 */
function wrapWithLargeConfig(checksXml: string, size = 50_000): string {
  const padding = 'X'.repeat(size);
  return (
    `<DailyData>` +
    `<Configuration>${padding}</Configuration>` +
    `<MenuItems>${padding}</MenuItems>` +
    `<Checks>${checksXml}</Checks>` +
    `<Employees>${padding}</Employees>` +
    `</DailyData>`
  );
}

describe('parseFocusDatafeed', () => {
  it('parses both checks from the datafeed', () => {
    const feed = parseFocusDatafeed(xml);
    expect(feed.checks).toHaveLength(2);
    expect(feed.checks.map((c) => c.checkId).sort()).toEqual(['1', '2']);
  });

  it('extracts the check header (id, total, order type, open time)', () => {
    const c = parseFocusDatafeed(xml).checks.find((c) => c.checkId === '1')!;
    expect(c.total).toBe(48.43);
    expect(c.orderTypeId).toBe('16');
    expect(c.openedAt).toContain('06/27/2026');
  });

  it('extracts priced line items and their category', () => {
    const c = parseFocusDatafeed(xml).checks.find((c) => c.checkId === '1')!;
    const priced = c.items.filter((i) => i.price != null);
    expect(priced.length).toBe(3);
    const cake = priced.find((i) => i.name === 'Lg Rnd Custom');
    expect(cake).toBeTruthy();
    expect(cake!.price).toBe(39.99);
    expect(cake!.reportGroupId).toBe('22');
    expect(cake!.recordNumber).toBe('214');
  });

  it('flags kitchen-comment lines so the sync can skip them (PII)', () => {
    const c = parseFocusDatafeed(xml).checks.find((c) => c.checkId === '1')!;
    expect(c.items.some((i) => i.isKitchenComment)).toBe(true);
    // kitchen comments are never priced sale items
    expect(c.items.filter((i) => i.isKitchenComment).every((i) => i.price == null)).toBe(true);
  });

  it('extracts payments with amount and masked card last-4', () => {
    const c = parseFocusDatafeed(xml).checks.find((c) => c.checkId === '1')!;
    expect(c.payments).toHaveLength(1);
    expect(c.payments[0]).toMatchObject({ name: 'Online Ordering', amount: 48.43 });
    expect(c.payments[0].cardLast4).toBe('0000');
  });

  it('parses a second check incl. a gift-card payment', () => {
    const c = parseFocusDatafeed(xml).checks.find((c) => c.checkId === '2')!;
    expect(c.total).toBe(4.31);
    expect(c.payments[0]).toMatchObject({ name: 'Redeem Gift Crd', amount: 4.31 });
    expect(c.items.filter((i) => i.price != null).some((i) => i.price === 6.99)).toBe(true);
  });

  it('returns numeric amounts (not strings)', () => {
    const c = parseFocusDatafeed(xml).checks[0];
    expect(typeof c.total).toBe('number');
    expect(typeof c.payments[0].amount).toBe('number');
  });

  it('extracts deleted check ids from DeleteRecord', () => {
    const x =
      '<DailyData><Checks><DeleteRecord><ID>7</ID></DeleteRecord>' +
      '<Check><CheckRecord><ID>3</ID><Total>1.00</Total></CheckRecord></Check></Checks></DailyData>';
    const f = parseFocusDatafeed(x);
    expect(f.deletedCheckIds).toContain('7');
    expect(f.checks).toHaveLength(1);
    expect(f.checks[0].checkId).toBe('3');
  });

  it('handles an empty datafeed without throwing', () => {
    expect(parseFocusDatafeed('<DailyData><Checks></Checks></DailyData>').checks).toEqual([]);
    expect(parseFocusDatafeed('<DailyData></DailyData>').checks).toEqual([]);
  });

  // ── CPU fix: pre-extraction of <Checks> block ──────────────────────────────

  it('parses identically when a large config section surrounds the <Checks> block (CPU-fix pre-extraction)', () => {
    // Extract just the <Checks>...</Checks> content from the fixture to build the wrapped doc.
    const checksStart = xml.indexOf('<Checks>');
    const checksEnd = xml.indexOf('</Checks>') + '</Checks>'.length;
    const checksBlockContent = xml.slice(checksStart + '<Checks>'.length, checksEnd - '</Checks>'.length);

    const wrapped = wrapWithLargeConfig(checksBlockContent);

    const fromFixture = parseFocusDatafeed(xml);
    const fromWrapped = parseFocusDatafeed(wrapped);

    // Both documents must produce identical check counts, ids, and totals.
    expect(fromWrapped.checks).toHaveLength(fromFixture.checks.length);
    expect(fromWrapped.checks.map((c) => c.checkId).sort()).toEqual(
      fromFixture.checks.map((c) => c.checkId).sort(),
    );
    for (const check of fromFixture.checks) {
      const wrapped = fromWrapped.checks.find((c) => c.checkId === check.checkId)!;
      expect(wrapped).toBeTruthy();
      expect(wrapped.total).toBe(check.total);
      expect(wrapped.items.length).toBe(check.items.length);
      expect(wrapped.payments.length).toBe(check.payments.length);
    }
    expect(fromWrapped.deletedCheckIds).toEqual(fromFixture.deletedCheckIds);
  });

  it('returns empty result without throwing for a config-only feed with no <Checks> block (CPU-fix early-exit)', () => {
    // A datafeed that contains only configuration/menu data and no <Checks> section.
    const configOnlyXml =
      '<DailyData><Configuration><Item><ID>1</ID><Name>Espresso</Name></Item></Configuration>' +
      '<MenuItems><Item><ID>2</ID></Item></MenuItems></DailyData>';

    const result = parseFocusDatafeed(configOnlyXml);
    expect(result.checks).toEqual([]);
    expect(result.deletedCheckIds).toEqual([]);
  });
});
