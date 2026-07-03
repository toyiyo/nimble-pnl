/**
 * Task 7a (RED phase): component tests for EnhancedCategoryRulesDialog
 * validation/copy changes driven by the supplier-assign semantics design.
 *
 * Four behaviours tested (all against the DESIRED final state — some are RED now):
 *
 * (i)  too-generic gate: "payment" + supplierId + no amount → toast.error fires
 *      RED now: current hasOtherSpecificity includes supplierId, so no error.
 *
 * (ii) short-pattern guard: 2-char pattern + amountMin set → no toast.error
 *      RED now: current guard uses !supplierId (not !amountMin), so the short
 *      pattern fires even when amountMin is set.
 *
 * (iii) inline alert suppression: only a supplier set → the "matches everything"
 *       alert does NOT render (supplier-only rule is a valid filter rule).
 *       Already GREEN on current code — regression guard.
 *
 * (iv-a) supplier help text — assign mode: description present → sub-label says
 *        "tagged with this supplier".  RED now: sub-label doesn't exist yet.
 *
 * (iv-b) supplier help text — filter mode: no description/amount → sub-label
 *        says "already linked to this supplier".  RED now: sub-label doesn't exist.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Spies (must be hoisted so they are ready before the module under test loads)
const toastErrorSpy = vi.hoisted(() => vi.fn());
const createRuleMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue({}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-test-01' },
  }),
}));

vi.mock('@/hooks/useCategorizationRulesV2', () => ({
  useCategorizationRulesV2: () => ({ data: [], isLoading: false }),
  useCreateRuleV2: () => ({
    mutateAsync: createRuleMutateAsync,
    isPending: false,
  }),
  useUpdateRuleV2: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRuleV2: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyRulesV2: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({
    suppliers: [{ id: 'sup-sygma', name: 'SYGMA Network', is_active: true }],
    createSupplier: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChartOfAccounts', () => ({
  useChartOfAccounts: () => ({ accounts: [] }),
}));

vi.mock('@/hooks/useAISuggestRules', () => ({
  useAISuggestRules: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Stub complex child components to simple test-doubles
vi.mock('@/components/SearchableSupplierSelector', () => ({
  SearchableSupplierSelector: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (v: string, isNew: boolean) => void;
  }) => (
    <div data-testid="supplier-selector" data-value={value}>
      <button
        type="button"
        data-testid="select-sygma"
        onClick={() => onValueChange('sup-sygma', false)}
      >
        Select SYGMA
      </button>
      <button
        type="button"
        data-testid="clear-supplier"
        onClick={() => onValueChange('', false)}
      >
        Clear supplier
      </button>
    </div>
  ),
}));

vi.mock('@/components/banking/SearchableAccountSelector', () => ({
  SearchableAccountSelector: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <button
      type="button"
      data-testid="account-selector"
      data-value={value}
      onClick={() => onValueChange('cat-expense-01')}
    >
      Pick category
    </button>
  ),
}));

vi.mock('@/components/banking/SplitCategoryInput', () => ({
  SplitCategoryInput: () => <div data-testid="split-category-input" />,
}));

// Radix Dialog: render its children unconditionally so form is always in DOM
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));

// ── Import component AFTER mocks are registered ───────────────────────────────
import { EnhancedCategoryRulesDialog } from '@/components/banking/EnhancedCategoryRulesDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
}

function renderDialog() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <EnhancedCategoryRulesDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Open the "Add New Rule" form so the bank fields are visible. */
async function openNewRuleForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /add new rule/i }));
}

