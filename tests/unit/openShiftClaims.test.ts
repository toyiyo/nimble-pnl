/**
 * Unit Tests: Open Shift Claims Logic
 *
 * Tests pure functions and data-shaping logic related to open shift claims:
 * - Filtering claims by status
 * - Claim status label derivation
 * - Spots label computation based on open_spots count
 *
 * These mirror the logic in AvailableShiftsPage.tsx and
 * the TradeApprovalQueue.tsx pending claims section.
 */

import { describe, it, expect } from 'vitest';
import type { OpenShiftClaim } from '@/types/scheduling';

// ---- Helpers mirroring component logic ----

/** Returns claims that need manager action (status === 'pending_approval'). */
function getPendingClaims(claims: OpenShiftClaim[]): OpenShiftClaim[] {
  return claims.filter((c) => c.status === 'pending_approval');
}

/** Human-readable label for the spots remaining. */
function spotsLabel(openSpots: number): string {
  return openSpots === 1 ? '1 spot left' : `${openSpots} spots left`;
}

/**
 * Derive the display variant of a claim status — maps to badge colour.
 * Returns 'approved' | 'rejected' | 'cancelled' | 'pending'
 */
function claimStatusVariant(status: OpenShiftClaim['status']): string {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

// ---- Test fixtures ----

function makeClaim(overrides: Partial<OpenShiftClaim> = {}): OpenShiftClaim {
  return {
    id: 'claim-1',
    restaurant_id: 'rest-1',
    shift_template_id: 'tpl-1',
    shift_date: '2026-04-18',
    claimed_by_employee_id: 'emp-1',
    status: 'pending_approval',
    resulting_shift_id: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-04-11T10:00:00Z',
    updated_at: '2026-04-11T10:00:00Z',
    ...overrides,
  };
}

// ---- Tests ----

describe('getPendingClaims', () => {
  it('returns empty array when no claims', () => {
    expect(getPendingClaims([])).toEqual([]);
  });

  it('filters to only pending_approval claims', () => {
    const claims = [
      makeClaim({ id: 'c1', status: 'pending_approval' }),
      makeClaim({ id: 'c2', status: 'approved' }),
      makeClaim({ id: 'c3', status: 'rejected' }),
      makeClaim({ id: 'c4', status: 'pending_approval' }),
    ];
    const result = getPendingClaims(claims);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c4']);
  });

  it('returns empty array when all claims are resolved', () => {
    const claims = [
      makeClaim({ status: 'approved' }),
      makeClaim({ status: 'rejected' }),
      makeClaim({ status: 'cancelled' }),
    ];
    expect(getPendingClaims(claims)).toHaveLength(0);
  });
});

describe('spotsLabel', () => {
  it('uses singular "1 spot left"', () => {
    expect(spotsLabel(1)).toBe('1 spot left');
  });

  it('uses plural for multiple spots', () => {
    expect(spotsLabel(2)).toBe('2 spots left');
    expect(spotsLabel(5)).toBe('5 spots left');
  });

  it('handles zero spots', () => {
    expect(spotsLabel(0)).toBe('0 spots left');
  });
});

describe('claimStatusVariant', () => {
  it('maps approved to "approved"', () => {
    expect(claimStatusVariant('approved')).toBe('approved');
  });

  it('maps rejected to "rejected"', () => {
    expect(claimStatusVariant('rejected')).toBe('rejected');
  });

  it('maps cancelled to "cancelled"', () => {
    expect(claimStatusVariant('cancelled')).toBe('cancelled');
  });

  it('maps pending_approval to "pending"', () => {
    expect(claimStatusVariant('pending_approval')).toBe('pending');
  });
});

describe('OpenShiftClaim data shape', () => {
  it('is created with all required fields', () => {
    const claim = makeClaim();
    expect(claim.id).toBeTruthy();
    expect(claim.restaurant_id).toBeTruthy();
    expect(claim.shift_template_id).toBeTruthy();
    expect(claim.shift_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(claim.claimed_by_employee_id).toBeTruthy();
    expect(['pending_approval', 'approved', 'rejected', 'cancelled']).toContain(claim.status);
  });

  it('allows overriding individual fields', () => {
    const approved = makeClaim({ status: 'approved', reviewed_by: 'mgr-1' });
    expect(approved.status).toBe('approved');
    expect(approved.reviewed_by).toBe('mgr-1');
  });

  it('preserves shift_template_id from fixtures', () => {
    const claim = makeClaim({ shift_template_id: 'tpl-special' });
    expect(claim.shift_template_id).toBe('tpl-special');
  });

  it('defaults resulting_shift_id to null', () => {
    const claim = makeClaim();
    expect(claim.resulting_shift_id).toBeNull();
  });

  it('can be given a resulting_shift_id when approved', () => {
    const claim = makeClaim({ status: 'approved', resulting_shift_id: 'shift-99' });
    expect(claim.resulting_shift_id).toBe('shift-99');
  });
});
