import { AUTO_EXPIRED_NOTE } from '@/lib/shiftTradeStatus';

export const CLOSED_TRADE_STATUSES = ['approved', 'rejected', 'cancelled'] as const;

export type ClosedTradeStatus = (typeof CLOSED_TRADE_STATUSES)[number];

export type TradeHistoryFilter = 'all' | ClosedTradeStatus;

export type TradeHistoryTone = 'success' | 'destructive' | 'muted';

/** The fields of a trade that the history helpers read. */
export interface TradeHistoryTrade {
  status: ClosedTradeStatus;
  manager_note: string | null;
  reviewed_at: string | null;
  updated_at: string;
  offered_by?: { name: string } | null;
  accepted_by?: { name: string } | null;
  target_employee?: { name: string } | null;
}

export interface TradeHistoryOutcome {
  label: string;
  tone: TradeHistoryTone;
  actorText: string;
  instant: string | null;
}

export interface TradeHistoryParties {
  giver: string;
  taker: string;
}

export function getTradeHistoryOutcome(
  trade: TradeHistoryTrade,
  reviewerName: string | null,
): TradeHistoryOutcome {
  if (trade.status === 'approved') {
    return {
      label: 'Approved',
      tone: 'success',
      actorText: reviewerName ? `Approved by ${reviewerName}` : 'Approved',
      instant: trade.reviewed_at,
    };
  }
  if (trade.status === 'rejected') {
    return {
      label: 'Rejected',
      tone: 'destructive',
      actorText: reviewerName ? `Rejected by ${reviewerName}` : 'Rejected',
      instant: trade.reviewed_at,
    };
  }
  if (trade.manager_note === AUTO_EXPIRED_NOTE) {
    return {
      label: 'Expired',
      tone: 'muted',
      actorText: 'No one took the shift',
      instant: trade.reviewed_at,
    };
  }
  return {
    label: 'Cancelled',
    tone: 'muted',
    actorText: trade.accepted_by
      ? `Cancelled after ${trade.accepted_by.name} took it`
      : 'Cancelled before anyone took it',
    instant: trade.updated_at,
  };
}

export function getTradeHistoryParties(trade: TradeHistoryTrade): TradeHistoryParties {
  const giver = trade.offered_by?.name ?? 'Former employee';
  if (trade.accepted_by) return { giver, taker: trade.accepted_by.name };
  if (trade.status !== 'cancelled') return { giver, taker: 'Former employee' };
  if (trade.target_employee) {
    return { giver, taker: `Offered to ${trade.target_employee.name}` };
  }
  return { giver, taker: 'No taker' };
}
