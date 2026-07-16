import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnhancedPrepRecipeDialog } from '@/components/prep/EnhancedPrepRecipeDialog';
import type { Product } from '@/hooks/useProducts';

const products: Product[] = [
  {
    id: 'prod-1',
    restaurant_id: 'rest-1',
    sku: 'SKU-1',
    name: 'Romaine Lettuce',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-2',
    restaurant_id: 'rest-1',
    sku: 'SKU-2',
    name: 'Mozzarella Cheese',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

function renderDialog() {
  return render(
    <EnhancedPrepRecipeDialog
      open={true}
      onOpenChange={() => {}}
      onSubmit={async () => {}}
      products={products}
    />,
  );
}

describe('EnhancedPrepRecipeDialog — searchable inventory dropdowns', () => {
  it('renders a searchable Output Item combobox on the Details tab', () => {
    renderDialog();

    expect(
      screen.getByRole('combobox', { name: /output item/i }),
    ).toBeInTheDocument();
  });

  it('Ingredient combobox: typing a query narrows the list and selecting an option updates the row', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('tab', { name: /ingredients/i }));

    const ingredientCombobox = screen.getByRole('combobox', { name: /ingredient 1/i });
    await user.click(ingredientCombobox);

    const searchInput = screen.getByPlaceholderText('Search inventory items...');
    await user.type(searchInput, 'Mozzarella');

    expect(screen.getByText('Mozzarella Cheese')).toBeInTheDocument();
    expect(screen.queryByText('Romaine Lettuce')).not.toBeInTheDocument();

    await user.click(screen.getByText('Mozzarella Cheese'));

    expect(
      screen.getByRole('combobox', { name: /ingredient 1/i }),
    ).toHaveTextContent('Mozzarella Cheese');
  });

  it('does not offer "+ Create New Item" or "Skip This Item" in the Output Item or Ingredient combobox', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('combobox', { name: /output item/i }));
    expect(screen.queryByText('+ Create New Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip This Item')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('tab', { name: /ingredients/i }));
    await user.click(screen.getByRole('combobox', { name: /ingredient 1/i }));
    expect(screen.queryByText('+ Create New Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip This Item')).not.toBeInTheDocument();
  });
});
