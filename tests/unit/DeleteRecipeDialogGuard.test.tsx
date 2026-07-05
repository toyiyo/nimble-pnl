import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deleteRecipeMock = vi.fn();
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ deleteRecipe: deleteRecipeMock }),
}));

import { DeleteRecipeDialog } from '@/components/DeleteRecipeDialog';
import type { Recipe } from '@/hooks/useRecipes';

const recipe = {
  id: 'r-1',
  restaurant_id: 'rest-1',
  name: 'Sweet Cream - pans',
  serving_size: 1,
  estimated_cost: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
} satisfies Recipe;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteRecipeDialog delete-guard behavior', () => {
  it('stays open (onClose not called) when deleteRecipe returns false', async () => {
    deleteRecipeMock.mockResolvedValue(false);
    const onClose = vi.fn();
    render(<DeleteRecipeDialog isOpen={true} onClose={onClose} recipe={recipe} />);

    await userEvent.click(screen.getByRole('button', { name: /delete recipe/i }));

    await waitFor(() => expect(deleteRecipeMock).toHaveBeenCalledWith('r-1'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when deleteRecipe returns true', async () => {
    deleteRecipeMock.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<DeleteRecipeDialog isOpen={true} onClose={onClose} recipe={recipe} />);

    await userEvent.click(screen.getByRole('button', { name: /delete recipe/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
