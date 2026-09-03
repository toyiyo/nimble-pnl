/**
 * Pure display logic for the Deposit Match page and its components.
 *
 * Every function here reads a `DepositMatchReport` (or a piece of one) and
 * derives a display value. Per the design, the client recomputes none of
 * the payload's own totals (`total_expected`, `total_received`,
 * `total_fees`) — those come straight from `report.summary`. The waterfall
 * split below breaks that one trusted total into categories; it never
 * invents a new grand total.
 */

import { formatCurrency } from '@/lib/utils';
import {
  needsAttention,
  type DepositMatchLedgerRow,
  type DepositMatchReport,
  type DepositMatchStreamSummary,
} from '@/types/depositMatch';

/**
 * Picks the tab id for `DailyLedger`. Keeps the current tab when its
 * stream is still in the payload; falls back to the first stream
 * otherwise (a refetch can delete the active stream). Returns null when
 * there are no streams at all (the empty state).
 */
export function pickActiveTab(
  streams: readonly Pick<DepositMatchStreamSummary, 'rule_id'>[],
  currentTab: string | null
): string | null {
  if (streams.length === 0) return null;
  if (currentTab && streams.some((stream) => stream.rule_id === currentTab)) {
    return currentTab;
  }
  return streams[0].rule_id;
}

// Lower rank sorts first — the most urgent exception leads the queue and
// the verdict banner.
const URGENCY_RANK: Record<string, number> = {
  short: 0,
  over: 1,
  late: 2,
  needs_review: 3,
};

function urgencyRank(status: string): number {
  return URGENCY_RANK[status] ?? 99;
}

/** Exceptions from the ledger, most urgent first, then earliest date first. */
export function sortAttentionQueue(
  ledger: readonly DepositMatchLedgerRow[]
): DepositMatchLedgerRow[] {
  return ledger
    .filter((row) => needsAttention(row.status))
    .slice()
    .sort((a, b) => {
      const rankDiff = urgencyRank(a.status) - urgencyRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      return a.business_date.localeCompare(b.business_date);
    });
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Renders a `business_date` ("YYYY-MM-DD") as "Aug 4" without going through
 * `Date`/`Intl` — `business_date` is a calendar day, not an instant, and
 * parsing it as one risks a viewer-timezone shift by a day (restaurant-clock
 * eslint rule). Falls back to the raw string on an unexpected shape.
 */
export function formatBusinessDate(businessDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) return businessDate;
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const month = SHORT_MONTHS[monthIndex];
  if (!month || Number.isNaN(day)) return businessDate;
  return `${month} ${day}`;
}

export interface DepositMatchVerdict {
  tone: 'alert' | 'clear';
  headline: string;
}

/**
 * The one plain-language answer `VerdictBanner` shows. Leads with the most
 * urgent exception (same ranking as `sortAttentionQueue`); an empty queue
 * reads as "all clear".
 */
export function buildVerdict(report: DepositMatchReport): DepositMatchVerdict {
  const [worst] = sortAttentionQueue(report.ledger);
  if (!worst) {
    return { tone: 'clear', headline: 'All deposits match. Nothing needs your attention.' };
  }

  const dateLabel = formatBusinessDate(worst.business_date);
  const gap = Math.abs(worst.expected_amount - worst.received_amount - worst.fee_amount);
  const gapLabel = formatCurrency(gap);

  switch (worst.status) {
    case 'short':
      return {
        tone: 'alert',
        headline: `${dateLabel} is short ${gapLabel} from ${worst.pos_source}.`,
      };
    case 'over':
      return {
        tone: 'alert',
        headline: `${dateLabel} received ${gapLabel} more than expected from ${worst.pos_source}.`,
      };
    case 'late':
      return {
        tone: 'alert',
        headline: `${dateLabel} has not deposited yet from ${worst.pos_source}.`,
      };
    default:
      return {
        tone: 'alert',
        headline: `${dateLabel} needs review from ${worst.pos_source}.`,
      };
  }
}

export interface DepositMatchWaterfallSegment {
  key: 'deposited' | 'settling' | 'fees' | 'needs_review';
  label: string;
  amount: number;
}

