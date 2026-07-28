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
