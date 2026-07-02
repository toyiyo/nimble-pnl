/**
 * Shared utility functions for receipt import logic.
 *
 * These are extracted from useReceiptImport and ReceiptMappingReview
 * so that both production code and tests reference the same implementation.
 */

interface ImportableLineItem {
  mapping_status: string;
  matched_product_id: string | null;
  parsed_price: number | null;
}

/**
 * Calculate the imported total by summing parsed_price for eligible items.
 *
 * Eligible items are:
 * - mapping_status === 'mapped' with a non-null matched_product_id
 * - mapping_status === 'new_item'
 *
 * Skipped, pending, and orphaned mapped items are excluded.
 */
export function calculateImportedTotal(lineItems: ImportableLineItem[]): number {
  return lineItems
    .filter(
      (item) =>
        (item.mapping_status === 'mapped' && item.matched_product_id) ||
        item.mapping_status === 'new_item',
    )
    .reduce((sum, item) => sum + (item.parsed_price || 0), 0);
}

/**
 * Build a SQL LIKE pattern that matches all inventory_transaction reference_ids
 * belonging to a given receipt.
 *
 * Reference IDs follow the format: receipt_{receiptId}_{itemId}
 */
export function buildReceiptReferencePattern(receiptId: string): string {
  return `receipt_${receiptId}_%`;
}

/**
 * Check whether a reference_id string belongs to a specific receipt.
 */
export function matchesReceiptReference(
  referenceId: string,
  receiptId: string,
): boolean {
  return referenceId.startsWith(`receipt_${receiptId}_`);
}

interface UnitPriceInput {
  unit_price?: number | null;
  parsed_quantity?: number | null;
  parsed_price?: number | null;
}

/**
 * Calculate unit price for a line item.
 *
 * Prefers stored unit_price, falls back to parsed_price / parsed_quantity,
 * and finally to parsed_price itself when quantity is missing or zero.
 */
export function calculateUnitPrice(item: UnitPriceInput): number {
  if (item.unit_price != null) {
    return item.unit_price;
  }

  if (item.parsed_quantity && item.parsed_quantity > 0) {
    return (item.parsed_price || 0) / item.parsed_quantity;
  }

  return item.parsed_price || 0;
}

export interface ImportedQuantityInput {
  casesOrdered?: number | null;
  unitsPerPack?: number | null;
}

/**
 * Total inner units received = cases ordered × units per pack.
 * Both inputs default to 1 so a missing/zero value never zeroes the quantity.
 */
export function computeImportedQuantity({ casesOrdered, unitsPerPack }: ImportedQuantityInput): number {
  const cases = Math.max(1, casesOrdered || 0);
  const pack = Math.max(1, unitsPerPack || 0);
  return cases * pack;
}

export interface ParsedPackSize {
  unitsPerPack: number;
  sizeValue: number;
  sizeUnit: string;
}

/**
 * Parse a Sygma-style "pack/size unit" token, e.g. "8/32 OZ", "1/20 LB", "2/2.5GAL".
 * A token with no slash (e.g. "20 LB") is treated as pack = 1.
 * Returns null when no numeric size can be found.
 */
export function parsePackSizeToken(token: string): ParsedPackSize | null {
  if (!token) return null;
  const trimmed = token.trim();
  const hasSlash = trimmed.includes('/');
  const [packPart, sizePart] = hasSlash ? trimmed.split('/', 2) : ['1', trimmed];

  const unitsPerPack = hasSlash ? Math.max(1, parseInt(packPart, 10) || 1) : 1;

  // size like "2.5GAL" or "32 OZ" → number then unit (parseFloat keeps decimals)
  const sizeMatch = sizePart.trim().match(/^([\d.]+)\s*([a-zA-Z ]+)$/);
  if (!sizeMatch) return null;
  const sizeValue = parseFloat(sizeMatch[1]);
  if (Number.isNaN(sizeValue)) return null;
  const sizeUnit = sizeMatch[2].trim().toLowerCase();

  return { unitsPerPack, sizeValue, sizeUnit };
}
