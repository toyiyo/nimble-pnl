import { describe, it, expect } from "vitest";
import {
  OPEN_OUTFLOW_WINDOW_DAYS,
  OPEN_OUTFLOW_STATUSES,
  getOpenOutflowCutoff,
  summarizeOpenOutflows,
} from "@/lib/openOutflows";

describe("openOutflows constants", () => {
  it("sets the open outflow window to 60 days", () => {
    expect(OPEN_OUTFLOW_WINDOW_DAYS).toBe(60);
  });

  it("lists the open statuses in order", () => {
    expect(OPEN_OUTFLOW_STATUSES).toEqual([
      "pending",
      "stale_30",
      "stale_60",
      "stale_90",
    ]);
  });
});

describe("getOpenOutflowCutoff", () => {
  it("gives the first day inside the window (today minus 59 days)", () => {
    expect(getOpenOutflowCutoff(new Date(2026, 8, 30, 12))).toBe("2026-08-02");
  });

  it("crosses a year edge", () => {
    expect(getOpenOutflowCutoff(new Date(2026, 0, 15, 12))).toBe("2025-11-17");
  });
});

describe("summarizeOpenOutflows", () => {
  const now = new Date(2026, 8, 30, 12);
  const cutoff = getOpenOutflowCutoff(now); // '2026-08-02'

  it("counts a row on the cutoff day as inWindow", () => {
    const result = summarizeOpenOutflows(
      [{ amount: 100, status: "pending", issue_date: cutoff }],
      now,
    );
    expect(result).toEqual({ inWindow: 100, older: 0 });
  });

  it("counts a row one day before the cutoff as older", () => {
    const result = summarizeOpenOutflows(
      [{ amount: 100, status: "pending", issue_date: "2026-08-01" }],
      now,
    );
    expect(result).toEqual({ inWindow: 0, older: 100 });
  });

  it("counts a future-dated row as inWindow", () => {
    const result = summarizeOpenOutflows(
      [{ amount: 50, status: "pending", issue_date: "2026-12-01" }],
      now,
    );
    expect(result).toEqual({ inWindow: 50, older: 0 });
  });

  it("counts stale rows by date, not by status", () => {
    const result = summarizeOpenOutflows(
      [
        { amount: 10, status: "stale_30", issue_date: cutoff },
        { amount: 20, status: "stale_60", issue_date: "2026-08-01" },
        { amount: 30, status: "stale_90", issue_date: cutoff },
      ],
      now,
    );
    expect(result).toEqual({ inWindow: 40, older: 20 });
  });

  it("counts cleared and voided rows in neither bucket", () => {
    const result = summarizeOpenOutflows(
      [
        { amount: 500, status: "cleared", issue_date: cutoff },
        { amount: 500, status: "voided", issue_date: "2026-08-01" },
      ],
      now,
    );
    expect(result).toEqual({ inWindow: 0, older: 0 });
  });

  it("gives zeros for an empty array", () => {
    expect(summarizeOpenOutflows([], now)).toEqual({ inWindow: 0, older: 0 });
  });

  it("sums a numeric string amount as a number", () => {
    const result = summarizeOpenOutflows(
      [{ amount: "12.50", status: "pending", issue_date: cutoff }],
      now,
    );
    expect(result).toEqual({ inWindow: 12.5, older: 0 });
  });
});
