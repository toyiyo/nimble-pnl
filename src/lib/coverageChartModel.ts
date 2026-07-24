/**
 * Pure presentation helpers for the coverage chart's demand/floor split.
 *
 * These are intentionally decoupled from `CoverageHour.needed` (which is
 * computed upstream from live staffing-recommendation state and can reflect
 * an in-progress SPLH-slider preview). `classifyHour` instead derives its
 * own `needed = max(demand, minStaff)` from the two primitives the chart
 * actually needs to draw a column, so it stays correct even if a caller
 * passes a hypothetical `minStaff` that hasn't round-tripped through the
 * recommendation pipeline yet (e.g. a settings-form preview).
 */

import type { CoverageHour } from '@/lib/coverageSummary';

export type HourClassification = 'crit' | 'floor' | 'spare' | 'ok' | 'nodata';

/**
 * Classify an hour's coverage column for the chart/receipt.
 *
 * - `nodata` — no demand target for this hour (`h.demand === null`): no
 *   sales history / no recommendation, excluded from every shortfall count.
 * - Otherwise `needed = max(h.demand, minStaff)`:
 *   - `crit`  — `scheduled < demand` (short even of the raw sales-driven demand)
 *   - `floor` — `demand <= scheduled < needed` (demand is met, but the
 *     minimum-staff floor still isn't)
 *   - `ok`    — `scheduled === needed`
 *   - `spare` — `scheduled > needed`
 */
export function classifyHour(h: CoverageHour, minStaff: number): HourClassification {
  if (h.demand === null) return 'nodata';

  const demand = h.demand;
  const needed = Math.max(demand, minStaff);
  const scheduled = h.scheduled;

  if (scheduled < demand) return 'crit';
  if (scheduled < needed) return 'floor';
  if (scheduled > needed) return 'spare';
  return 'ok';
}

export interface ImpliedLaborResult {
  pct: number;
  overTarget: boolean;
}

/**
 * Implied labor % of a given SPLH target at a given average hourly wage —
 * the on-chart slider's live readout (`→ X% labor at $W/hr`).
 *
 * `overTarget` flags the readout as "over budget" once `pct` clears
 * `targetLaborPct` by more than a 0.05-point tolerance (so a target hit to
 * within float/rounding noise doesn't flash red).
 */
export function impliedLabor(params: {
  wage: number;
  splh: number;
  targetLaborPct: number;
}): ImpliedLaborResult {
  const { wage, splh, targetLaborPct } = params;
  const pct = (wage / splh) * 100;
  const overTarget = pct > targetLaborPct + 0.05;
  return { pct, overTarget };
}

/**
 * The SPLH target that exactly hits `targetLaborPct` at `wage` — the value
 * the slider's track notch is drawn at, so a manager can see where their own
 * labor goal puts the knob.
 */
export function laborConsistentSplh(params: { wage: number; targetLaborPct: number }): number {
  const { wage, targetLaborPct } = params;
  return wage / (targetLaborPct / 100);
}

// ── Receipt ──────────────────────────────────────────────────────────────────

export type ReceiptTone = 'default' | 'critical' | 'warning' | 'positive';

export interface ReceiptRow {
  label: string;
  value: string;
  tone: ReceiptTone;
}

export interface Receipt {
  /** Ordered ledger lines. Empty for `nodata` hours (see `asides` instead). */
  rows: ReceiptRow[];
  /** Contextual notes below the ledger — implied SPLH, mid-hour range, floor/nodata explainers. */
  asides: string[];
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * Build the pinned "receipt" ledger for a coverage column — the arithmetic
 * that produced its verdict, plus contextual asides. Pure and presentational;
 * mirrors `classifyHour`'s own `needed = max(demand, minStaff)` derivation so
 * the two never disagree on a column's kind.
 *
 * `÷ target` is *not* the live SPLH slider value (not available here — see
 * design doc §Data model; `CoverageHour` only carries the already-folded
 * `demand`). It is the target implied by this hour's own numbers,
 * `round(projectedSales / demand)`, which is exactly self-consistent with the
 * `avg sales ÷ target = demand` line above it (no hidden Math.ceil step to
 * explain). It is omitted when `demand === 0` (avgSales ≤ 0 — a rec exists
 * but there's nothing to divide).
 */
export function buildReceipt(
  h: CoverageHour,
  params: { minStaff: number; weekdayKey: string; wage: number; lookbackWeeks: number },
): Receipt {
  const { minStaff, weekdayKey, wage, lookbackWeeks } = params;

  if (h.demand === null) {
    return {
      rows: [],
      asides: [
        `No sales in the last ${lookbackWeeks} ${weekdayKey}s — no demand target to compare against. ` +
          `(The old chart used to show this hour as ${h.scheduled} / 0.)`,
      ],
    };
  }

  const demand = h.demand;
  const scheduled = h.scheduled;
  const scheduledMax = h.scheduledMax;
  const projectedSales = h.projectedSales ?? 0;
  const needed = Math.max(demand, minStaff);
  const kind = classifyHour(h, minStaff);

  const rows: ReceiptRow[] = [
    { label: `Avg ${weekdayKey} sales`, value: fmtUsd(projectedSales), tone: 'default' },
  ];

  if (demand > 0) {
    const impliedTarget = Math.round(projectedSales / demand);
    rows.push({ label: '÷ target', value: `${fmtUsd(impliedTarget)}/hr`, tone: 'default' });
  }

  rows.push({
    label: '= demand',
    value: `${demand} ${demand === 1 ? 'person' : 'people'}`,
    tone: kind === 'crit' ? 'critical' : 'default',
  });
  rows.push({
    label: 'min staff',
    value: `${minStaff}`,
    tone: demand < minStaff ? 'warning' : 'default',
  });
  rows.push({ label: 'needed', value: `${needed}`, tone: 'default' });
  rows.push({ label: 'scheduled', value: `${scheduled}`, tone: 'default' });

  if (kind === 'crit') {
    rows.push({ label: 'Short on demand', value: `${scheduled - demand}`, tone: 'critical' });
  } else if (kind === 'floor') {
    rows.push({ label: 'Short on floor', value: `${scheduled - needed}`, tone: 'warning' });
  } else if (kind === 'spare') {
    rows.push({ label: 'Covered', value: `+${scheduled - needed}`, tone: 'positive' });
  } else {
    rows.push({ label: 'On target', value: '0', tone: 'default' });
  }

  const asides: string[] = [];

  // Implied SPLH at the scheduled count — only meaningful when someone is
  // actually scheduled (avoids a divide-by-zero and a nonsensical "$Infinity/hr").
  if (scheduled > 0) {
    const splhAt = projectedSales / scheduled;
    const laborPctAt = Math.round((wage / splhAt) * 100);
    asides.push(`At ${scheduled} scheduled, implied SPLH is ${fmtUsd(Math.round(splhAt))}/hr → ${laborPctAt}% labor.`);
  }

  // Mid-hour headcount range — only worth surfacing when it actually moved.
  if (scheduledMax !== scheduled) {
    asides.push(
      `Headcount moves from ${scheduledMax} to ${scheduled} during this hour — the chart counts the lower figure.`,
    );
  }

  if (kind === 'floor') {
    asides.push(`Sales only justify ${demand} here — the rest is your minimum-staff rule.`);
  }

  return { rows, asides };
}
