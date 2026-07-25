import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { VirtualizedProductGrid } from '@/components/inventory/VirtualizedProductGrid';

// Minimal product matching the fields ProductCard reads. If the existing test
// file already has a factory, use that instead of this literal.
const product = {
  id: 'p1',
  name: 'Tomatoes',
  current_stock: 5,
  uom_purchase: 'kg',
  // add any other non-optional fields the component dereferences:
} as any;

function renderGrid(overrides: Record<string, any> = {}) {
  const props = {
    products: [product],
    inventoryMetrics: { productMetrics: {} },
    recipesByProduct: {},
    canDeleteProducts: true,
    onEditProduct: vi.fn(),
    onCountProduct: vi.fn(),
    onWasteProduct: vi.fn(),
    onTransferProduct: vi.fn(),
    onDeleteProduct: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <VirtualizedProductGrid {...(props as any)} />
    </MemoryRouter>,
  );
  return props;
}

describe('Count button', () => {
  it('renders one Count button per card with a per-product aria-label', () => {
    renderGrid();
    expect(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    ).toBeInTheDocument();
  });

  it('calls onCountProduct with the product when clicked', async () => {
    const props = renderGrid();
    await userEvent.click(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    );
    expect(props.onCountProduct).toHaveBeenCalledWith(product);
  });

  it('does not trigger the card-tap Edit handler when Count is clicked', async () => {
    const props = renderGrid();
    await userEvent.click(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    );
    expect(props.onEditProduct).not.toHaveBeenCalled();
  });
});
