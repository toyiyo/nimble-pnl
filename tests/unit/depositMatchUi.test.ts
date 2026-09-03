import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_MATCH_SOURCE_DEFAULTS,
  DEPOSIT_MATCH_SUGGESTED_VALUES_NOTE,
  buildVerdict,
  causeLabel,
  formatBusinessDate,
  pickActiveTab,
  ruleDefaultsNote,
  sortAttentionQueue,
  waterfallSegments,
} from '@/lib/depositMatchUi';
import type { DepositMatchLedgerRow, DepositMatchReport } from '@/types/depositMatch';

function row(overrides: Partial<DepositMatchLedgerRow>): DepositMatchLedgerRow {
  return {
    item_id: 'item-1',
    rule_id: 'rule-1',
    pos_source: 'focus',
    business_date: '2026-08-04',
    expected_amount: 1000,
    received_amount: 1000,
    fee_amount: 0,
    status: 'matched',
    status_reason: null,
    resolution: null,
    resolution_note: null,
    links: [],
    ...overrides,
  };
}

function report(ledger: DepositMatchLedgerRow[]): DepositMatchReport {
  const total_expected = ledger.reduce((sum, r) => sum + r.expected_amount, 0);
  const total_fees = ledger.reduce((sum, r) => sum + r.fee_amount, 0);
  const total_received = ledger.reduce((sum, r) => sum + r.received_amount, 0);
  return {
    summary: {
      total_expected,
      total_received,
      total_fees,
      pending_count: ledger.filter((r) => r.status === 'pending').length,
      needs_attention_count: ledger.filter((r) =>
        ['short', 'over', 'late', 'needs_review'].includes(r.status)
      ).length,
    },
    streams: [],
    ledger,
    banks: [],
  };
}

describe('pickActiveTab', () => {
  it('keeps the current tab when its stream is still present', () => {
    const streams = [{ rule_id: 'a' }, { rule_id: 'b' }];
    expect(pickActiveTab(streams, 'b')).toBe('b');
  });

  it('falls back to the first stream when the current tab is gone', () => {
    const streams = [{ rule_id: 'a' }, { rule_id: 'b' }];
    expect(pickActiveTab(streams, 'deleted')).toBe('a');
  });

  it('defaults to the first stream when there is no current tab', () => {
    const streams = [{ rule_id: 'a' }, { rule_id: 'b' }];
    expect(pickActiveTab(streams, null)).toBe('a');
  });

  it('returns null when there are no streams', () => {
    expect(pickActiveTab([], 'a')).toBeNull();
  });
});

describe('sortAttentionQueue', () => {
  it('drops rows that do not need attention', () => {
    const ledger = [row({ status: 'matched' }), row({ status: 'pending' }), row({ status: 'incomplete' })];
    expect(sortAttentionQueue(ledger)).toEqual([]);
  });

  it('ranks short above over, over above late, late above needs_review', () => {
    const late = row({ item_id: 'late', status: 'late', business_date: '2026-08-10' });
    const needsReview = row({ item_id: 'needs_review', status: 'needs_review', business_date: '2026-08-10' });
    const over = row({ item_id: 'over', status: 'over', business_date: '2026-08-10' });
    const short = row({ item_id: 'short', status: 'short', business_date: '2026-08-10' });
    const sorted = sortAttentionQueue([needsReview, late, over, short]);
    expect(sorted.map((r) => r.item_id)).toEqual(['short', 'over', 'late', 'needs_review']);
  });

  it('breaks ties by earliest business date first', () => {
    const later = row({ item_id: 'later', status: 'short', business_date: '2026-08-10' });
    const earlier = row({ item_id: 'earlier', status: 'short', business_date: '2026-08-04' });
    expect(sortAttentionQueue([later, earlier]).map((r) => r.item_id)).toEqual(['earlier', 'later']);
  });
});

