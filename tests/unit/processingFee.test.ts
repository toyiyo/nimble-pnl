import { describe, expect, it } from "vitest";

const computeProcessingFeeCents = (baseCents: number, rate = 0.029, fixedCents = 30) => {
  if (baseCents <= 0) return 0;
  const gross = Math.round((baseCents + fixedCents) / (1 - rate));
  const fee = gross - baseCents;
  return Math.max(0, fee);
};

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
