import { subDays } from "date-fns";
import { toDateOnlyString } from "@/lib/dateOnly";

// Statuses that count as open (not cleared, not voided).
export const OPEN_OUTFLOW_STATUSES = [
  "pending",
  "stale_30",
  "stale_60",
  "stale_90",
] as const;

// The open outflow window, in days.
export const OPEN_OUTFLOW_WINDOW_DAYS = 60;

/**
 * Gives the 'yyyy-MM-dd' date of the first day inside the window.
 * The window runs from (today − 59 days) through today.
 */
export function getOpenOutflowCutoff(now: Date = new Date()): string {
  return toDateOnlyString(subDays(now, OPEN_OUTFLOW_WINDOW_DAYS - 1));
}

interface OpenOutflowRow {
  amount: number | string;
  status: string;
  issue_date: string;
}

/**
 * Splits open rows into the in-window amount and the older amount.
 * A row with another status (cleared, voided) counts in neither bucket.
 */
export function summarizeOpenOutflows(
  rows: ReadonlyArray<OpenOutflowRow>,
  now: Date = new Date(),
): { inWindow: number; older: number } {
  const cutoff = getOpenOutflowCutoff(now);
  let inWindow = 0;
  let older = 0;

  for (const row of rows) {
    if (!OPEN_OUTFLOW_STATUSES.includes(row.status as (typeof OPEN_OUTFLOW_STATUSES)[number])) {
      continue;
    }
    const amount = Number(row.amount);
    if (row.issue_date >= cutoff) {
      inWindow += amount;
    } else {
      older += amount;
    }
  }

  return { inWindow, older };
}