describe('buildVerdict', () => {
  it('reads all-clear when nothing needs attention', () => {
    const verdict = buildVerdict(report([row({ status: 'matched' })]));
    expect(verdict.tone).toBe('clear');
    expect(verdict.headline).toMatch(/all deposits match/i);
  });

  it('names the date, amount, and POS source of the worst exception', () => {
    const shortRow = row({
      status: 'short',
      pos_source: 'shift4',
      business_date: '2026-08-04',
      expected_amount: 1000,
      received_amount: 254.32,
      fee_amount: 0,
    });
    const verdict = buildVerdict(report([shortRow]));
    expect(verdict.tone).toBe('alert');
    expect(verdict.headline).toContain('Aug 4');
    expect(verdict.headline).toContain('745.68');
    expect(verdict.headline).toContain('shift4');
  });

  it('leads with the most urgent exception when several exist', () => {
    const lateRow = row({ item_id: 'late', status: 'late', business_date: '2026-08-01' });
    const shortRow = row({ item_id: 'short', status: 'short', business_date: '2026-08-10' });
    const verdict = buildVerdict(report([lateRow, shortRow]));
    expect(verdict.headline).toContain('Aug 10');
  });
});

describe('waterfallSegments', () => {
  it('sums back to the payload total_expected', () => {
    const ledger = [
      row({ item_id: '1', status: 'matched', expected_amount: 500, received_amount: 500, fee_amount: 0 }),
      row({ item_id: '2', status: 'matched_net', expected_amount: 300, received_amount: 290, fee_amount: 10 }),
      row({ item_id: '3', status: 'pending', expected_amount: 200, received_amount: 0, fee_amount: 0 }),
      row({ item_id: '4', status: 'short', expected_amount: 100, received_amount: 40, fee_amount: 0 }),
    ];
    const segments = waterfallSegments(report(ledger));
    const total = segments.reduce((sum, s) => sum + s.amount, 0);
    expect(total).toBeCloseTo(1100, 5);
    expect(segments.find((s) => s.key === 'deposited')?.amount).toBeCloseTo(790, 5);
    expect(segments.find((s) => s.key === 'settling')?.amount).toBeCloseTo(200, 5);
    expect(segments.find((s) => s.key === 'fees')?.amount).toBeCloseTo(10, 5);
    expect(segments.find((s) => s.key === 'needs_review')?.amount).toBeCloseTo(100, 5);
  });
});

describe('formatBusinessDate', () => {
  it('renders a business_date as month and day, with no timezone shift', () => {
    expect(formatBusinessDate('2026-08-04')).toBe('Aug 4');
    expect(formatBusinessDate('2026-01-01')).toBe('Jan 1');
    expect(formatBusinessDate('2026-12-31')).toBe('Dec 31');
  });

  it('falls back to the raw string on an unexpected shape', () => {
    expect(formatBusinessDate('not-a-date')).toBe('not-a-date');
    expect(formatBusinessDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('causeLabel', () => {
  it('always reads unknown for the card-rail MVP (no evidence field yet)', () => {
    expect(causeLabel({ status_reason: null })).toBe('unknown');
    expect(causeLabel({ status_reason: 'rule_error' })).toBe('unknown');
  });
});

describe('deposit match source defaults', () => {
  it('marks focus and toast as measured, with no suggested-values note', () => {
    expect(DEPOSIT_MATCH_SOURCE_DEFAULTS.focus.measured).toBe(true);
    expect(DEPOSIT_MATCH_SOURCE_DEFAULTS.toast.measured).toBe(true);
    expect(ruleDefaultsNote('focus')).toBeUndefined();
    expect(ruleDefaultsNote('toast')).toBeUndefined();
  });

  it('marks the rest unmeasured, with the suggested-values note', () => {
    for (const source of ['square', 'revel', 'shift4', 'clover']) {
      expect(DEPOSIT_MATCH_SOURCE_DEFAULTS[source].measured).toBe(false);
      expect(ruleDefaultsNote(source)).toBe(DEPOSIT_MATCH_SUGGESTED_VALUES_NOTE);
    }
  });

  it('flags clover as unsupported (no normalized card tender rows)', () => {
    expect(DEPOSIT_MATCH_SOURCE_DEFAULTS.clover.unsupported).toBe(true);
  });
});
