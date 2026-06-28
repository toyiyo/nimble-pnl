/**
 * focusReportParser.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusReportParser.ts
 *
 * Parses Focus POS SSRS Revenue Center HTML4.0 report → structured day object.
 * Uses a SYNTHETIC fixture (tests/fixtures/focus-revenue-center-sample.html)
 * — no real PII (lesson 2026-06-22).
 *
 * Coverage:
 *  - Happy path: full fixture → correct items, totals, payments, order types
 *  - Items: name, units, sales, revenueCenter per item
 *  - Totals: netSales, totalTax, subtotalDiscounts, retainedTips, refunds, totalSales
 *  - Payments: tender + amount for each payment row
 *  - Order types: type name + amount
 *  - Business date is passed through unmodified
 *  - Empty report (no items + zero totals) → {ok:false, reason:'empty'}
 *  - Garbage HTML → {ok:false, reason:'parse_error'}
 *  - Design ref: §8 (focusReportParser), §16 S9 (discriminated result union)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRevenueCenterReport,
  type ParseResult,
  type ParsedDay,
} from '../../supabase/functions/_shared/focusReportParser';

// ── Load the synthetic fixture ────────────────────────────────────────────────

const FIXTURE_PATH = resolve(
  __dirname,
  '../fixtures/focus-revenue-center-sample.html',
);

const SAMPLE_HTML = readFileSync(FIXTURE_PATH, 'utf-8');

const BUSINESS_DATE = '2026-06-27';

// ── Helper ────────────────────────────────────────────────────────────────────

function parseOk(html: string, date = BUSINESS_DATE): ParsedDay {
  const result = parseRevenueCenterReport(html, date);
  if (!result.ok) {
    throw new Error(
      `Expected ok:true but got ok:false reason="${result.reason}"`,
    );
  }
  return result.data;
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('parseRevenueCenterReport — happy path (synthetic fixture)', () => {
  it('returns ok:true for the sample fixture', () => {
    const result = parseRevenueCenterReport(SAMPLE_HTML, BUSINESS_DATE);
    expect(result.ok).toBe(true);
  });

  it('passes through the businessDate unchanged', () => {
    const data = parseOk(SAMPLE_HTML);
    expect(data.businessDate).toBe(BUSINESS_DATE);
  });

  // ── Items ──────────────────────────────────────────────────────────────────

  describe('items', () => {
    it('parses the correct number of items (fixture has 8 items across 2 revenue centers)', () => {
      const data = parseOk(SAMPLE_HTML);
      // Dine-In: Scoop Single, Scoop Double, Waffle Cone, Sundae Classic, Hot Fudge Topping (5)
      // Drive-Through: Shake Vanilla, Shake Chocolate, Cup Small (3)
      expect(data.items).toHaveLength(8);
    });

    it('parses item name, units, and sales for first item (Dine-In / Scoop Single)', () => {
      const data = parseOk(SAMPLE_HTML);
      const scoopSingle = data.items.find((i) => i.name === 'Scoop Single');
      expect(scoopSingle).toBeDefined();
      expect(scoopSingle!.units).toBe(20);
      expect(scoopSingle!.sales).toBeCloseTo(59.80, 2);
      expect(scoopSingle!.revenueCenter).toBe('Dine-In');
    });

    it('parses item name, units, and sales for an item in the second revenue center (Drive-Through)', () => {
      const data = parseOk(SAMPLE_HTML);
      const shakeVanilla = data.items.find((i) => i.name === 'Shake Vanilla');
      expect(shakeVanilla).toBeDefined();
      expect(shakeVanilla!.units).toBe(12);
      expect(shakeVanilla!.sales).toBeCloseTo(65.40, 2);
      expect(shakeVanilla!.revenueCenter).toBe('Drive-Through');
    });

    it('assigns each item to the correct revenueCenter', () => {
      const data = parseOk(SAMPLE_HTML);
      const dineInItems = data.items.filter((i) => i.revenueCenter === 'Dine-In');
      const driveItems = data.items.filter((i) => i.revenueCenter === 'Drive-Through');
      expect(dineInItems).toHaveLength(5);
      expect(driveItems).toHaveLength(3);
    });

    it('parses all 5 Dine-In items with correct sales amounts', () => {
      const data = parseOk(SAMPLE_HTML);
      const dineIn = data.items.filter((i) => i.revenueCenter === 'Dine-In');
      // Amounts from fixture: 59.80, 67.50, 28.00, 37.50, 6.00
      const salesSet = dineIn.map((i) => i.sales).sort((a, b) => a - b);
      expect(salesSet).toEqual([6.00, 28.00, 37.50, 59.80, 67.50]);
    });

    it('parses all 3 Drive-Through items with correct sales amounts', () => {
      const data = parseOk(SAMPLE_HTML);
      const drive = data.items.filter((i) => i.revenueCenter === 'Drive-Through');
      const salesSet = drive.map((i) => i.sales).sort((a, b) => a - b);
      expect(salesSet).toEqual([44.00, 49.05, 65.40]);
    });
  });

  // ── Totals ─────────────────────────────────────────────────────────────────

  describe('totals', () => {
    it('parses netSales from the "Net Sales" row', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.netSales).toBeCloseTo(340.00, 2);
    });

    it('parses totalTax from the "Inclusive Tax" row', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.totalTax).toBeCloseTo(28.00, 2);
    });

    it('parses subtotalDiscounts from the "Subtotal Discounts" row', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.subtotalDiscounts).toBeCloseTo(17.25, 2);
    });

    it('parses retainedTips from the "Retained Tips" row', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.retainedTips).toBeCloseTo(45.50, 2);
    });

    it('parses refunds from the "Refunds" row (zero in fixture)', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.refunds).toBeCloseTo(0.00, 2);
    });

    it('parses totalSales from the "Total Sales" row', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.totals.totalSales).toBeCloseTo(368.00, 2);
    });
  });

  // ── Payments ───────────────────────────────────────────────────────────────

  describe('payments', () => {
    it('parses 4 payment tender rows', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.payments).toHaveLength(4);
    });

    it('parses Cash tender with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const cash = data.payments.find((p) => p.tender === 'Cash');
      expect(cash).toBeDefined();
      expect(cash!.amount).toBeCloseTo(95.20, 2);
    });

    it('parses Visa tender with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const visa = data.payments.find((p) => p.tender === 'Visa');
      expect(visa).toBeDefined();
      expect(visa!.amount).toBeCloseTo(152.50, 2);
    });

    it('parses Mastercard tender with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const mc = data.payments.find((p) => p.tender === 'Mastercard');
      expect(mc).toBeDefined();
      expect(mc!.amount).toBeCloseTo(80.30, 2);
    });

    it('parses Gift Card tender with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const gc = data.payments.find((p) => p.tender === 'Gift Card');
      expect(gc).toBeDefined();
      expect(gc!.amount).toBeCloseTo(40.00, 2);
    });
  });

  // ── Order types ────────────────────────────────────────────────────────────

  describe('orderTypes', () => {
    it('parses 3 order type rows', () => {
      const data = parseOk(SAMPLE_HTML);
      expect(data.orderTypes).toHaveLength(3);
    });

    it('parses Eat In order type with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const eatIn = data.orderTypes.find((o) => o.type === 'Eat In');
      expect(eatIn).toBeDefined();
      expect(eatIn!.amount).toBeCloseTo(198.80, 2);
    });

    it('parses Take Out order type with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const takeOut = data.orderTypes.find((o) => o.type === 'Take Out');
      expect(takeOut).toBeDefined();
      expect(takeOut!.amount).toBeCloseTo(114.60, 2);
    });

    it('parses Drive-Through order type with correct amount', () => {
      const data = parseOk(SAMPLE_HTML);
      const dt = data.orderTypes.find((o) => o.type === 'Drive-Through');
      expect(dt).toBeDefined();
      expect(dt!.amount).toBeCloseTo(54.60, 2);
    });
  });
});

// ── Error / edge cases ────────────────────────────────────────────────────────

describe('parseRevenueCenterReport — error cases', () => {
  it('returns {ok:false, reason:"parse_error"} for completely garbage input', () => {
    const result = parseRevenueCenterReport('not html at all !!!', BUSINESS_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse_error');
    }
  });

  it('returns {ok:false, reason:"parse_error"} for an empty string', () => {
    const result = parseRevenueCenterReport('', BUSINESS_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse_error');
    }
  });

  it('returns {ok:false, reason:"empty"} for a report with no items and zero totals', () => {
    // A structurally valid report page with the Revenue Center header but no item rows
    // and zero-value summary rows — represents a new or closed store with no sales
    const emptyReport = `
      <html><body>
      <table class="t">
        <tr><td colspan="3"><table border="0" width="100%">
          <tr><td>Revenue Center</td><td>Units Sold</td><td>Sales</td></tr>
          <tr><td>Net Sales</td><td></td><td>$0.00</td></tr>
          <tr><td>Inclusive Tax</td><td></td><td>$0.00</td></tr>
          <tr><td>Subtotal Discounts</td><td></td><td>$0.00</td></tr>
          <tr><td>Retained Tips</td><td></td><td>$0.00</td></tr>
          <tr><td>Refunds</td><td></td><td>$0.00</td></tr>
          <tr><td>Total Sales</td><td></td><td>$0.00</td></tr>
          <tr class="th"><td>Payments By Tender</td><td>Count</td><td>Amount</td></tr>
          <tr class="th"><td>Sales By Order Type</td><td>Count</td><td>Amount</td></tr>
        </table></td></tr>
      </table>
      </body></html>
    `;
    const result = parseRevenueCenterReport(emptyReport, BUSINESS_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty');
    }
  });

  it('returns {ok:false, reason:"parse_error"} for HTML with no recognizable report table', () => {
    const noTable = `
      <html><body><h1>Error: Report not found</h1><p>Something went wrong.</p></body></html>
    `;
    const result = parseRevenueCenterReport(noTable, BUSINESS_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse_error');
    }
  });

  it('discriminated union: ok:true branch has data property', () => {
    const result = parseRevenueCenterReport(SAMPLE_HTML, BUSINESS_DATE);
    // TypeScript narrowing check — at runtime, confirm shape
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result).toHaveProperty('data');
      expect(result).not.toHaveProperty('reason');
    }
  });

  it('discriminated union: ok:false branch has reason property', () => {
    const result = parseRevenueCenterReport('', BUSINESS_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result).toHaveProperty('reason');
      expect(result).not.toHaveProperty('data');
    }
  });
});
