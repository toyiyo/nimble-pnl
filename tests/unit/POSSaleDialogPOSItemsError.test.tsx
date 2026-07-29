import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { POSSaleDialog } from '@/components/POSSaleDialog';

vi.mock('@/hooks/useUnifiedSales', () => ({
  useUnifiedSales: () => ({
    createManualSale: vi.fn(),
    createManualSaleWithAdjustments: vi.fn(),
    updateManualSale: vi.fn(),
  }),
}));

// Non-empty on purpose: recipes are what register rows with cmdk, and a
// registered row is what suppresses `CommandEmpty`.
const recipesMock = vi.fn();
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: (...args: unknown[]) => recipesMock(...args),
}));

const usePOSItemsMock = vi.fn();
vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: (...args: unknown[]) => usePOSItemsMock(...args),
}));

const RECIPES = [
  { id: 'recipe-1', name: 'House Burger', pos_item_name: 'House Burger' },
];

describe('POSSaleDialog — POS load failure is visible even when recipes exist', () => {
  beforeEach(() => {
    recipesMock.mockReset();
    usePOSItemsMock.mockReset();
    recipesMock.mockReturnValue({ recipes: RECIPES, loading: false });
  });

  it('CRITICAL: renders the failure message with a retry while recipe rows are registered', async () => {
    const refetch = vi.fn();
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: false,
      error: new Error('connection reset'),
      refetch,
    });

    const user = userEvent.setup();
    render(
      <POSSaleDialog open onOpenChange={vi.fn()} restaurantId="rest-1" editingSale={null} />
    );

    await user.click(screen.getByRole('combobox'));

    // Housing this inside `CommandEmpty` would hide it behind cmdk's
    // zero-registered-items rule: the recipe row above keeps the count at one,
    // so the dropdown would look like an ordinary list that merely happens to
    // omit POS items -- inviting the user to create a duplicate of an item
    // that already exists in the POS.
    expect(
      screen.getByText(/couldn't load pos items/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows no failure message when the POS fetch succeeded', async () => {
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const user = userEvent.setup();
    render(
      <POSSaleDialog open onOpenChange={vi.fn()} restaurantId="rest-1" editingSale={null} />
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/couldn't load pos items/i)).not.toBeInTheDocument();

    // Pins the premise of the test above: with a recipe row registered,
    // cmdk's `CommandEmpty` does not render at all. Anything housed inside it
    // -- as the failure message once was -- is unreachable on this path.
    expect(screen.queryByText('Start typing to search or create')).not.toBeInTheDocument();
  });

  it('shows the spinner rather than the failure message while the retry is in flight', async () => {
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: true,
      error: new Error('connection reset'),
      refetch: vi.fn(),
    });

    const user = userEvent.setup();
    render(
      <POSSaleDialog open onOpenChange={vi.fn()} restaurantId="rest-1" editingSale={null} />
    );

    await user.click(screen.getByRole('combobox'));

    // React Query keeps the previous `error` set while the refetch runs, so
    // gating on `error` alone would show "something went wrong" on top of a
    // request that may well be about to succeed.
    expect(screen.queryByText(/couldn't load pos items/i)).not.toBeInTheDocument();
  });
});
