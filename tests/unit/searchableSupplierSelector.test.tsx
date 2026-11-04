import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { Supplier } from '@/hooks/useSuppliers';

const suppliers: Supplier[] = [
  {
    id: 'a3f1c2d4-1111-4a2b-8c3d-9e0f12345678',
    restaurant_id: 'rest-1',
    name: 'Sysco Foods',
    contact_email: null,
    contact_phone: null,
    address: null,
    website: null,
    notes: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const UNMATCHED_UUID = '11111111-2222-3333-4444-555555555555';

describe('SearchableSupplierSelector — trigger label', () => {
  it('shows the staged new name with the (new) suffix when showNewIndicator is true', () => {
    render(
      <SearchableSupplierSelector
        value="Acme Meats"
        onValueChange={() => {}}
        suppliers={suppliers}
        showNewIndicator
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Acme Meats');
    expect(combo).toHaveTextContent('(new)');
  });

  it('shows the staged new name without the (new) suffix when showNewIndicator is false', () => {
    render(
      <SearchableSupplierSelector
        value="Acme Meats"
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Acme Meats');
    expect(combo).not.toHaveTextContent('(new)');
  });

  it('shows the supplier name when value matches a fixture supplier id', () => {
    render(
      <SearchableSupplierSelector
        value={suppliers[0].id}
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Sysco Foods');
  });

  it('shows the placeholder when value is a UUID not in the fixture', () => {
    render(
      <SearchableSupplierSelector
        value={UNMATCHED_UUID}
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Search suppliers...');
  });

  it('shows pendingNewName when value is the new_supplier sentinel', () => {
    render(
      <SearchableSupplierSelector
        value="new_supplier"
        pendingNewName="OCR Vendor"
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('OCR Vendor');
  });

  it('shows the placeholder when value is empty', () => {
    render(
      <SearchableSupplierSelector
        value=""
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Search suppliers...');
  });

  it('shows the placeholder when value is space-only', () => {
    render(
      <SearchableSupplierSelector
        value="   "
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Search suppliers...');
  });

  it('renders the staged-name span with the text-primary class', () => {
    render(
      <SearchableSupplierSelector
        value="Acme Meats"
        onValueChange={() => {}}
        suppliers={suppliers}
      />,
    );
    const combo = screen.getByRole('combobox');
    const stagedSpan = combo.querySelector('.text-primary');
    expect(stagedSpan).not.toBeNull();
    expect(stagedSpan).toHaveTextContent('Acme Meats');
  });

  it('renders the Clear supplier button for a staged name and clears on click', () => {
    const onValueChange = vi.fn();
    render(
      <SearchableSupplierSelector
        value="Acme Meats"
        onValueChange={onValueChange}
        suppliers={suppliers}
      />,
    );
    const clearButton = screen.getByRole('button', { name: 'Clear supplier' });
    clearButton.click();
    expect(onValueChange).toHaveBeenCalledWith('', false);
  });
});
