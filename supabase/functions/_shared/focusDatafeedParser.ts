/**
 * focusDatafeedParser.ts
 *
 * Parses a Focus POS "Legacy Datafeed" XML (one business day's full extract,
 * fetched via /api/lynk → blob_url) into structured checks → items → payments.
 *
 * Only the <Checks> section is consumed here (transactions). The large
 * Configuration / Menuitems / Employees sections are ignored.
 *
 * PII note: online-order "Kitchen Comment" lines carry customer name / phone /
 * address in GuestCheckName. They are never priced sale items; they're flagged
 * (isKitchenComment) so the sync can skip persisting them.
 *
 * Works in both Deno (edge functions, via the deno.json import map) and Node
 * (Vitest) using the bare `fast-xml-parser` import — same pattern as date-fns-tz.
 */

import { XMLParser } from 'fast-xml-parser';

export interface FocusPayment {
  /** Per-check payment key. */
  key: string | null;
  /** Focus payment-method id. */
  paymentId: string | null;
  /** Tender name (e.g. "Visa", "Online Ordering", "Redeem Gift Crd"). */
  name: string | null;
  amount: number;
  tip: number;
  /** Last 4 of the masked card number, when present. */
  cardLast4: string | null;
}

export interface FocusItem {
  /** Per-check line key (unique within the check). */
  key: string | null;
  /** Menu-item record number → links to the Focus menu config. */
  recordNumber: string | null;
  /** Item code (CheckItemRecord/ID). */
  code: string | null;
  /** Display name (GuestCheckName). */
  name: string | null;
  /** Report group id (category). */
  reportGroupId: string | null;
  /** Unit price; null for modifiers / comment lines. */
  price: number | null;
  /** ItemKey of the parent item when this line is a modifier. */
  parentKey: string | null;
  isModifier: boolean;
  /** Online-order comment line (customer PII) — not a sale item. */
  isKitchenComment: boolean;
  discountAmount: number;
}

export interface FocusCheck {
  /** CheckRecord/ID — sequential per business day (not globally unique). */
  checkId: string;
  openedAt: string | null;
  closedAt: string | null;
  orderTypeId: string | null;
  revenueCenterId: string | null;
  guests: number | null;
  total: number;
  discountTotal: number;
  taxableSales: number;
  /** Sum of SeatRecord.TaxTotal1..5 across all seats (tax collected). */
  taxAmount: number;
  items: FocusItem[];
  payments: FocusPayment[];
}

