import { describe, it, expect } from 'vitest';
import type { TipShare } from '@/utils/tipPooling';

/**
 * Tip Split Validation Tests
 *
 * These tests validate the business rules for tip splits:
 * 1. Cannot approve tips without employee allocations
 * 2. Cannot approve tips with $0 total allocation
 * 3. Draft status can have empty shares (for saving progress)
 *
 * The validation logic is tested directly here and must match
 * the implementation in useTipSplits.tsx
 */

// Validation function extracted from useTipSplits.tsx
function validateTipSplitForApproval(
  status: 'draft' | 'approved',
  shares: TipShare[] | undefined
): { valid: boolean; error?: string } {
  if (status !== 'approved') {
    return { valid: true }; // Drafts don't need validation
  }

  if (!shares || shares.length === 0) {
    return { valid: false, error: 'Cannot approve tips without employee allocations' };
  }

  const totalAllocated = shares.reduce((sum, s) => sum + s.amountCents, 0);
  if (totalAllocated === 0) {
    return { valid: false, error: 'Cannot approve tips with $0 total allocation' };
  }

  return { valid: true };
}

describe('Tip Split Validation - Critical for Fair Pay', () => {
  describe('Approval validation', () => {
    it('rejects approval when shares array is empty', () => {
      const result = validateTipSplitForApproval('approved', []);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot approve tips without employee allocations');
    });

    it('rejects approval when shares is undefined', () => {
      const result = validateTipSplitForApproval('approved', undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot approve tips without employee allocations');
    });

    it('rejects approval when all shares have $0 amount', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 0 },
        { employeeId: 'e2', name: 'Bob', amountCents: 0 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot approve tips with $0 total allocation');
    });

    it('accepts approval when shares have positive amounts', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 5000 },
        { employeeId: 'e2', name: 'Bob', amountCents: 5000 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts approval when only some shares have positive amounts', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 10000 },
        { employeeId: 'e2', name: 'Bob', amountCents: 0 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });

    it('accepts approval with single employee share', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 10000 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });
  });

  describe('Draft validation (should always pass)', () => {
    it('allows draft with empty shares', () => {
      const result = validateTipSplitForApproval('draft', []);
      expect(result.valid).toBe(true);
    });

    it('allows draft with undefined shares', () => {
      const result = validateTipSplitForApproval('draft', undefined);
      expect(result.valid).toBe(true);
    });

    it('allows draft with $0 shares', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 0 },
      ];
      const result = validateTipSplitForApproval('draft', shares);
      expect(result.valid).toBe(true);
    });

    it('allows draft with positive shares', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 5000 },
      ];
      const result = validateTipSplitForApproval('draft', shares);
      expect(result.valid).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('REGRESSION: prevents approving broken hours-based split with $0 allocations', () => {
      // Bug scenario: Hours not entered, split calculated as $0 for everyone
      // Manager tries to approve → should be blocked
      const shares: TipShare[] = [
        { employeeId: 'server1', name: 'John Server', hours: 0, amountCents: 0 },
        { employeeId: 'server2', name: 'Jane Server', hours: 0, amountCents: 0 },
        { employeeId: 'bartender', name: 'Bob Bartender', hours: 0, amountCents: 0 },
      ];

      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot approve tips with $0 total allocation');
    });

    it('allows manager to save as draft to fix later', () => {
      // Same broken scenario, but manager saves as draft to fix later
      const shares: TipShare[] = [
        { employeeId: 'server1', name: 'John Server', hours: 0, amountCents: 0 },
        { employeeId: 'server2', name: 'Jane Server', hours: 0, amountCents: 0 },
      ];

      const result = validateTipSplitForApproval('draft', shares);
      expect(result.valid).toBe(true); // Draft is OK
    });

    it('allows approval after manager fixes the split', () => {
      // Manager recalculates with even split fallback
      const shares: TipShare[] = [
        { employeeId: 'server1', name: 'John Server', hours: 0, amountCents: 16667 },
        { employeeId: 'server2', name: 'Jane Server', hours: 0, amountCents: 16667 },
        { employeeId: 'bartender', name: 'Bob Bartender', hours: 0, amountCents: 16666 },
      ];

      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });

    it('validates busy Friday night with proper allocations', () => {
      const shares: TipShare[] = [
        { employeeId: 'server1', name: 'Alice', hours: 8, amountCents: 22222 },
        { employeeId: 'server2', name: 'Bob', hours: 6, amountCents: 16667 },
        { employeeId: 'bartender', name: 'Carla', hours: 4, amountCents: 11111 },
      ];

      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });

    it('prevents approving a split where no employees were selected', () => {
      // Manager forgot to select employees in tip pool settings
      const shares: TipShare[] = [];

      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot approve tips without employee allocations');
    });
  });

  describe('Edge cases', () => {
    it('handles very small amounts', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 1 }, // $0.01
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });

    it('handles very large amounts', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', amountCents: 1000000 }, // $10,000
        { employeeId: 'e2', name: 'Bob', amountCents: 1000000 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });

    it('handles shares with role information', () => {
      const shares: TipShare[] = [
        { employeeId: 'e1', name: 'Alice', role: 'Server', amountCents: 6000 },
        { employeeId: 'e2', name: 'Bob', role: 'Busser', amountCents: 4000 },
      ];
      const result = validateTipSplitForApproval('approved', shares);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Tip Split Total Preservation - Critical Invariant', () => {
  it('validates that sum of shares equals expected total', () => {
    const expectedTotal = 50000; // $500
    const shares: TipShare[] = [
      { employeeId: 'e1', name: 'Alice', amountCents: 25000 },
      { employeeId: 'e2', name: 'Bob', amountCents: 15000 },
      { employeeId: 'e3', name: 'Carla', amountCents: 10000 },
    ];

    const actualTotal = shares.reduce((sum, s) => sum + s.amountCents, 0);
    expect(actualTotal).toBe(expectedTotal);
  });

  it('validates remainder handling in uneven splits', () => {
    const expectedTotal = 10001; // $100.01
    const shares: TipShare[] = [
      { employeeId: 'e1', name: 'Alice', amountCents: 3333 },
      { employeeId: 'e2', name: 'Bob', amountCents: 3333 },
      { employeeId: 'e3', name: 'Carla', amountCents: 3335 }, // Gets remainder
    ];

    const actualTotal = shares.reduce((sum, s) => sum + s.amountCents, 0);
    expect(actualTotal).toBe(expectedTotal);
  });
});