/** Pick the category (required to enable the Create Rule button). */
async function pickCategory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('account-selector'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnhancedCategoryRulesDialog — submit-gate + inline-alert + supplier help text', () => {
  /**
   * (i) too-generic gate: "payment" + supplier + no amount → toast.error fires.
   *
   * After the fix, hasOtherSpecificity will NOT include supplierId.  So a rule
   * with a generic description and a supplier (but no amount) should still be
   * rejected.
   *
   * RED on current code: current hasOtherSpecificity = supplierId || …, so the
   * error is suppressed when a supplier is set.
   */
  it('(i) rejects a too-generic pattern even when a supplier is set (no amount)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await openNewRuleForm(user);
    await pickCategory(user);

    // Type a generic description
    await user.type(
      screen.getByPlaceholderText(/e\.g\., Sysco/i),
      'payment',
    );

    // Select a supplier
    await user.click(screen.getByTestId('select-sygma'));

    // Submit
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    expect(toastErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('too generic'),
    );
    // After fix the error copy is "Add an amount range", not "Add a supplier or amount range"
    expect(toastErrorSpy).toHaveBeenCalledWith(
      expect.not.stringContaining('Add a supplier'),
    );
  });

  /**
   * (ii) short-pattern guard: 2-char pattern + amountMin set → no toast.error.
   *
   * After the fix, the short-pattern guard becomes
   *   descPattern.length < 3 && !amountMin && !amountMax
   * so an amount range exempts a short pattern.
   *
   * RED on current code: guard is `!supplierId`, so setting amountMin doesn't
   * exempt the short pattern; toast.error fires.
   */
  it('(ii) exempts a short pattern from the guard when amountMin is set', async () => {
    const user = userEvent.setup();
    renderDialog();

    await openNewRuleForm(user);
    await pickCategory(user);

    // Type a 2-char pattern (triggers short-pattern guard on current code)
    await user.type(screen.getByPlaceholderText(/e\.g\., Sysco/i), 'SC');

    // Set a min amount (should exempt the short pattern after the fix)
    // Both Min and Max inputs share placeholder "0.00"; grab the first (Min Amount)
    await user.type(screen.getAllByPlaceholderText('0.00')[0], '50');

    // Submit (no supplier set, so the generic-pattern gate won't fire)
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    // After fix: no toast.error should fire for the short-pattern guard
    const shortPatternCall = toastErrorSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].toLowerCase().includes('too short'),
    );
    expect(shortPatternCall).toBeUndefined();
  });

  /**
   * (iii) inline alert suppression: only a supplier is set → the
   * "matches everything" warning alert must NOT render.
   *
   * A supplier-only rule is a valid, specific filter rule — the alert would be
   * a false alarm.  Already passes on current code (regression guard).
   */
  it('(iii) does not show the matches-everything alert when only a supplier is set', async () => {
    const user = userEvent.setup();
    renderDialog();

    await openNewRuleForm(user);

    // Leave description empty, select a supplier only
    await user.click(screen.getByTestId('select-sygma'));

    // The "Add a pattern, supplier, or amount range" / generic warning alert
    // should not appear — a supplier-only rule is specific enough.
    expect(screen.queryByText(/add a pattern, supplier, or amount range/i)).toBeNull();
  });

  /**
   * (iv-a) supplier help text — assign mode: when a description pattern is
   * present, the sub-label below the supplier selector should say something
   * about tagging the supplier on matching transactions.
   *
   * RED on current code: this sub-label does not exist yet.
   */
  it('(iv-a) shows "tagged with this supplier" help text when description is present', async () => {
    const user = userEvent.setup();
    renderDialog();

    await openNewRuleForm(user);

    // Type a description so we're in "assign" mode
    await user.type(screen.getByPlaceholderText(/e\.g\., Sysco/i), 'SYGMA');

    // After the fix a sub-label should appear below the supplier selector
    expect(
      screen.getByText(/tagged with this supplier/i),
    ).toBeTruthy();
  });

  /**
   * (iv-b) supplier help text — filter mode: when no description/amount is
   * set, the sub-label should say something about matching only transactions
   * already linked to that supplier.
   *
   * RED on current code: this sub-label does not exist yet.
   */
  it('(iv-b) shows "already linked to this supplier" help text when supplier-only', async () => {
    const user = userEvent.setup();
    renderDialog();

    await openNewRuleForm(user);

    // No description, no amount — supplier-only → filter mode
    // The sub-label should reflect the "filter" semantic
    expect(
      screen.getByText(/already linked to this supplier/i),
    ).toBeTruthy();
  });
});
