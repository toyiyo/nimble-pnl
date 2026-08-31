import { describe, it, expect } from "vitest";
import {
  computeUnitPrice,
  compareSupplierUnitPrices,
  parsePackSizeInput,
  isPackSizePairIncomplete,
  type SupplierPriceRow,
} from "@/utils/supplierUnitPrice";

describe("parsePackSizeInput", () => {
  it("parses a filled qty and unit", () => {
    expect(parsePackSizeInput("30", "lb")).toEqual({
      pack_size_qty: 30,
      pack_size_unit: "lb",
    });
  });

  it("returns null for both fields when both inputs are blank", () => {
    expect(parsePackSizeInput("", "")).toEqual({
      pack_size_qty: null,
      pack_size_unit: null,
    });
  });

  it("treats whitespace-only input as blank", () => {
    expect(parsePackSizeInput("  ", "  ")).toEqual({
      pack_size_qty: null,
      pack_size_unit: null,
    });
  });

  it("parses each field independently", () => {
    expect(parsePackSizeInput("30", "")).toEqual({
      pack_size_qty: 30,
      pack_size_unit: null,
    });
    expect(parsePackSizeInput("", "lb")).toEqual({
      pack_size_qty: null,
      pack_size_unit: "lb",
    });
  });
});

describe("isPackSizePairIncomplete", () => {
  it("returns false when both fields are blank", () => {
    expect(isPackSizePairIncomplete("", "")).toBe(false);
  });

  it("returns false when both fields are filled", () => {
    expect(isPackSizePairIncomplete("30", "lb")).toBe(false);
  });

  it("returns true when only qty is filled", () => {
    expect(isPackSizePairIncomplete("30", "")).toBe(true);
  });

  it("returns true when only unit is filled", () => {
    expect(isPackSizePairIncomplete("", "lb")).toBe(true);
  });

  it("treats whitespace-only input as blank", () => {
    expect(isPackSizePairIncomplete("  ", "  ")).toBe(false);
    expect(isPackSizePairIncomplete("30", "  ")).toBe(true);
  });
});

describe("computeUnitPrice", () => {
  it("divides price by pack size qty", () => {
    // 30 lb bag at $30 vs 10 lb bag at $12 -> $1/lb vs $1.20/lb
    expect(computeUnitPrice(30, 30)).toBe(1);
    expect(computeUnitPrice(12, 10)).toBe(1.2);
  });

  it("returns null when price is zero, negative, or not finite", () => {
    expect(computeUnitPrice(0, 10)).toBeNull();
    expect(computeUnitPrice(-5, 10)).toBeNull();
    expect(computeUnitPrice(Infinity, 10)).toBeNull();
    expect(computeUnitPrice(NaN, 10)).toBeNull();
  });

  it("returns null when qty is zero, negative, or not finite", () => {
    expect(computeUnitPrice(30, 0)).toBeNull();
    expect(computeUnitPrice(30, -10)).toBeNull();
    expect(computeUnitPrice(30, Infinity)).toBeNull();
    expect(computeUnitPrice(30, NaN)).toBeNull();
  });

  it("returns null when either input is null or undefined", () => {
    expect(computeUnitPrice(null, 10)).toBeNull();
    expect(computeUnitPrice(30, null)).toBeNull();
    expect(computeUnitPrice(undefined, 10)).toBeNull();
    expect(computeUnitPrice(30, undefined)).toBeNull();
  });
});