export interface FocusDatafeed {
  checks: FocusCheck[];
  /** Check ids removed/voided that day (<DeleteRecord>). */
  deletedCheckIds: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

/** Trim to string or null (empty → null). */
function str(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === '' ? null : s;
}

/** Parse a numeric field; missing/blank → 0. */
function num(x: unknown): number {
  if (x === null || x === undefined || x === '') return 0;
  const n = Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : 0;
}

/** Optional numeric field: missing/blank → null. */
function numOrNull(x: unknown): number | null {
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

function last4(account: unknown): string | null {
  const s = str(account);
  if (!s) return null;
  const m = s.match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

// ── parse ───────────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep every leaf as a string; we parse numbers ourselves
  trimValues: true,
  // Disable entity expansion to prevent XXE / DoS via crafted DTD entities.
  // Focus datafeed XML uses no custom entities; disabling is safe and required for
  // security on untrusted server-side XML input.
  processEntities: false,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseItem(cir: any): FocusItem {
  return {
    key: str(cir.Key),
    recordNumber: str(cir.RecordNumber),
    code: str(cir.ID),
    name: str(cir.GuestCheckName),
    reportGroupId: str(cir.ReportGroupID),
    price: numOrNull(cir.Price),
    parentKey: str(cir.ItemKey),
    isModifier: cir.FlagsSub === 'Y',
    isKitchenComment: cir.FlagsKitchenComment === 'Y',
    discountAmount: num(cir.DiscountAmount),
  };
}

function parsePayment(pr: any): FocusPayment {
  return {
    key: str(pr.Key),
    paymentId: str(pr.ID),
    name: str(pr.Name),
    amount: num(pr.Amount),
    tip: num(pr.Tip),
    cardLast4: last4(pr.Account),
  };
}

function parseCheck(check: any): FocusCheck {
  const cr = check.CheckRecord ?? {};
  const items: FocusItem[] = [];
  const payments: FocusPayment[] = [];
  let taxAmountRaw = 0;
  for (const seat of toArray(check.Seats?.Seat)) {
    for (const cir of toArray(seat.CheckItemRecord)) items.push(parseItem(cir));
    for (const pr of toArray(seat.PaymentRecord)) payments.push(parsePayment(pr));
    // Tax collected lives on SeatRecord (parallel to CheckRecord.TaxableSales1..5),
    // summed across every seat on the check.
    const sr = seat.SeatRecord ?? {};
    taxAmountRaw +=
      num(sr.TaxTotal1) + num(sr.TaxTotal2) + num(sr.TaxTotal3) + num(sr.TaxTotal4) + num(sr.TaxTotal5);
  }
  // Round to 2 decimal places after summing to avoid binary float drift
  // (e.g. 0.1 + 0.2 !== 0.3). Math.round * 100 / 100 is the standard JS idiom.
  const taxableSales =
    Math.round(
      (num(cr.TaxableSales1) +
        num(cr.TaxableSales2) +
        num(cr.TaxableSales3) +
        num(cr.TaxableSales4) +
        num(cr.TaxableSales5)) *
        100,
    ) / 100;
  const taxAmount = Math.round(taxAmountRaw * 100) / 100;
  return {
    checkId: str(cr.ID) ?? '',
    openedAt: str(cr.TimeOpened),
    closedAt: str(cr.TimeClosed),
    orderTypeId: str(cr.OrderTypeID),
    revenueCenterId: str(cr.RevenueCenterID),
    guests: numOrNull(cr.Guests),
    total: num(cr.Total),
    discountTotal: num(cr.DiscountTotalAmount),
    taxableSales,
    taxAmount,
    items,
    payments,
  };
}

/**
 * Extract the raw content of the <Checks>...</Checks> block from a full
 * Lynk datafeed XML using cheap indexOf scanning — O(n) but zero regex cost
 * on the 4.5 MB payload (~90 % of which is config/menu we never need).
 *
 * Returns the content string if the block is found, or null when it is
 * absent (config-only feed for very old dates).
 */
export function extractChecksBlock(xml: string): string | null {
  const startTag = '<Checks>';
  const endTag = '</Checks>';
  const start = xml.indexOf(startTag);
  if (start === -1) return null;
  const end = xml.indexOf(endTag, start + startTag.length);
  if (end === -1) return null;
  return xml.slice(start + startTag.length, end);
}

export function parseFocusDatafeed(xml: string): FocusDatafeed {
  // ── Fast-path: pre-extract the <Checks> block to avoid parsing 4.5 MB of
  // menu/config data that we never use. For a 6-day custom-range sync this
  // cuts XMLParser CPU by ~90 %, eliminating the HTTP 546 edge-worker limit.
  // The extracted content is re-wrapped in <DailyData><Checks> so that the
  // existing object paths (doc.DailyData.Checks.*) remain identical.
  //
  // If the block is absent (config-only feed for a very old date) return
  // early without calling fast-xml-parser at all.
  //
  // Safety: if the wrapped sub-document is unparseable we fall back to the
  // full parse so the result is never worse than before this change.

  const checksContent = extractChecksBlock(xml);

  if (checksContent === null) {
    // No <Checks> block at all — config-only feed; nothing to import.
    return { checks: [], deletedCheckIds: [] };
  }

  // Wrap the extracted content into a minimal document that preserves the
  // object paths the parser already uses: doc.DailyData.Checks.Check / DeleteRecord
  const wrappedXml = `<DailyData><Checks>${checksContent}</Checks></DailyData>`;

  let doc: any;
  try {
    doc = parser.parse(wrappedXml);
  } catch {
    // Extraction produced unparseable XML (should not happen with well-formed
    // feeds but guards against edge-cases). Fall back to the full document.
    try {
      doc = parser.parse(xml);
    } catch {
      return { checks: [], deletedCheckIds: [] };
    }
  }

  const checksNode = doc?.DailyData?.Checks;
  const parsedChecks = toArray(checksNode?.Check).map(parseCheck);
  const checks = parsedChecks.filter((c) => c.checkId !== '');
  if (checks.length !== parsedChecks.length) {
    console.warn(
      `focusDatafeedParser: dropped ${parsedChecks.length - checks.length} check(s) with missing CheckRecord/ID`,
    );
  }
  const deletedCheckIds = toArray(checksNode?.DeleteRecord)
    .map((d: any) => str(d?.ID))
    .filter((id): id is string => id !== null && id !== undefined);
  return { checks, deletedCheckIds };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
