import type { ShiftTradeStatus } from '@/hooks/useShiftTrades';

export type TradeStepState = 'done' | 'current' | 'upcoming' | 'rejected';

export interface TradeStep {
  key: 'posted' | 'claimed' | 'review' | 'transferred';
  label: string;
  state: TradeStepState;
}

export interface PosterTradeProgress {
  /** Always four steps, in canonical order. */
  steps: TradeStep[];
  /** One-line status used as the stepper's accessible name and visible summary. */
  summary: string;
  outcome: 'active' | 'approved' | 'rejected' | 'withdrawn';
}

const FALLBACK_CLAIMANT = 'a teammate';

/**
 * Derive the poster-facing progress of a shift trade.
 *
 * Pure — no clock, no React. A `rejected` trade always has a claimant at the
 * DB level (rejection is only reachable from pending_approval, which sets
 * accepted_by atomically); the fallback name covers ghost rows where the
 * claimant employee was later deleted (FK is ON DELETE SET NULL).
 */
export function getPosterTradeProgress(trade: {
  status: ShiftTradeStatus;
  accepted_by?: { name: string } | null;
}): PosterTradeProgress {
  const claimant = trade.accepted_by?.name ?? FALLBACK_CLAIMANT;
  const claimedLabel = `Claimed by ${claimant}`;

  const step = (
    key: TradeStep['key'],
    label: string,
    state: TradeStepState,
  ): TradeStep => ({ key, label, state });

  switch (trade.status) {
    case 'open':
      return {
        steps: [
          step('posted', 'Posted', 'done'),
          step('claimed', 'Waiting for a claimant', 'current'),
          step('review', 'Manager review', 'upcoming'),
          step('transferred', 'Transferred', 'upcoming'),
        ],
        summary: 'Posted — waiting for a claimant',
        outcome: 'active',
      };
    case 'pending_approval':
      return {
        steps: [
          step('posted', 'Posted', 'done'),
          step('claimed', claimedLabel, 'done'),
          step('review', 'Manager review', 'current'),
          step('transferred', 'Transferred', 'upcoming'),
        ],
        summary: `${claimedLabel} — awaiting manager review`,
        outcome: 'active',
      };
    case 'approved':
      return {
        steps: [
          step('posted', 'Posted', 'done'),
          step('claimed', claimedLabel, 'done'),
          step('review', 'Manager review', 'done'),
          step('transferred', 'Transferred', 'done'),
        ],
        summary: `Approved — shift transferred to ${claimant}`,
        outcome: 'approved',
      };
    case 'rejected':
      return {
        steps: [
          step('posted', 'Posted', 'done'),
          step('claimed', claimedLabel, 'done'),
          step('review', 'Rejected', 'rejected'),
          step('transferred', 'Transferred', 'upcoming'),
        ],
        summary: 'Rejected by manager',
        outcome: 'rejected',
      };
    case 'cancelled':
      // Defensive only — the activity query excludes cancelled trades.
      return {
        steps: [
          step('posted', 'Posted', 'done'),
          step('claimed', 'Claimed', 'upcoming'),
          step('review', 'Manager review', 'upcoming'),
          step('transferred', 'Transferred', 'upcoming'),
        ],
        summary: 'Withdrawn',
        outcome: 'withdrawn',
      };
  }
}

/**
 * Claimant-facing one-line status. The claimant sees a binary outcome, not the
 * pipeline, so no stepper. Unreachable statuses (a claimant row only exists
 * from pending_approval onward) return '' so callers can render nothing.
 */
export function getClaimantTradeStatusLine(status: ShiftTradeStatus): string {
  switch (status) {
    case 'pending_approval':
      return 'Awaiting manager approval';
    case 'approved':
      return 'Approved — this shift is on your schedule';
    case 'rejected':
      return 'Declined';
    default:
      return '';
  }
}
