import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import type { Product } from '@/hooks/useProducts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Dialog primitives — render with the correct ARIA roles so we can assert
// aria-describedby / aria-label on the real DOM.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) =>
    open
      ? React.createElement('div', { role: 'dialog' }, children)
      : null,
  DialogContent: ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'dialog-content' }, children),
  DialogHeader: ({ children }: any) =>
    React.createElement('div', { 'data-testid': 'dialog-header' }, children),
  DialogTitle: ({ children }: any) =>
    React.createElement('h2', { id: 'dialog-title' }, children),
  // DialogDescription must be rendered with the correct id so aria-describedby works
  DialogDescription: ({ children, className }: any) =>
    React.createElement(
      'p',
      { id: 'dialog-description', 'data-testid': 'dialog-description', className },
      children
    ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, title, 'aria-label': ariaLabel, className }: any) =>
    React.createElement(
      'button',
      { onClick, disabled, title, 'aria-label': ariaLabel, className },
      children
    ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => React.createElement('span', { 'data-testid': 'badge' }, children),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: any) =>
    React.createElement('label', { htmlFor }, children),
}));

vi.mock('@/components/LocationCombobox', () => ({
  LocationCombobox: ({ value, onValueChange, placeholder }: any) =>
    React.createElement('input', {
      'data-testid': 'location-combobox',
      value: value ?? '',
      placeholder,
      onChange: (e: any) => onValueChange?.(e.target.value),
    }),
}));

vi.mock('@/utils/calculator', () => ({
  evaluateExpression: (expr: string) => {
    const n = parseFloat(expr);
    return isNaN(n) || n <= 0 ? null : n;
  },
  formatCalculatorResult: (n: number) => String(n),
}));

vi.mock('lucide-react', () => {
  const icon = (name: string) => () =>
    React.createElement('svg', { 'data-testid': `icon-${name}` });
  return {
    Package: icon('package'),
    Check: icon('check'),
    Plus: icon('plus'),
    Minus: icon('minus'),
    X: icon('x'),
    Divide: icon('divide'),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
};

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    name: 'Roma Tomatoes',
    brand: 'FreshFarm',
    uom_purchase: 'kg',
    current_stock: 5,
    restaurant_id: 'r1',
    gtin: '0123456789',
    sku: 'SKU-001',
    created_at: '',
    updated_at: '',
    ...over,
  } as Product);

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  product: makeProduct(),
  mode: 'add' as const,
  onSave: vi.fn(),
  restaurantId: 'r1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickInventoryDialog — accessibility', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('C1 — DialogDescription', () => {
    it('renders a DialogDescription element inside the dialog', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      expect(screen.getByTestId('dialog-description')).toBeInTheDocument();
    });

    it('DialogDescription contains the product brand when brand is present', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      const desc = screen.getByTestId('dialog-description');
      expect(desc.textContent).toContain('FreshFarm');
    });

    it('DialogDescription contains the unit-of-measure when present', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      const desc = screen.getByTestId('dialog-description');
      expect(desc.textContent).toContain('kg');
    });

    it('DialogDescription falls back gracefully when brand is absent', () => {
      const props = {
        ...defaultProps,
        product: makeProduct({ brand: undefined }),
      };

      render(React.createElement(QuickInventoryDialog, props), {
        wrapper: createWrapper(),
      });

      // Should still render a description element (not throw / be absent)
      expect(screen.getByTestId('dialog-description')).toBeInTheDocument();
    });
  });

  describe('C3 — operator aria-labels', () => {
    it('the Add (+) operator button has an aria-label', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      // Use exact match so we don't collide with the "Add 0" save button text
      const addBtn = screen.getByRole('button', { name: 'Add' });
      // We want an explicit aria-label (not just title) on the operator buttons
      expect(addBtn).toHaveAttribute('aria-label');
      expect(addBtn.getAttribute('aria-label')).toMatch(/^Add$/i);
    });

    it('the Subtract (−) operator button has an aria-label', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      const btn = screen.getByRole('button', { name: /subtract/i });
      expect(btn).toHaveAttribute('aria-label');
      expect(btn.getAttribute('aria-label')).toMatch(/subtract/i);
    });

    it('the Multiply (×) operator button has an aria-label', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      const btn = screen.getByRole('button', { name: /multiply/i });
      expect(btn).toHaveAttribute('aria-label');
      expect(btn.getAttribute('aria-label')).toMatch(/multiply/i);
    });

    it('the Divide (÷) operator button has an aria-label', () => {
      render(React.createElement(QuickInventoryDialog, defaultProps), {
        wrapper: createWrapper(),
      });

      const btn = screen.getByRole('button', { name: /divide/i });
      expect(btn).toHaveAttribute('aria-label');
      expect(btn.getAttribute('aria-label')).toMatch(/divide/i);
    });
  });
});
