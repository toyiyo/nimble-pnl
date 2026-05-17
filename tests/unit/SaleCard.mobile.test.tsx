import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SaleCard, SaleCardProps } from '@/components/pos-sales/SaleCard';
import { UnifiedSaleItem } from '@/types/pos';

const noop = () => {};

const baseSale: UnifiedSaleItem = {
  id: 'sale-1',
  itemName: 'Test Burger',
  quantity: 1,
  totalPrice: 12.5,
  saleDate: '2026-05-17',
  saleTime: '12:34',
  posSystem: 'manual',
  externalOrderId: 'ord-1',
  is_categorized: false,
  is_split: false,
} as UnifiedSaleItem;

const baseProps: SaleCardProps = {
  sale: baseSale,
  recipe: null,
  isSelected: false,
  isSelectionMode: false,
  isEditingCategory: false,
  accounts: [],
  canEditManualSales: true,
  onCardClick: noop,
  onCheckboxChange: noop,
  onEdit: noop,
  onDelete: noop,
  onSimulateDeduction: noop,
  onMapPOSItem: noop,
  onSetEditingCategory: noop,
  onSplit: noop,
  onSuggestRule: noop,
  onCategorize: noop,
  onNavigateToRecipe: noop,
};

describe('SaleCard — mobile responsive classes', () => {
  it('action row is always visible on mobile, hover-only at sm+', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    const html = container.innerHTML;
    expect(html).toContain('opacity-100');
    expect(html).toContain('sm:opacity-0');
    expect(html).toContain('sm:group-hover:opacity-100');
  });

  it('card padding uses px-3 on mobile and sm:px-4 at sm+', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('px-3');
    expect(root.className).toContain('sm:px-4');
  });

  it('recipe name truncation widens at sm+', () => {
    const { container } = render(
      <SaleCard
        {...baseProps}
        recipe={{ id: 'r-1', name: 'Cheeseburger Recipe', hasIngredients: true }}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain('max-w-[120px]');
    expect(html).toContain('sm:max-w-[180px]');
  });

  it('right-side amount column has min-w-[72px]', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    expect(container.innerHTML).toContain('min-w-[72px]');
  });

  it('AI suggestion panel switches from flex-col to sm:flex-row', () => {
    const saleWithSuggestion: UnifiedSaleItem = {
      ...baseSale,
      suggested_category_id: 'cat-1',
      chart_account: { id: 'acc-1', account_name: 'Food', account_code: '4000' } as any,
    } as UnifiedSaleItem;
    const { container } = render(<SaleCard {...baseProps} sale={saleWithSuggestion} />);
    const html = container.innerHTML;
    expect(html).toContain('flex-col');
    expect(html).toContain('sm:flex-row');
  });

  it('categorized badge Edit link is always visible on mobile', () => {
    const categorizedSale: UnifiedSaleItem = {
      ...baseSale,
      is_categorized: true,
      chart_account: { id: 'acc-1', account_name: 'Food', account_code: '4000' } as any,
    } as UnifiedSaleItem;
    const { container } = render(<SaleCard {...baseProps} sale={categorizedSale} />);
    const html = container.innerHTML;
    expect(html).toContain('opacity-100');
    expect(html).toContain('sm:opacity-0');
  });
});
