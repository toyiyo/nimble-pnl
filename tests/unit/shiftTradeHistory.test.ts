import { describe, it, expect } from 'vitest';
import {
  CLOSED_TRADE_STATUSES,
  getTradeHistoryOutcome,
  getTradeHistoryParties,
  type TradeHistoryTrade,
} from '@/lib/shiftTradeHistory';
import { AUTO_EXPIRED_NOTE } from '@/lib/shiftTradeStatus';

const base: TradeHistoryTrade = {
  status: 'approved',
  manager_note: null,
  reviewed_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  offered_by: { name: 'Ana' },
  accepted_by: { name: 'Ben' },
  target_employee: null,
};

describe('CLOSED_TRADE_STATUSES', () => {
  it('lists the three closed statuses', () => {
    expect(CLOSED_TRADE_STATUSES).toEqual(['approved', 'rejected', 'cancelled']);
  });
});

describe('getTradeHistoryOutcome', () => {
  it('approved with reviewer', () => {
    expect(getTradeHistoryOutcome(base, 'Cy')).toEqual({
      label: 'Approved',
      tone: 'success',
      actorText: 'Approved by Cy',
      instant: base.reviewed_at,
    });
  });
  it('approved without reviewer name', () => {
    expect(getTradeHistoryOutcome(base, null).actorText).toBe('Approved');
  });
  it('rejected with and without reviewer', () => {
    const t = { ...base, status: 'rejected' as const };
    const o = getTradeHistoryOutcome(t, 'Cy');
    expect(o.label).toBe('Rejected');
    expect(o.tone).toBe('destructive');
    expect(o.actorText).toBe('Rejected by Cy');
    expect(o.instant).toBe(t.reviewed_at);
    expect(getTradeHistoryOutcome(t, null).actorText).toBe('Rejected');
  });
  it('auto expired uses reviewed_at', () => {
    const t = { ...base, status: 'cancelled' as const, manager_note: AUTO_EXPIRED_NOTE };
    expect(getTradeHistoryOutcome(t, 'Cy')).toEqual({
      label: 'Expired',
      tone: 'muted',
      actorText: 'No one took the shift',
      instant: t.reviewed_at,
    });
  });
  it('cancelled uses updated_at', () => {
    const t = { ...base, status: 'cancelled' as const };
    expect(getTradeHistoryOutcome(t, 'Cy')).toEqual({
      label: 'Cancelled',
      tone: 'muted',
      actorText: 'Cancelled before anyone took it',
      instant: t.updated_at,
    });
  });
});

describe('getTradeHistoryParties', () => {
  it('uses accepted_by as taker', () => {
    expect(getTradeHistoryParties(base)).toEqual({ giver: 'Ana', taker: 'Ben' });
  });
  it('shows Former employee when approved with no accepted_by', () => {
    expect(getTradeHistoryParties({ ...base, accepted_by: null }).taker).toBe('Former employee');
    expect(
      getTradeHistoryParties({ ...base, status: 'rejected', accepted_by: null }).taker,
    ).toBe('Former employee');
  });
  it('shows target for cancelled with a target', () => {
    const t = {
      ...base,
      status: 'cancelled' as const,
      accepted_by: null,
      target_employee: { name: 'Dee' },
    };
    expect(getTradeHistoryParties(t).taker).toBe('Offered to Dee');
  });
  it('shows No taker for cancelled without target', () => {
    const t = { ...base, status: 'cancelled' as const, accepted_by: null };
    expect(getTradeHistoryParties(t).taker).toBe('No taker');
  });
  it('keeps accepted_by for a cancelled trade that has one', () => {
    const t = { ...base, status: 'cancelled' as const };
    expect(getTradeHistoryParties(t).taker).toBe('Ben');
  });
});
