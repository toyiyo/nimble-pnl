import { describe, expect, it } from "vitest";
import { computeProcessingFeeCents } from "@/lib/invoiceUtils";

describe("processing fee gross-up", () => {
  it("grosses up 100.00 to cover 2.9% + 30c", () => {
    const fee = computeProcessingFeeCents(10000);
    expect(fee).toBe(330); // total 10330, net 10000
  });

  it("returns 0 when base is 0 or negative", () => {
    expect(computeProcessingFeeCents(0)).toBe(0);
    expect(computeProcessingFeeCents(-100)).toBe(0);
  });
});
