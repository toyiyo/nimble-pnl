/**
 * focusReportParser.ts
 *
 * Parses a Focus POS SSRS Revenue Center HTML4.0 report into a structured
 * daily summary. This is the **single HTML-mapping module** — all field
 * access is isolated here.
 *
 * Design references:
 *  - §8 (_shared modules, `focusReportParser.ts`)
 *  - §16 S9 (discriminated result union: {ok:true,data} | {ok:false,reason})
 *
 * ASSUMED MARKUP (see also tests/fixtures/focus-revenue-center-sample.html):
 *
 * The SSRS HTML4.0 renderer produces a top-level <table> that contains the
 * report as a nested inner <table>. Rows follow this structure:
 *
 *  1. Header rows (store name, date range) — skipped.
 *
 *  2. Column-header row: first cell text ≈ "Revenue Center" (case-insensitive,
 *     trimmed). Signals the start of the items section.
 *
 *  3. ITEM ROWS: Each <tr> with a non-empty col[0], non-empty col[2] (units in
 *     col[1], sales in col[2]) belongs to the current revenue center.
 *     A new revenue center section is introduced by a row where col[1] AND col[2]
 *     are both empty/whitespace — that row's col[0] is the revenue center name.
 *     Items end when col[0] matches a known summary label.
 *
 *  4. SUMMARY ROWS — identified by label in col[0] (case-insensitive, trimmed):
 *       "Net Sales"          → totals.netSales
 *       "Inclusive Tax"      → totals.totalTax
 *       "Subtotal Discounts" → totals.subtotalDiscounts
 *       "Retained Tips"      → totals.retainedTips
 *       "Refunds"            → totals.refunds
 *       "Total Sales"        → totals.totalSales
 *     Amount is in col[2].
 *
 *  5. PAYMENTS SECTION — starts after a row whose col[0] trimmed text matches
 *     /payments by tender/i. Each subsequent data row: col[0]=tender, col[2]=amount.
 *     Ends at an ORDER TYPES header row or end of table.
 *
 *  6. ORDER TYPES SECTION — starts after a row matching /sales by order type/i.
 *     Each subsequent data row: col[0]=type name, col[2]=amount.
 *
 * Numeric values: cleaned with parseFloat(str.replace(/[$,\s]/g, '')).
 * Empty/whitespace cell ⇒ 0.
 *
 * Parser uses label-based anchoring (not positional row index) for robustness
 * across minor layout changes.
 *
 * The discriminated result:
 *   {ok: true,  data: ParsedDay}        — successful parse
 *   {ok: false, reason: 'empty'}        — valid structure but no items + zero totals
 *                                          (new/closed store; treat as connected)
 *   {ok: false, reason: 'parse_error'}  — no recognizable report structure found
 *
 * DOMParser dependency:
 *   In browser/jsdom (tests) this module uses globalThis.DOMParser.
 *   In Deno (production edge functions) the caller must inject a DOMParser-
 *   compatible implementation (e.g. from deno_dom). The injectable overload
 *   `parseRevenueCenterReport(html, date, domParser)` accepts it explicitly.
 *   The default (2-arg) overload resolves `globalThis.DOMParser`.
 *
 * NOTE: This module has zero imports so it runs identically in Deno and
 * Node/jsdom — the only external surface is the DOMParser interface.
 */

// ── Types (exported for use by focusSyncHandler + tests) ─────────────────────

/** A single sold item as parsed from the items section. */
export interface ParsedItem {
  name: string;
  units: number;
  sales: number;
  revenueCenter: string;
}

/** Aggregated totals from the summary rows. */
export interface ParsedTotals {
  netSales: number;
  totalTax: number;
  subtotalDiscounts: number;
  retainedTips: number;
  refunds: number;
  totalSales: number;
}

/** A single payment tender row. */
export interface ParsedPayment {
  tender: string;
  amount: number;
}

/** A single order type row. */
export interface ParsedOrderType {
  type: string;
  amount: number;
}

