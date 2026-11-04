import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RecipeDialog } from '@/components/RecipeDialog';
import type { Recipe } from '@/hooks/useRecipes';
import type { Product } from '@/hooks/useProducts';

// The line-cost math is covered by tests/unit/recipeYield.test.ts. Here
// computeLineCost is mocked so the tile grid test only checks what the
// dialog does with a known cost result, per design §6.2.
const computeLineCost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/recipeYield', async () => {
  const actual = await vi.importActual<typeof import('@/lib/recipeYield')>('@/lib/recipeYield');
  return { ...actual, computeLineCost };
});

const useRecipeWeeklyVolume = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useRecipeWeeklyVolume', () => ({
  useRecipeWeeklyVolume,
}));

vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({
    createRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    updateRecipeIngredients: vi.fn(),
    fetchRecipeIngredients: vi.fn().mockResolvedValue([]),
    calculateRecipeCost: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePOSItems', () => ({
  usePOSItems: () => ({ posItems: [], loading: false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    restaurant_id: 'rest-1',
    sku: 'SKU-1',
    name: 'Beef Cheek',
    uom_purchase: 'oz',
    cost_per_unit: 1,
    size_value: 1,
    size_unit: 'oz',
    yield_pct: 90,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Product;
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    restaurant_id: 'rest-1',
    name: 'Carne Guisada',
    description: '',
    pos_item_name: 'Carne Guisada Plate',
    pos_item_id: '',
    serving_size: 1,
    estimated_cost: 0,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    created_by: 'user-1',
    ...overrides,
  } as Recipe;
}

const product = makeProduct();

beforeEach(() => {
  computeLineCost.mockReset();
  computeLineCost.mockReturnValue({
    portionCost: 1,
    loadedCost: 1.25,
    wasteCost: 0.25,
    yieldPct: 80,
    source: 'product',
    loadedQty: 1.25,
  });
  useRecipeWeeklyVolume.mockReset();
  useRecipeWeeklyVolume.mockReturnValue({ weeklyVolume: 0, isLoading: false, isError: false });
});

describe('RecipeDialog cost summary tiles', () => {
  it('renders the four tiles: portion cost, waste allowance, loaded cost, food cost %', async () => {
    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        products={[product]}
        recipe={makeRecipe({ avg_sale_price: 12.5 })}
      />
    );

    await waitFor(() => expect(screen.getByText('Portion cost')).toBeInTheDocument());
    expect(screen.getByText('Waste allowance')).toBeInTheDocument();
    expect(screen.getByText('Loaded cost')).toBeInTheDocument();
    expect(screen.getByText('Food cost %')).toBeInTheDocument();
  });

  it('shows "—" for food cost % when the recipe has no avg_sale_price', async () => {
    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        products={[product]}
        recipe={makeRecipe({ avg_sale_price: undefined })}
      />
    );

    await waitFor(() => expect(screen.getByText('Food cost %')).toBeInTheDocument());
    const tile = screen.getByText('Food cost %').closest('div');
    expect(tile?.parentElement).toHaveTextContent('—');
  });

  it('shows the weekly waste-allowance line only when there is sales volume', async () => {
    useRecipeWeeklyVolume.mockReturnValue({ weeklyVolume: 530, isLoading: false, isError: false });

    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        products={[product]}
        recipe={makeRecipe({ avg_sale_price: 12.5 })}
      />
    );

    await waitFor(() => expect(screen.getByText(/per serving/i)).toBeInTheDocument());
    expect(screen.getByText(/530 sold in the last 7 days/i)).toBeInTheDocument();
  });

  it('omits the weekly volume clause when there are no sales', async () => {
    useRecipeWeeklyVolume.mockReturnValue({ weeklyVolume: 0, isLoading: false, isError: false });

    render(
      <RecipeDialog
        isOpen={true}
        onClose={vi.fn()}
        restaurantId="rest-1"
        products={[product]}
        recipe={makeRecipe({ avg_sale_price: 12.5 })}
      />
    );

    await waitFor(() => expect(screen.getByText(/per serving/i)).toBeInTheDocument());
    expect(screen.queryByText(/sold in the last 7 days/i)).not.toBeInTheDocument();
  });
});
