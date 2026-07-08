import { describe, it, expect } from 'vitest';
import {
  getPosterTradeProgress,
  getClaimantTradeStatusLine,
} from '@/lib/tradeStatusProgress';

const CLAIMANT = { name: 'Jordan' };

describe('getPosterTradeProgress', () => {
  it('open: posted done, claimed current with waiting label', () => {
    const p = getPosterTradeProgress({ status: 'open', accepted_by: null });
    expect(p.steps.map((s) => s.key)).toEqual(['posted', 'claimed', 'review', 'transferred']);
    expect(p.steps[0].state).toBe('done');
    expect(p.steps[1].state).toBe('current');
    expect(p.steps[1].label).toBe('Waiting for a claimant');
    expect(p.steps[2].state).toBe('upcoming');
    expect(p.steps[3].state).toBe('upcoming');
    expect(p.summary).toBe('Posted — waiting for a claimant');
    expect(p.outcome).toBe('active');
  });

  it('pending_approval: claimed done with claimant name, review current', () => {
    const p = getPosterTradeProgress({ status: 'pending_approval', accepted_by: CLAIMANT });
    expect(p.steps[0].state).toBe('done');
    expect(p.steps[1].state).toBe('done');
    expect(p.steps[1].label).toBe('Claimed by Jordan');
    expect(p.steps[2].state).toBe('current');
    expect(p.steps[3].state).toBe('upcoming');
    expect(p.summary).toBe('Claimed by Jordan — awaiting manager review');
    expect(p.outcome).toBe('active');
  });

  it('approved: all steps done, summary names the claimant', () => {
    const p = getPosterTradeProgress({ status: 'approved', accepted_by: CLAIMANT });
    expect(p.steps.every((s) => s.state === 'done')).toBe(true);
    expect(p.summary).toBe('Approved — shift transferred to Jordan');
    expect(p.outcome).toBe('approved');
  });

  it('rejected: review step rejected, transferred stays upcoming', () => {
    const p = getPosterTradeProgress({ status: 'rejected', accepted_by: CLAIMANT });
    expect(p.steps[0].state).toBe('done');
    expect(p.steps[1].state).toBe('done');
    expect(p.steps[2].state).toBe('rejected');
    expect(p.steps[3].state).toBe('upcoming');
    expect(p.summary).toBe('Rejected by manager');
    expect(p.outcome).toBe('rejected');
  });

  it('ghost claimant (null accepted_by past open) degrades to "a teammate"', () => {
    const p = getPosterTradeProgress({ status: 'pending_approval', accepted_by: null });
    expect(p.steps[1].label).toBe('Claimed by a teammate');
    expect(p.summary).toBe('Claimed by a teammate — awaiting manager review');
  });

  it('cancelled (defensive — excluded by the query): withdrawn outcome', () => {
    const p = getPosterTradeProgress({ status: 'cancelled', accepted_by: null });
    expect(p.outcome).toBe('withdrawn');
    expect(p.summary).toBe('Withdrawn');
    expect(p.steps[0].state).toBe('done');
    expect(p.steps.slice(1).every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('always returns exactly four steps in canonical order', () => {
    for (const status of ['open', 'pending_approval', 'approved', 'rejected', 'cancelled'] as const) {
      const p = getPosterTradeProgress({ status, accepted_by: CLAIMANT });
      expect(p.steps.map((s) => s.key)).toEqual(['posted', 'claimed', 'review', 'transferred']);
    }
  });
});

describe('getClaimantTradeStatusLine', () => {
  it('pending_approval → awaiting approval', () => {
    expect(getClaimantTradeStatusLine('pending_approval')).toBe('Awaiting manager approval');
  });
  it('approved → shift on your schedule', () => {
    expect(getClaimantTradeStatusLine('approved')).toBe('Approved — this shift is on your schedule');
  });
  it('rejected → declined', () => {
    expect(getClaimantTradeStatusLine('rejected')).toBe('Declined');
  });
  it('unreachable statuses return empty string (defensive)', () => {
    expect(getClaimantTradeStatusLine('open')).toBe('');
    expect(getClaimantTradeStatusLine('cancelled')).toBe('');
  });
});
