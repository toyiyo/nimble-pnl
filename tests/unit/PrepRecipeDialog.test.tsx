import React from 'react';
import { render, screen } from '@testing-library/react';
import { PrepRecipeDialog } from '@/components/prep/PrepRecipeDialog';

describe('PrepRecipeDialog - cost preview', () => {
  it('shows per-ingredient cost and inventory deduction for a filled product', async () => {
    const products = [
      {
        id: 'p1',
        restaurant_id: 'r1',
        name: 'Vodka',
        cost_per_unit: 20, // $20 per bottle
        uom_purchase: 'bottle',
        size_value: 750,
        size_unit: 'ml',
        sku: 'VODKA-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const editingRecipe = {
      id: 'r1',
      name: 'Test Recipe',
      default_yield: 1,
      default_yield_unit: 'unit',
      ingredients: [
        { id: 'i1', product_id: 'p1', quantity: 1.5, unit: 'fl oz' },
      ],
    } as any;

    render(
      <PrepRecipeDialog
        open={true}
        onOpenChange={() => {}}
        onSubmit={async () => {}}
        products={products as any}
        editingRecipe={editingRecipe}
      />
    );

    // Expect approximate cost: 1.5 fl oz = 44.36025 ml -> 44.36/750 * $20 = $1.18
    expect(await screen.findByText(/\$1\.18/)).toBeInTheDocument();
    // Inventory deduction should show bottles with 4 decimal precision
    expect(await screen.findByText(/0\.0591 bottle/)).toBeInTheDocument();
  });

  it('shows placeholder when product is not selected', async () => {
    const products: any[] = [];
    const editingRecipe = {
      id: 'r2',
      name: 'Empty Recipe',
      default_yield: 1,
      default_yield_unit: 'unit',
      ingredients: [{ id: 'i2', product_id: '', quantity: 2, unit: 'kg' }],
    } as any;

    render(
      <PrepRecipeDialog
        open={true}
        onOpenChange={() => {}}
        onSubmit={async () => {}}
        products={products}
        editingRecipe={editingRecipe}
      />
    );

    expect(await screen.findByText(/No product selected/)).toBeInTheDocument();
  });
});