/** The complete structured output for one business day. */
export interface ParsedDay {
  businessDate: string; // ISO 'YYYY-MM-DD' — passed through from caller
  items: ParsedItem[];
  totals: ParsedTotals;
  payments: ParsedPayment[];
  orderTypes: ParsedOrderType[];
}

/** Discriminated union result (design §16 S9). */
export type ParseResult =
  | { ok: true; data: ParsedDay }
  | { ok: false; reason: 'empty' | 'parse_error' };

// ── Constants — known label anchors ──────────────────────────────────────────

/** Marks the start of the items section (column header row). */
const RE_ITEMS_HEADER = /^revenue\s+center$/i;

/** Summary row labels that end the items section and provide totals. */
const SUMMARY_LABELS: Record<string, keyof ParsedTotals> = {
  'net sales': 'netSales',
  'inclusive tax': 'totalTax',
  'subtotal discounts': 'subtotalDiscounts',
  'retained tips': 'retainedTips',
  'refunds': 'refunds',
  'total sales': 'totalSales',
};

/** Start of the payments section. */
const RE_PAYMENTS_HEADER = /payments\s+by\s+tender/i;

/** Start of the order types section. */
const RE_ORDER_TYPES_HEADER = /sales\s+by\s+order\s+type/i;

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Strip leading/trailing whitespace from a DOM element's text content. */
function cellText(el: Element): string {
  return (el.textContent ?? '').replace(/\u00A0/g, ' ').trim();
}

/**
 * Parse a currency/numeric cell string to a float.
 * Strips $, commas, and surrounding whitespace. Returns 0 for empty cells.
 */
