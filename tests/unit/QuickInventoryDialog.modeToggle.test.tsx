import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickInventoryDialog } from '@/components/QuickInventoryDialog';
import type { Product } from '@/hooks/useProducts';

// ---------------------------------------------------------------------------
// Mocks — mirrors tests/unit/QuickInventoryDialog.a11y.test.tsx so the dialog
// renders in jsdom without Radix portals/animations.
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? React.createElement('div', { role: 'dialog' }, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dialog-content' }, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dialog-header' }, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement('h2', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement('p', null, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, title, 'aria-label': ariaLabel, className }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    title?: string;
    'aria-label'?: string;
    className?: string;
  }) =>
    React.createElement(
      'button',
      { onClick, disabled, title, 'aria-label': ariaLabel, className },
      children
    ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) =>
    React.createElement('label', { htmlFor }, children),
}));

vi.mock('@/components/LocationCombobox', () => ({
  LocationCombobox: ({ value, onValueChange }: {
    value?: string;
    onValueChange?: (v: string) => void;
  }) =>
    React.createElement('input', {
      'data-testid': 'location-combobox',
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onValueChange?.(e.target.value),
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

const product = {
  id: 'p1',
  name: 'Roma Tomatoes',
  uom_purchase: 'kg',
  current_stock: 5,
  restaurant_id: 'r1',
} as Product;

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  product,
  onSave: vi.fn(),
  restaurantId: 'r1',
};

const renderDialog = (over: Partial<React.ComponentProps<typeof QuickInventoryDialog>> = {}) =>
  render(
    React.createElement(QuickInventoryDialog, {
      ...baseProps,
      mode: 'add' as const,
      ...over,
    }),
    { wrapper: createWrapper() }
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickInventoryDialog — count mode toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not render the toggle when onModeChange is omitted', () => {
    // The reconciliation call sites pass a fixed mode="add" and must keep
    // their current, non-switchable UI.
    renderDialog();
    expect(screen.queryByRole('group', { name: /count mode/i })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders the toggle when onModeChange is provided', () => {
    renderDialog({ onModeChange: vi.fn() });
    expect(
      screen.getByRole('group', { name: /count mode/i })
    ).toBeInTheDocument();
  });

  it('is keyboard navigable: single tab stop, arrow moves focus, Enter selects', async () => {
    // Regression guard for the original hand-rolled version, where BOTH options
    // were independently tabbable and arrow keys did nothing at all.
    //
    // Radix ToggleGroup uses toggle-button semantics: arrows move focus, and
    // Enter/Space commits the selection (it does not select on focus).
    const onModeChange = vi.fn();
    renderDialog({ mode: 'add', onModeChange });

    const addRadio = screen.getByRole('radio', { name: /add to stock/i });
    const setTotalRadio = screen.getByRole('radio', { name: /set total/i });

    await userEvent.tab();
    expect(addRadio).toHaveFocus();

    // Roving tabindex: exactly one option is reachable via Tab.
    expect(addRadio).toHaveAttribute('tabindex', '0');
    expect(setTotalRadio).toHaveAttribute('tabindex', '-1');

    await userEvent.keyboard('{ArrowRight}');
    expect(setTotalRadio).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onModeChange).toHaveBeenCalledWith('reconcile');
  });

  it('marks the active mode as checked', () => {
    renderDialog({ mode: 'add', onModeChange: vi.fn() });
    expect(screen.getByRole('radio', { name: /add to stock/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('radio', { name: /set total/i })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('calls onModeChange with "reconcile" when Set total is clicked', async () => {
    const onModeChange = vi.fn();
    renderDialog({ mode: 'add', onModeChange });
    await userEvent.click(screen.getByRole('radio', { name: /set total/i }));
    expect(onModeChange).toHaveBeenCalledWith('reconcile');
  });

  it('calls onModeChange with "add" when Add to stock is clicked from reconcile', async () => {
    const onModeChange = vi.fn();
    renderDialog({ mode: 'reconcile', onModeChange });
    await userEvent.click(screen.getByRole('radio', { name: /add to stock/i }));
    expect(onModeChange).toHaveBeenCalledWith('add');
  });

  it('switches the quantity label to reflect the active mode', () => {
    const { unmount } = renderDialog({ mode: 'add', onModeChange: vi.fn() });
    expect(screen.getByText(/quantity to add/i)).toBeInTheDocument();
    unmount();

    renderDialog({ mode: 'reconcile', onModeChange: vi.fn() });
    expect(screen.getByText(/total quantity/i)).toBeInTheDocument();
  });
});
