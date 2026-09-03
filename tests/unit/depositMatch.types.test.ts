import { describe, it, expect } from 'vitest';

import {
  DepositMatchPayloadError,
  feePercent,
  isDepositMatchResolution,
  isDepositMatchStatus,
  needsAttention,
  parseDepositMatchReport,
  settlingAmount,
} from '@/types/depositMatch';

interface RawReport {
  summary: Record<string, unknown>;
  streams: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
  banks: Array<Record<string, unknown>>;
}

function validReport(): RawReport {
  return {
    summary: {
      total_expected: 100,
      total_received: 90,
      total_fees: 5,
      pending_count: 1,
      needs_attention_count: 1,
    },
    streams: [
      {
        rule_id: 'rule-1',
        pos_source: 'focus',
        rail: 'card',
        active: true,
        expected_total: 100,
        received_total: 90,
        fee_total: 5,
        item_count: 2,
      },
    ],
    ledger: [
      {
        item_id: 'item-1',
        rule_id: 'rule-1',
        pos_source: 'focus',
        business_date: '2026-08-04',
        expected_amount: 745.68,
        received_amount: 0,
        fee_amount: 0,
        status: 'short',
        status_reason: 'below_tolerance',
        resolution: null,
        resolution_note: null,
        links: [
          {
            link_id: 'link-1',
            bank_transaction_id: 'txn-1',
            allocated_amount: 500,
            method: 'auto',
            state: 'confirmed',
            match_reason: 'exact_fit',
          },
        ],
      },
    ],
    banks: [
      {
        connected_bank_id: 'bank-1',
        institution_name: 'Chase',
        status: 'connected',
        data_current_through: '2026-08-30',
      },
    ],
  };
}

describe('isDepositMatchStatus', () => {
  it('accepts every status in the SQL check constraint', () => {
    for (const status of [
      'matched',
      'matched_net',
      'pending',
      'late',
      'short',
      'over',
      'needs_review',
      'incomplete',
    ]) {
      expect(isDepositMatchStatus(status)).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(isDepositMatchStatus('reconciled')).toBe(false);
    expect(isDepositMatchStatus(undefined)).toBe(false);
    expect(isDepositMatchStatus(42)).toBe(false);
  });
});

describe('isDepositMatchResolution', () => {
  it('accepts null and each resolution value', () => {
    expect(isDepositMatchResolution(null)).toBe(true);
    expect(isDepositMatchResolution('accepted')).toBe(true);
    expect(isDepositMatchResolution('disputed')).toBe(true);
  });

  it('rejects an unknown resolution', () => {
    expect(isDepositMatchResolution('resolved')).toBe(false);
  });
});

describe('needsAttention', () => {
  it('flags short, over, late, and needs_review', () => {
    expect(needsAttention('short')).toBe(true);
    expect(needsAttention('over')).toBe(true);
    expect(needsAttention('late')).toBe(true);
    expect(needsAttention('needs_review')).toBe(true);
  });

  it('does not flag matched, matched_net, pending, or incomplete', () => {
    expect(needsAttention('matched')).toBe(false);
    expect(needsAttention('matched_net')).toBe(false);
    expect(needsAttention('pending')).toBe(false);
    expect(needsAttention('incomplete')).toBe(false);
  });
});

describe('feePercent', () => {
  it('computes the fee as a percent of the expected amount', () => {
    expect(feePercent(3, 100)).toBeCloseTo(3);
  });

  it('returns null when the expected amount is zero, instead of dividing by zero', () => {
    expect(feePercent(0, 0)).toBeNull();
  });
});

describe('settlingAmount', () => {
  it('is expected minus received minus fees', () => {
    expect(
      settlingAmount({ expected_total: 100, received_total: 90, fee_total: 5 })
    ).toBeCloseTo(5);
  });
});

describe('parseDepositMatchReport', () => {
  it('returns the payload unchanged when every shape check passes', () => {
    const report = parseDepositMatchReport(validReport());
    expect(report.summary.total_expected).toBe(100);
    expect(report.ledger[0].status).toBe('short');
    expect(report.ledger[0].links[0].link_id).toBe('link-1');
  });

  it('throws DepositMatchPayloadError when the payload is not an object', () => {
    expect(() => parseDepositMatchReport(null)).toThrow(DepositMatchPayloadError);
    expect(() => parseDepositMatchReport('nope')).toThrow(DepositMatchPayloadError);
  });

  it('throws when summary is missing', () => {
    const bad = validReport() as Record<string, unknown>;
    delete bad.summary;
    expect(() => parseDepositMatchReport(bad)).toThrow(DepositMatchPayloadError);
  });

  it('throws when streams is not an array', () => {
    const bad = validReport() as Record<string, unknown>;
    bad.streams = {};
    expect(() => parseDepositMatchReport(bad)).toThrow(DepositMatchPayloadError);
  });

  it('throws when a ledger row has an unknown status', () => {
    const bad = validReport();
    bad.ledger[0].status = 'reconciled';
    expect(() => parseDepositMatchReport(bad)).toThrow(DepositMatchPayloadError);
  });

  it('throws when a ledger row has an unknown resolution', () => {
    const bad = validReport();
    bad.ledger[0].resolution = 'closed';
    expect(() => parseDepositMatchReport(bad)).toThrow(DepositMatchPayloadError);
  });
});
