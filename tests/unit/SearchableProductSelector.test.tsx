import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
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
];

describe('SearchableProductSelector — showCreateOption', () => {
  it('renders "+ Create New Item" by default (guards Receipt/Recipe consumers)', async () => {
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('+ Create New Item')).toBeInTheDocument();
  });

  it('hides "+ Create New Item" when showCreateOption is false', async () => {
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
        showCreateOption={false}
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByText('+ Create New Item')).not.toBeInTheDocument();
  });

  it('omits the "Actions" group heading when both create and skip options are disabled, and still renders/filters the product list', async () => {
    const user = userEvent.setup();
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
        showCreateOption={false}
        showSkipOption={false}
      />,
    );
    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Create New Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip This Item')).not.toBeInTheDocument();
    expect(screen.getByText('Romaine Lettuce')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search products...'), 'Romaine');
    expect(screen.getByText('Romaine Lettuce')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search products...'));
    await user.type(screen.getByPlaceholderText('Search products...'), 'Nonexistent Item Zzz');
    expect(screen.queryByText('Romaine Lettuce')).not.toBeInTheDocument();
  });
});

describe('SearchableProductSelector — id/aria-label forwarding', () => {
  it('forwards id to the trigger button', () => {
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
        id="output"
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveAttribute('id', 'output');
  });

  it('forwards aria-label to the trigger button, giving the combobox an accessible name', () => {
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
        aria-label="Ingredient 1"
      />,
    );
    const combo = screen.getByRole('combobox', { name: 'Ingredient 1' });
    expect(combo).toBeInTheDocument();
  });

  it('omits id and aria-label when not provided (default behavior unchanged)', () => {
    render(
      <SearchableProductSelector
        onValueChange={() => {}}
        products={products}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo.getAttribute('id')).toBeNull();
    expect(combo.getAttribute('aria-label')).toBeNull();
  });
});
