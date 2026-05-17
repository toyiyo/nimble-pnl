import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SplitSaleView } from '@/components/pos-sales/SplitSaleView';
import { UnifiedSaleItem } from '@/types/pos';

const splitSale: UnifiedSaleItem = {
  id: 'parent-1',
  itemName: 'Combo Meal',
  quantity: 1,
  totalPrice: 25,
  saleDate: '2026-05-17',
  saleTime: '12:34',
  posSystem: 'toast',
  externalOrderId: 'ord-1',
  is_split: true,
  child_splits: [
    { id: 'child-1', itemName: 'Burger', totalPrice: 15 } as any,
    { id: 'child-2', itemName: 'Fries', totalPrice: 10 } as any,
  ],
} as UnifiedSaleItem;

describe('SplitSaleView — semantic tokens only (no direct blue colors)', () => {
  it('contains no direct blue color tokens', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bbg-blue-/);
    expect(html).not.toMatch(/\btext-blue-/);
    expect(html).not.toMatch(/\bborder-blue-/);
    expect(html).not.toMatch(/\bborder-l-blue-/);
    expect(html).not.toMatch(/dark:bg-blue-/);
    expect(html).not.toMatch(/dark:text-blue-/);
    expect(html).not.toMatch(/dark:border-blue-/);
  });

  it('uses neutral semantic left border on the card', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    expect(container.innerHTML).toContain('border-l-foreground/20');
  });

  it('uses semantic border on expanded children container', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    // toggle expansion (fireEvent wraps in act so state flushes)
    const toggle = container.querySelector('button');
    if (toggle) fireEvent.click(toggle);
    expect(container.innerHTML).toContain('border-border/40');
  });

  it('card padding tightens on mobile (p-3 sm:p-4)', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    expect(container.innerHTML).toContain('p-3');
    expect(container.innerHTML).toContain('sm:p-4');
  });
});
