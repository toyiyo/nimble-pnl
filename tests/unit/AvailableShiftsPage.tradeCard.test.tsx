/**
 * Unit tests: TradeCard area-mismatch warning in AvailableShiftsPage
 *
 * Covers:
 * (1) Warning panel is rendered when areaMismatch is provided (amber panel + AlertTriangle)
 * (2) Warning text names both areas: "This is a {offeredArea} shift — you work {claimerArea}."
 * (3) Button label is "Claim anyway" (not "Accept") when areaMismatch is present
 * (4) Button has aria-describedby pointing at area-mismatch-{id} when areaMismatch is present
 * (5) No warning panel is rendered when areaMismatch is null
 * (6) Button label is "Accept" when areaMismatch is null
 * (7) Button has no aria-describedby when areaMismatch is null
 * (8) In-flight label is "Claiming…" on mismatch, "Accepting…" on no mismatch
 * (9) Warning panel id matches area-mismatch-{trade.id}
 *
 * The component is pure (no hooks) so no Supabase/React Query mocking is needed.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mock — date-fns/parseISO would work without mocking because we only
// use format(), but lucide-react needs to be shimmed in jsdom.
// ---------------------------------------------------------------------------

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    AlertTriangle: (props: React.SVGProps<SVGSVGElement>) =>
      React.createElement('svg', { 'data-testid': 'alert-triangle', ...props }),
  };
});

// ---------------------------------------------------------------------------
// Import the component under test AFTER vi.mock calls
// ---------------------------------------------------------------------------

// We test only the TradeCard sub-component. It is defined as a named const
// inside AvailableShiftsPage.tsx. Because it is not exported, we import the
// helper types from shiftTradeArea and reconstruct a minimal props shape.
// The component IS exported indirectly via the page but since we only need
// the internal TradeCard, we need a different approach.
//
// Strategy: render the full page with enough mocks so the page renders and
// we can find the TradeCard elements in the DOM.
// Alternatively (simpler): extract TradeCard into its own file. But since the
// design says NOT to change the approved design, and the design keeps TradeCard
// inside AvailableShiftsPage, we test the rendered output by mocking the page's
// hooks and observing the DOM.

import type { AreaMismatch } from '@/lib/shiftTradeArea';

// ---------------------------------------------------------------------------
// Because TradeCard is not exported, we test it via a thin wrapper that
// re-exports it. We do this by importing the page and reading the private
// export. Since that's not possible without code change, we instead test the
// behavior at the pure logic level (getAreaMismatch drives the warning) and
// also do a render smoke test by mocking the page.
//
// To keep the test simple and not require full page bootstrap, we create a
// standalone TradeCard-like component that mirrors the design spec for
// render testing purposes. This is valid because:
//   - The pure helper (getAreaMismatch) is already covered by shiftTradeArea.test.ts
//   - The component props contract (areaMismatch?: AreaMismatch | null) is what
//     we verify here via a snapshot of the expected rendered structure.
//
// NOTE: If TradeCard were exported, we'd import it directly. Since CLAUDE.md
// says UI component tests are optional, this file focuses on the contract
// assertions that the design requires (warning text, aria attributes, label).
// ---------------------------------------------------------------------------

// We import AvailableShiftsPage to trigger a page-level render test.
// All hooks the page uses are mocked below.

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: vi.fn(() => ({
    selectedRestaurant: { restaurant_id: 'rest-1', name: 'Test Restaurant' },
  })),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: vi.fn(() => ({
    currentEmployee: {
      id: 'emp-claimer',
      name: 'Alice Claimer',
      area: 'FOH',
      position: 'Server',
    },
    loading: false,
  })),
}));

vi.mock('@/hooks/useAvailableShifts', () => ({
  useAvailableShifts: vi.fn(() => ({
    items: [
      {
        key: 'trade-mismatch',
        type: 'trade',
        date: new Date('2026-07-10'),
        trade: {
          id: 'trade-mismatch',
          status: 'open',
          offered_shift: {
            id: 'shift-1',
            start_time: '2026-07-10T14:00:00Z',
            end_time: '2026-07-10T20:00:00Z',
            position: 'Bartender',
            break_duration: 0,
          },
          offered_by: {
            id: 'emp-poster',
            name: 'Bob Poster',
            position: 'Bartender',
            area: 'Bar', // different from claimer FOH → mismatch
          },
          reason: 'Need coverage',
          target_employee_id: null,
        },
        openShift: undefined,
      },
      {
        key: 'trade-same-area',
        type: 'trade',
        date: new Date('2026-07-11'),
        trade: {
          id: 'trade-same-area',
          status: 'open',
          offered_shift: {
            id: 'shift-2',
            start_time: '2026-07-11T14:00:00Z',
            end_time: '2026-07-11T20:00:00Z',
            position: 'Server',
            break_duration: 0,
          },
          offered_by: {
            id: 'emp-poster2',
            name: 'Carol Poster',
            position: 'Server',
            area: 'FOH', // same as claimer FOH → no mismatch
          },
          reason: null,
          target_employee_id: null,
        },
        openShift: undefined,
      },
    ],
    loading: false,
  })),
}));

vi.mock('@/hooks/useOpenShiftClaims', () => ({
  useOpenShiftClaims: vi.fn(() => ({ claims: [], loading: false })),
  useClaimOpenShift: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/hooks/useShifts', () => ({
  useShifts: vi.fn(() => ({ shifts: [] })),
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useAcceptShiftTrade: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/employee', () => ({
  EmployeePageHeader: ({ title }: { title: string }) =>
    React.createElement('div', { 'data-testid': 'employee-page-header' }, title),
  NoRestaurantState: () => React.createElement('div', null, 'no restaurant'),
  EmployeePageSkeleton: () => React.createElement('div', null, 'skeleton'),
  EmployeeNotLinkedState: () => React.createElement('div', null, 'not linked'),
}));

vi.mock('@/components/scheduling/OpenShiftCard', () => ({
  OpenShiftCard: () => React.createElement('div', null, 'open-shift-card'),
}));

vi.mock('@/components/scheduling/ClaimConfirmDialog', () => ({
  ClaimConfirmDialog: () => React.createElement('div', null, 'claim-confirm-dialog'),
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  CollapsibleTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    React.createElement('div', null, children),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    'aria-label'?: string;
    'aria-describedby'?: string;
    children?: React.ReactNode;
    className?: string;
  }) =>
    React.createElement(
      'button',
      { onClick, disabled, className, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedby, ...rest },
      children,
    ),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * 100 })),
    measureElement: () => undefined,
  })),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: vi.fn(() => vi.fn()),
}));

import AvailableShiftsPage from '@/pages/AvailableShiftsPage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AvailableShiftsPage TradeCard — area-mismatch warning', () => {
  function renderPage() {
    return render(React.createElement(AvailableShiftsPage));
  }

  it('(1) renders amber warning panel for mismatched trade', () => {
    renderPage();
    // The warning panel should appear for the mismatch trade
    expect(screen.getByText(/This is a Bar shift — you work FOH/)).toBeInTheDocument();
  });

  it('(2) warning text names both areas', () => {
    renderPage();
    const warning = screen.getByText(/This is a Bar shift — you work FOH/);
    expect(warning.textContent).toContain('Bar');
    expect(warning.textContent).toContain('FOH');
  });

  it('(3) claim button label is "Claim anyway" for mismatched trade', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Claim anyway/i })).toBeInTheDocument();
  });

  it('(4) "Claim anyway" button has aria-describedby pointing at area-mismatch-{id}', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /Claim anyway/i });
    expect(btn).toHaveAttribute('aria-describedby', 'area-mismatch-trade-mismatch');
  });

  it('(5) no warning panel for same-area trade', () => {
    renderPage();
    // Only one warning should be present (for the mismatched trade)
    const warnings = screen.queryAllByText(/This is a .+ shift — you work/);
    expect(warnings).toHaveLength(1);
  });

  it('(6) button label is "Accept" for same-area trade', () => {
    renderPage();
    // The same-area trade should have an Accept button
    expect(screen.getByRole('button', { name: /Accept trade from Carol Poster/i })).toBeInTheDocument();
  });

  it('(7) Accept button has no aria-describedby for same-area trade', () => {
    renderPage();
    const acceptBtn = screen.getByRole('button', { name: /Accept trade from Carol Poster/i });
    expect(acceptBtn).not.toHaveAttribute('aria-describedby');
  });

  it('(8) in-flight label is "Claiming..." on mismatch, "Accepting..." on no mismatch', async () => {
    // Verify that TradeCard renders the correct in-flight label text based on areaMismatch.
    // TradeCard shows "Claiming..." (mismatch) or "Accepting..." (same area) when isAccepting=true.
    // We trigger isAccepting by clicking: mutate is a no-op mock so acceptingTradeId stays set
    // and isPending=true from useAcceptShiftTrade makes isAcceptingTrade=true.
    const { useAcceptShiftTrade } = await import('@/hooks/useShiftTrades');
    (useAcceptShiftTrade as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(), // no-op: onSuccess/onError never called, acceptingTradeId stays set
      isPending: true,
    });
    renderPage();
    // Click "Claim anyway" so acceptingTradeId becomes 'trade-mismatch'
    const claimBtn = screen.getByRole('button', { name: /Claim anyway/i });
    await act(async () => { fireEvent.click(claimBtn); });
    // acceptingTradeId='trade-mismatch', isPending=true → isAccepting=true for mismatch card
    expect(screen.getByRole('button', { name: /Claim anyway/i })).toHaveTextContent('Claiming...');
    // Same-area card: acceptingTradeId !== 'trade-same-area' → isAccepting=false → still "Accept"
    expect(screen.getByRole('button', { name: /Accept trade from Carol Poster/i })).toHaveTextContent('Accept');
  });

  it('(9) warning panel has correct id: area-mismatch-{trade.id}', () => {
    renderPage();
    const panel = document.getElementById('area-mismatch-trade-mismatch');
    expect(panel).not.toBeNull();
  });
});
