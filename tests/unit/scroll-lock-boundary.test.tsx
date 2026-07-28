import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The module under test does not exist yet (this is the RED step for plan
// Task 4 / design §"The fix: `modal` follows the scroll-lock context").
// It must export:
//   - `ScrollLockBoundary`: a context provider component
//   - `useInsideScrollLock(): boolean`: a hook reading that context,
//     defaulting to `false` when there is no provider ancestor
import {
  ScrollLockBoundary,
  useInsideScrollLock,
} from '@/components/ui/scroll-lock-boundary';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { SearchablePOSItemSelector } from '@/components/SearchablePOSItemSelector';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
import { SearchableLocationSelector } from '@/components/SearchableLocationSelector';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { PositionCombobox } from '@/components/PositionCombobox';
import { LocationCombobox } from '@/components/LocationCombobox';
import { AreaCombobox } from '@/components/AreaCombobox';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';

// Four of the eight comboboxes (PositionCombobox, LocationCombobox,
// AreaCombobox, SearchableAccountSelector) fetch their own data via a
// React Query hook rather than taking it as a prop. Mock those hooks with
// static, always-loaded data so each combobox mounts synchronously without
// a QueryClientProvider — this test cares only about the `modal` prop each
// resolves onto its Popover root, not their data-fetching behaviour (that
// is covered by each hook's own tests).
vi.mock('@/hooks/useEmployeePositions', () => ({
  useEmployeePositions: () => ({ positions: [], isLoading: false, error: null }),
}));

vi.mock('@/hooks/useInventoryLocations', () => ({
  useInventoryLocations: () => ({
    locations: [],
    isLoading: false,
    error: null,
    createLocation: vi.fn(),
    deleteLocation: vi.fn(),
    isCreating: false,
  }),
}));

vi.mock('@/hooks/useEmployeeAreas', () => ({
  useEmployeeAreas: () => ({ areas: [], isLoading: false, error: null }),
  DEFAULT_AREAS: [],
}));

vi.mock('@/hooks/useChartOfAccounts', () => ({
  useChartOfAccounts: () => ({ accounts: [], loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
  }),
}));

function ScrollLockProbe() {
  const insideScrollLock = useInsideScrollLock();
  return <div data-testid="probe">{String(insideScrollLock)}</div>;
}

describe('useInsideScrollLock', () => {
  it('is false with no provider ancestor', () => {
    render(<ScrollLockProbe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('is true directly under the ScrollLockBoundary provider', () => {
    render(
      <ScrollLockBoundary>
        <ScrollLockProbe />
      </ScrollLockBoundary>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('is true inside DialogContent', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Host dialog</DialogTitle>
          <ScrollLockProbe />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('is true inside SheetContent', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Host sheet</SheetTitle>
          <ScrollLockProbe />
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('is true inside AlertDialogContent', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Host alert dialog</AlertDialogTitle>
          <ScrollLockProbe />
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });
});

// --- Per-combobox `modal` resolution -----------------------------------
//
// `modal` is not a prop we can read back off the rendered DOM directly, so
// each case asserts a real behavioural consequence of Radix's own
// `PopoverContentModal` branch (see design "Root cause 2" / "The fix"):
// only the modal variant calls `hideOthers(content)`
// (@radix-ui/react-popover, aria-hidden package) on mount, which walks
// `document.body` and marks every node that is *not* an ancestor of the
// popover content as `aria-hidden="true"`. A sibling element placed next
// to (not inside) the combobox is therefore:
//   - left alone when the Popover opens non-modal (free-standing case,
//     `modal` must stay `false` so the six free-standing call sites in
//     the design table keep scrolling/keep their siblings visible), and
//   - marked `aria-hidden="true"` when the Popover opens modal (nested
//     case, `modal` must become `true` so the scroll-lock shard problem
//     in design "Root cause 2" is fixed).
// This is the "assert the resolved prop/behaviour, not source text"
// requirement from design's Test strategy / [2026-07-20] lesson.

type ComboboxCase = {
  name: string;
  renderCombobox: () => React.ReactElement;
};

const comboboxCases: ComboboxCase[] = [
  {
    name: 'SearchablePOSItemSelector',
    renderCombobox: () => (
      <SearchablePOSItemSelector onValueChange={vi.fn()} posItems={[]} />
    ),
  },
  {
    name: 'SearchableProductSelector',
    renderCombobox: () => (
      <SearchableProductSelector onValueChange={vi.fn()} products={[]} />
    ),
  },
  {
    name: 'SearchableLocationSelector',
    renderCombobox: () => (
      <SearchableLocationSelector onValueChange={vi.fn()} locations={[]} />
    ),
  },
  {
    name: 'SearchableSupplierSelector',
    renderCombobox: () => (
      <SearchableSupplierSelector onValueChange={vi.fn()} suppliers={[]} />
    ),
  },
  {
    name: 'PositionCombobox',
    renderCombobox: () => (
      <PositionCombobox restaurantId="rest-1" value="" onValueChange={vi.fn()} />
    ),
  },
  {
    name: 'LocationCombobox',
    renderCombobox: () => (
      <LocationCombobox restaurantId="rest-1" value="" onValueChange={vi.fn()} />
    ),
  },
  {
    name: 'AreaCombobox',
    renderCombobox: () => (
      <AreaCombobox restaurantId="rest-1" value="" onValueChange={vi.fn()} />
    ),
  },
  {
    name: 'SearchableAccountSelector',
    renderCombobox: () => <SearchableAccountSelector onValueChange={vi.fn()} />,
  },
];

describe.each(comboboxCases)('$name — modal resolution', ({ renderCombobox }) => {
  it('resolves modal={false} free-standing (page siblings stay visible while open)', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="page-sibling">page content</div>
        {renderCombobox()}
      </div>,
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByTestId('page-sibling')).not.toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('resolves modal={true} inside a DialogContent (dialog siblings get hidden while open)', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Host dialog</DialogTitle>
          <div data-testid="dialog-sibling">dialog content</div>
          {renderCombobox()}
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('combobox'));

    // aria-hidden's `hideOthers` (node_modules/aria-hidden/dist/es2019/index.js
    // `deep()`) stops descending as soon as it hits a branch that isn't an
    // ancestor of the kept node, and sets `aria-hidden="true"` on that
    // branch's *root* only — it does not walk into the branch to tag every
    // descendant individually. Verified empirically: with `dialog-sibling`
    // nested inside `DialogContent`, the attribute lands on the
    // `role="dialog"` element (the boundary `hideOthers` stopped at), not on
    // `dialog-sibling` itself, even though `dialog-sibling` is hidden from
    // the accessibility tree by inheritance. So the correct assertion is
    // "hidden by some aria-hidden ancestor (or itself)", not "has the
    // attribute directly" — matching how a screen reader actually treats it.
    expect(
      screen.getByTestId('dialog-sibling').closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});