function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Returns true if the label (trimmed lowercase) is a known summary label. */
function isSummaryLabel(label: string): label is keyof typeof SUMMARY_LABELS {
  return label.toLowerCase() in SUMMARY_LABELS;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a Focus POS Revenue Center SSRS HTML4.0 report.
 *
 * @param html          The raw HTML string from the report fetch.
 * @param businessDate  ISO date string ('YYYY-MM-DD') for this report day.
 * @param domParser     Optional DOMParser-compatible instance.
 *                      Defaults to globalThis.DOMParser (available in browser/jsdom).
 *                      Pass `new DOMParser()` from deno_dom in Deno edge functions.
 */
export function parseRevenueCenterReport(
  html: string,
  businessDate: string,
  domParser?: { parseFromString(html: string, mimeType: string): Document },
): ParseResult {
  // Resolve the DOMParser implementation
  const parser = domParser ?? (typeof DOMParser !== 'undefined' ? new DOMParser() : null);
  if (!parser) {
    return { ok: false, reason: 'parse_error' };
  }

  // ── Parse the HTML document ───────────────────────────────────────────────

  let doc: Document;
  try {
    doc = parser.parseFromString(html, 'text/html');
  } catch {
    return { ok: false, reason: 'parse_error' };
  }

  // Collect all <tr> elements from the document (SSRS nests tables, so we
  // look at all rows in document order and use label-based anchoring).
  const allRows = Array.from(doc.querySelectorAll('tr'));

  if (allRows.length === 0) {
    return { ok: false, reason: 'parse_error' };
  }

  // ── State machine over rows ───────────────────────────────────────────────

  type Section = 'before_items' | 'items' | 'summary' | 'payments' | 'order_types';
  let section: Section = 'before_items';

  const items: ParsedItem[] = [];
  const totals: ParsedTotals = {
    netSales: 0,
    totalTax: 0,
    subtotalDiscounts: 0,
    retainedTips: 0,
    refunds: 0,
    totalSales: 0,
  };
  const payments: ParsedPayment[] = [];
  const orderTypes: ParsedOrderType[] = [];

  // Current revenue center name (updated when we see a section-name row in items)
  let currentRevenueCenter = '';
  // Track whether we found any recognizable structure
  let foundStructure = false;

  for (const row of allRows) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    if (cells.length === 0) continue;

    const c0 = cellText(cells[0]);
    const c0Lower = c0.toLowerCase();

    // ── Detect section transitions ────────────────────────────────────────

    if (RE_ITEMS_HEADER.test(c0) && cells.length >= 3) {
      // Column header row → move into items section
      section = 'items';
      foundStructure = true;
      continue;
    }

    if (RE_PAYMENTS_HEADER.test(c0)) {
      // "Payments By Tender" header row
      section = 'payments';
      foundStructure = true;
      continue;
    }

    if (RE_ORDER_TYPES_HEADER.test(c0)) {
      // "Sales By Order Type" header row
      section = 'order_types';
      foundStructure = true;
      continue;
    }

    // ── Process row by current section ───────────────────────────────────

    switch (section) {
      case 'before_items':
        // Still in header area — skip everything
        break;

      case 'items': {
        // Check if this row is a summary row (ends the items section)
        if (isSummaryLabel(c0Lower)) {
          section = 'summary';
          // Fall through to handle the summary row immediately
          const amountCell = cells.length >= 3 ? cellText(cells[2]) : '';
          const amount = parseMoney(amountCell);
          const key = SUMMARY_LABELS[c0Lower];
          if (key) totals[key] = amount;
          break;
        }

        // Skip blank/whitespace rows
        if (!c0 || c0 === '\u00A0') break;

        const c1 = cells.length >= 2 ? cellText(cells[1]) : '';
        const c2 = cells.length >= 3 ? cellText(cells[2]) : '';

        // Revenue center name row: both amount columns are empty
        if (!c1 && !c2) {
          // This is a revenue center section header
          currentRevenueCenter = c0.replace(/\*+$/, '').trim(); // strip trailing asterisks
          break;
        }

        // Skip "Subtotal" / "Total" rows — they appear in the items section in
        // some report variants but are not individual items. Summary labels
        // (netSales etc.) are already caught by isSummaryLabel above.
        if (c0Lower === 'subtotal' || c0Lower === 'total') break;

        // Item row: has sales amount in c2
        const sales = parseMoney(c2);
        const units = parseMoney(c1);
        // Only record rows with a positive sales amount
        if (sales > 0) {
          items.push({
            name: c0,
            units,
            sales,
            revenueCenter: currentRevenueCenter,
          });
        }
        break;
      }

      case 'summary': {
        if (!c0) break;
        if (isSummaryLabel(c0Lower)) {
          const amountCell = cells.length >= 3 ? cellText(cells[2]) : '';
          const amount = parseMoney(amountCell);
          const key = SUMMARY_LABELS[c0Lower];
          if (key) totals[key] = amount;
        }
        break;
      }

      case 'payments': {
        if (!c0 || c0 === '\u00A0') break;
        const amountCell = cells.length >= 3 ? cellText(cells[2]) : (cells.length >= 2 ? cellText(cells[1]) : '');
        const amount = parseMoney(amountCell);
        // Only record rows that look like tender rows (non-zero or explicitly named)
        if (c0 && (amount > 0 || amountCell === '$0.00' || amountCell === '0.00')) {
          payments.push({ tender: c0, amount });
        }
        break;
      }

      case 'order_types': {
        if (!c0 || c0 === '\u00A0') break;
        const amountCell = cells.length >= 3 ? cellText(cells[2]) : (cells.length >= 2 ? cellText(cells[1]) : '');
        const amount = parseMoney(amountCell);
        if (c0 && (amount > 0 || amountCell === '$0.00' || amountCell === '0.00')) {
          orderTypes.push({ type: c0, amount });
        }
        break;
      }
    }
  }

  // ── Determine result ──────────────────────────────────────────────────────

  // If we found no recognizable report structure, it's a parse error
  if (!foundStructure) {
    return { ok: false, reason: 'parse_error' };
  }

  // If we found structure but there are no items and all totals are zero →
  // empty report (new/closed store with no sales that day; design §16 S9)
  const hasItems = items.length > 0;
  const hasTotals = Object.values(totals).some((v) => v !== 0);

  if (!hasItems && !hasTotals) {
    return { ok: false, reason: 'empty' };
  }

  return {
    ok: true,
    data: {
      businessDate,
      items,
      totals,
      payments,
      orderTypes,
    },
  };
}