describe("compareSupplierUnitPrices", () => {
  it("computes unit price and marks the cheapest row (30lb/$30 vs 10lb/$12)", () => {
    const rows: SupplierPriceRow[] = [
      { id: "a", price: 30, packSizeQty: 30, packSizeUnit: "lb" },
      { id: "b", price: 12, packSizeQty: 10, packSizeUnit: "lb" },
    ];
    const result = compareSupplierUnitPrices(rows);

    expect(result.get("a")).toMatchObject({
      unitPrice: 1,
      unit: "lb",
      normalizedUnitPrice: 1,
      isCheapest: true,
    });
    expect(result.get("b")).toMatchObject({
      unitPrice: 1.2,
      unit: "lb",
      normalizedUnitPrice: 1.2,
      isCheapest: false,
    });
  });

  it("map keys match input row ids", () => {
    const rows: SupplierPriceRow[] = [
      { id: "row-1", price: 10, packSizeQty: 5, packSizeUnit: "lb" },
      { id: "row-2", price: null, packSizeQty: null, packSizeUnit: null },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(Array.from(result.keys())).toEqual(["row-1", "row-2"]);
  });

  it("gives a null unit price for a row missing price or pack data", () => {
    const rows: SupplierPriceRow[] = [
      { id: "a", price: null, packSizeQty: 10, packSizeUnit: "lb" },
      { id: "b", price: 10, packSizeQty: null, packSizeUnit: null },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(result.get("a")).toMatchObject({
      unitPrice: null,
      unit: null,
      normalizedUnitPrice: null,
      isCheapest: false,
    });
    expect(result.get("b")).toMatchObject({
      unitPrice: null,
      unit: null,
      normalizedUnitPrice: null,
      isCheapest: false,
    });
  });

  it("uses the fallback price value the caller passes in (e.g. average_unit_cost)", () => {
    // The caller resolves last_unit_cost with a fallback to average_unit_cost
    // before building the row; the utility only sees the resolved price.
    const lastUnitCost: number | undefined = undefined;
    const averageUnitCost = 8;
    const rows: SupplierPriceRow[] = [
      {
        id: "a",
        price: lastUnitCost ?? averageUnitCost,
        packSizeQty: 4,
        packSizeUnit: "lb",
      },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(result.get("a")?.unitPrice).toBe(2);
  });

  it("normalizes across units to the base unit of the first row with pack data (lb vs oz)", () => {
    const rows: SupplierPriceRow[] = [
      // base unit: lb. $1/lb.
      { id: "a", price: 10, packSizeQty: 10, packSizeUnit: "lb" },
      // 16 oz = 1 lb, so $1 for 16oz = $0.0625/oz = $1/lb normalized. Cheaper.
      { id: "b", price: 0.8, packSizeQty: 16, packSizeUnit: "oz" },
    ];
    const result = compareSupplierUnitPrices(rows);

    const a = result.get("a")!;
    const b = result.get("b")!;
    expect(a.unitPrice).toBe(1);
    expect(a.unit).toBe("lb");
    expect(a.normalizedUnitPrice).toBeCloseTo(1);
    expect(b.unitPrice).toBeCloseTo(0.05);
    expect(b.unit).toBe("oz");
    expect(b.normalizedUnitPrice).toBeCloseTo(0.8);
    expect(a.isCheapest).toBe(false);
    expect(b.isCheapest).toBe(true);
  });

  it("does not set isCheapest on a single row", () => {
    const rows: SupplierPriceRow[] = [
      { id: "a", price: 10, packSizeQty: 5, packSizeUnit: "lb" },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(result.get("a")?.isCheapest).toBe(false);
  });

  it("excludes a row whose unit cannot convert to the base unit from the ranking", () => {
    const rows: SupplierPriceRow[] = [
      { id: "a", price: 10, packSizeQty: 10, packSizeUnit: "lb" },
      { id: "b", price: 5, packSizeQty: 5, packSizeUnit: "lb" },
      // "each" is a count unit and does not convert to lb.
      { id: "c", price: 1, packSizeQty: 1, packSizeUnit: "each" },
    ];
    const result = compareSupplierUnitPrices(rows);

    expect(result.get("a")?.normalizedUnitPrice).toBe(1);
    expect(result.get("b")?.normalizedUnitPrice).toBe(1);
    expect(result.get("c")?.unitPrice).toBe(1);
    expect(result.get("c")?.normalizedUnitPrice).toBeNull();
    // "c" never competes for isCheapest: it has no normalizedUnitPrice.
    expect(result.get("c")?.isCheapest).toBe(false);
  });

  it("does not set isCheapest when only one row has a normalizedUnitPrice", () => {
    const rows: SupplierPriceRow[] = [
      { id: "a", price: 10, packSizeQty: 10, packSizeUnit: "lb" },
      // "each" is a count unit and does not convert to lb.
      { id: "b", price: 1, packSizeQty: 1, packSizeUnit: "each" },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(result.get("a")?.isCheapest).toBe(false);
    expect(result.get("b")?.isCheapest).toBe(false);
  });

  it("breaks a normalized-price tie in favor of the earliest input row", () => {
    const rows: SupplierPriceRow[] = [
      { id: "first", price: 10, packSizeQty: 10, packSizeUnit: "lb" },
      { id: "second", price: 20, packSizeQty: 20, packSizeUnit: "lb" },
    ];
    const result = compareSupplierUnitPrices(rows);
    expect(result.get("first")?.isCheapest).toBe(true);
    expect(result.get("second")?.isCheapest).toBe(false);
  });
});