/**
 * Splits `report.summary.total_expected` into the waterfall's four
 * segments: deposited + settling + fees + needs review. `needs_review` is
 * the remainder, so the four segments always sum back to the one trusted
 * total — the payload's total is never recomputed, only decomposed.
 */
export function waterfallSegments(report: DepositMatchReport): DepositMatchWaterfallSegment[] {
  let deposited = 0;
  let settling = 0;

  for (const row of report.ledger) {
    if (row.status === 'matched' || row.status === 'matched_net') {
      deposited += row.received_amount;
    } else if (row.status === 'pending' || row.status === 'late') {
      settling += row.expected_amount;
    }
  }

  const fees = report.summary.total_fees;
  const needsReview = report.summary.total_expected - deposited - settling - fees;

  return [
    { key: 'deposited', label: 'Deposited', amount: deposited },
    { key: 'settling', label: 'Settling', amount: settling },
    { key: 'fees', label: 'Fees', amount: fees },
    { key: 'needs_review', label: 'Needs review', amount: needsReview },
  ];
}

/**
 * The probable-cause label for a review/dispute row. Labels a cause only
 * when the refresh engine has confirmed it against POS evidence; the
 * card-rail MVP's `status_reason` carries no evidence code yet, so this
 * always reads "unknown" rather than guess. Update this when the engine
 * starts writing an evidence-backed reason.
 */
export function causeLabel(_row: Pick<DepositMatchLedgerRow, 'status_reason'>): string {
  return 'unknown';
}

export interface DepositMatchSourceDefault {
  /** True when the lag/fee band comes from the design doc's measured production data. */
  measured: boolean;
  settlement: 'gross' | 'net';
  lag_days_min: number;
  lag_days_max: number;
  fee_pct_min: number;
  fee_pct_max: number;
  source_config: Record<string, unknown>;
  /** True when the adapter has no card-tender data to split (Clover). */
  unsupported?: boolean;
}

// Focus and Toast values are proved on production data (design doc,
// "Settlement rules proved on production data"). The rest are reasonable
// starting points an owner must confirm against their own bank.
export const DEPOSIT_MATCH_SOURCE_DEFAULTS: Record<string, DepositMatchSourceDefault> = {
  focus: {
    measured: true,
    settlement: 'gross',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 0,
    fee_pct_max: 0,
    source_config: { card_tender_names: ['Visa', 'MC', 'Amex', 'Discover'] },
  },
  toast: {
    measured: true,
    settlement: 'net',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 1.6,
    fee_pct_max: 3.1,
    source_config: { card_payment_type: 'CREDIT' },
  },
  square: {
    measured: false,
    settlement: 'net',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 2.6,
    fee_pct_max: 2.9,
    // ["CARD","WALLET"] is not a guess. Task 0 of the build plan
    // (docs/superpowers/plans/2026-09-01-deposit-match-plan.md) checked
    // production and recorded this exact value list as the Square API
    // contract's card/wallet source types. An empty array here made
    // deposit_match_source_square raise on every Square rule — the
    // adapter's own empty-array guard cannot tell "no config" from "an
    // administrator picked zero types" and correctly refuses to treat
    // the two the same way.
    source_config: { card_source_types: ['CARD', 'WALLET'] },
  },
  revel: {
    measured: false,
    settlement: 'gross',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 0,
    fee_pct_max: 0,
    source_config: { card_payment_types: [] },
  },
  shift4: {
    measured: false,
    settlement: 'gross',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 0,
    fee_pct_max: 0,
    source_config: {},
  },
  clover: {
    measured: false,
    settlement: 'gross',
    lag_days_min: 1,
    lag_days_max: 2,
    fee_pct_min: 0,
    fee_pct_max: 0,
    source_config: {},
    unsupported: true,
  },
};

export const DEPOSIT_MATCH_SUGGESTED_VALUES_NOTE =
  'Suggested values — check them against your bank';

/** The `SetupDialog` note under an unmeasured source's defaults, or undefined for a measured one. */
export function ruleDefaultsNote(posSource: string): string | undefined {
  const entry = DEPOSIT_MATCH_SOURCE_DEFAULTS[posSource];
  if (!entry || entry.measured) return undefined;
  return DEPOSIT_MATCH_SUGGESTED_VALUES_NOTE;
}
