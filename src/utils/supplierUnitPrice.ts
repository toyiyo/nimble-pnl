import { convertUnits } from "@/lib/enhancedUnitConversion";

/**
 * One supplier row's price and pack size, as passed to
 * compareSupplierUnitPrices. Callers resolve the price value themselves
 * (for example, last_unit_cost with a fallback to average_unit_cost)
 * before building this shape.
 */
export interface SupplierPriceRow {
  id: string;
  price: number | null | undefined;
  packSizeQty: number | null | undefined;
  packSizeUnit: string | null | undefined;
}

/** pack_size_qty / pack_size_unit values ready to write to product_suppliers. */
export interface ParsedPackSize {
  pack_size_qty: number | null;
  pack_size_unit: string | null;
}

/**
 * Parses raw pack size form inputs into the nullable DB shape.
 * A blank field becomes null (never 0 or '') so the paired CHECK
 * constraint on product_suppliers accepts an omitted pack size.
 */
export function parsePackSizeInput(qtyInput: string, unitInput: string): ParsedPackSize {
  return {
    pack_size_qty: qtyInput.trim() === "" ? null : Number(qtyInput),
    pack_size_unit: unitInput.trim() === "" ? null : unitInput,
  };
}

/**
 * True when exactly one of the pack size quantity/unit inputs is filled.
 * A caller must block submission on true — the product_suppliers CHECK
 * constraint rejects a half-filled pair, and parsePackSizeInput does not
 * check pairing on its own.
 */
export function isPackSizePairIncomplete(qtyInput: string, unitInput: string): boolean {
  const qtyFilled = qtyInput.trim() !== "";
  const unitFilled = unitInput.trim() !== "";
  return qtyFilled !== unitFilled;
}

/** Per-unit price result for one supplier row, keyed by row id. */
export interface SupplierUnitPrice {
  /** Price per pack unit, in the row's own unit. Null when it cannot compute. */
  unitPrice: number | null;
  /** The row's own pack unit, or null when unitPrice is null. */
  unit: string | null;
  /** unitPrice converted to the comparison's base unit. Null when it cannot convert. */
  normalizedUnitPrice: number | null;
  /** True on the row with the lowest normalizedUnitPrice. */
  isCheapest: boolean;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Price per pack unit: price / qty.
 * Returns null when either input is not a positive finite number.
 */
export function computeUnitPrice(
  price: number | null | undefined,
  qty: number | null | undefined
): number | null {
  if (!isPositiveFiniteNumber(price) || !isPositiveFiniteNumber(qty)) {
    return null;
  }
  const result = price / qty;
  return isPositiveFiniteNumber(result) ? result : null;
}

/**
 * Computes a per-unit price for each row and flags the cheapest one, after
 * normalizing every row to a common base unit.
 *
 * The base unit is the pack unit of the first input row that carries pack
 * data (a positive packSizeQty and a packSizeUnit). Rows are read in the
 * order the caller passes them, so the result is deterministic for a given
 * input order.
 */
export function compareSupplierUnitPrices(
  rows: SupplierPriceRow[],
  productName?: string
): Map<string, SupplierUnitPrice> {
  const result = new Map<string, SupplierUnitPrice>();

  const baseUnitRow = rows.find(
    (row) =>
      isPositiveFiniteNumber(row.packSizeQty) &&
      typeof row.packSizeUnit === "string" &&
      row.packSizeUnit.length > 0
  );
  const baseUnit = baseUnitRow?.packSizeUnit ?? null;

  for (const row of rows) {
    const unitPrice = computeUnitPrice(row.price, row.packSizeQty);
    const unit = unitPrice !== null ? (row.packSizeUnit as string) : null;

    // Normalize by converting the pack quantity (not the rate) to the base
    // unit, then dividing price by the converted quantity. Converting the
    // rate directly would invert the ratio (e.g. $/oz -> $/lb is a
    // multiplication by 16, not the division convertUnits would apply to
    // a plain quantity).
    let normalizedUnitPrice: number | null = null;
    if (unitPrice !== null && unit !== null && baseUnit !== null) {
      const convertedQty = convertUnits(
        row.packSizeQty as number,
        unit,
        baseUnit,
        productName
      );
      if (convertedQty !== null && isPositiveFiniteNumber(convertedQty.value)) {
        const candidate = (row.price as number) / convertedQty.value;
        normalizedUnitPrice = isPositiveFiniteNumber(candidate) ? candidate : null;
      }
    }

    result.set(row.id, {
      unitPrice,
      unit,
      normalizedUnitPrice,
      isCheapest: false,
    });
  }

  const withNormalizedPrice = rows.filter(
    (row) => result.get(row.id)?.normalizedUnitPrice !== null
  );

  if (withNormalizedPrice.length >= 2) {
    let cheapestId: string | null = null;
    let cheapestPrice = Infinity;
    for (const row of withNormalizedPrice) {
      const price = result.get(row.id)!.normalizedUnitPrice as number;
      if (price < cheapestPrice) {
        cheapestPrice = price;
        cheapestId = row.id;
      }
    }
    if (cheapestId !== null) {
      const entry = result.get(cheapestId)!;
      result.set(cheapestId, { ...entry, isCheapest: true });
    }
  }

  return result;
}
