import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeDialog } from '@/components/RecipeDialog';

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    createRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    updateRecipeIngredients: vi.fn(),
    fetchRecipeIngredients: vi.fn(),
    calculateRecipeCost: vi.fn(),
  }),
}));

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ products: [] }),
}));

// Spy-backed mock so each test can assert exactly what RecipeDialog passes
// to usePOSItems, and control what it returns (posItems/loading/error/refetch).
const usePOSItemsMock = vi.fn();
vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: (...args: unknown[]) => usePOSItemsMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('RecipeDialog — POS item search wiring', () => {
  beforeEach(() => {
    usePOSItemsMock.mockReset();
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces the typed search term 250ms before passing it to usePOSItems', () => {
    vi.useFakeTimers();

    render(
      <RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />
    );

    // Mount call: no search term typed yet.
    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: '' });

    fireEvent.click(screen.getByText('Search POS items or leave blank').closest('button')!);
    const input = screen.getByPlaceholderText('Search POS items...');
    fireEvent.change(input, { target: { value: 'burger' } });

    // Not yet debounced — usePOSItems should still see the empty search.
    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: '' });

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: '' });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: 'burger' });
  });

  it('CRITICAL: resets the search term when the dialog is reopened', () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />
    );

    fireEvent.click(screen.getByText('Search POS items or leave blank').closest('button')!);
    fireEvent.change(screen.getByPlaceholderText('Search POS items...'), {
      target: { value: 'burger' },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: 'burger' });

    // Recipes.tsx renders this dialog unconditionally and drives it with
    // `isOpen`, so it never unmounts and the term survives the close. Without
    // an explicit reset, reopening serves the previous session's narrowed
    // list -- indistinguishable from the truncation bug this branch fixes.
    rerender(<RecipeDialog isOpen={false} onClose={vi.fn()} restaurantId="rest-1" />);
    rerender(<RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />);

    expect(usePOSItemsMock).toHaveBeenLastCalledWith('rest-1', { search: '' });
  });

  it('renders the failure empty-state and calls refetch via the retry button when usePOSItems reports an error', async () => {
    const refetch = vi.fn();
    usePOSItemsMock.mockReturnValue({
      posItems: [],
      loading: false,
      error: new Error('network down'),
      refetch,
    });

    const user = userEvent.setup();
    render(
      <RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />
    );

    await user.click(screen.getByText('Search POS items or leave blank').closest('button')!);

    expect(screen.getByText(/couldn't load pos items/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('RecipeDialog — pos_item_id follows pos_item_name', () => {
  beforeEach(() => {
    usePOSItemsMock.mockReset();
    usePOSItemsMock.mockReturnValue({
      posItems: [
        {
          item_name: 'House Burger',
          item_id: 'pos-item-1',
          source: 'pos_sales',
          sales_count: 92,
          last_sold: '2026-07-20',
        },
        {
          item_name: 'Untracked Special',
          item_id: null,
          source: 'unified_sales',
          sales_count: 4,
          last_sold: '2026-07-19',
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  const posItemIdInput = () =>
    screen.getByLabelText('POS Item ID') as HTMLInputElement;

  it('writes the selected item id into pos_item_id', async () => {
    const user = userEvent.setup();
    render(<RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />);

    await user.click(screen.getByLabelText('POS Item Name'));
    await user.click(screen.getByText('House Burger'));

    expect(posItemIdInput().value).toBe('pos-item-1');
  });

  it('CRITICAL: clears pos_item_id when the selection is cleared', async () => {
    const user = userEvent.setup();
    render(<RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />);

    await user.click(screen.getByLabelText('POS Item Name'));
    await user.click(screen.getByText('House Burger'));
    expect(posItemIdInput().value).toBe('pos-item-1');

    await user.click(screen.getByLabelText('POS Item Name'));
    await user.click(screen.getByText('Clear selection'));

    // Leaving the id behind would submit an empty pos_item_name paired with a
    // real POS id -- a recipe that maps to nothing by name but still claims
    // an item by id.
    expect(posItemIdInput().value).toBe('');
  });

  it('CRITICAL: clears pos_item_id when switching to an item that has none', async () => {
    const user = userEvent.setup();
    render(<RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />);

    await user.click(screen.getByLabelText('POS Item Name'));
    await user.click(screen.getByText('House Burger'));
    expect(posItemIdInput().value).toBe('pos-item-1');

    await user.click(screen.getByLabelText('POS Item Name'));
    await user.click(screen.getByText('Untracked Special'));

    // search_pos_items returns a NULL item_id when no contributing sale row
    // carried one. Writing only truthy ids would leave House Burger's id
    // attached to Untracked Special's name.
    expect(posItemIdInput().value).toBe('');
  });

  it('associates the POS Item Name label with the combobox trigger', () => {
    render(<RecipeDialog isOpen={true} onClose={vi.fn()} restaurantId="rest-1" />);

    // The selector's root is a Radix `Popover`, not a DOM node, so the `id`
    // that `FormControl` injects has to be forwarded onto the trigger by hand
    // or `FormLabel`'s `htmlFor` points at nothing.
    expect(screen.getByLabelText('POS Item Name')).toHaveAttribute('role', 'combobox');
  });
});
