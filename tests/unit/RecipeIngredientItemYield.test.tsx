import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { RecipeIngredientItem } from '@/components/RecipeIngredientItem';
import type { Product } from '@/hooks/useProducts';

// The unit-conversion math is covered by tests/unit/recipeYield.test.ts.
// Here computeLineCost is mocked so the UI test only checks what the row
// shows for a given yield result.
const computeLineCost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/recipeYield', async () => {
  const actual = await vi.importActual<typeof import('@/lib/recipeYield')>('@/lib/recipeYield');
  return { ...actual, computeLineCost };
});

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    restaurant_id: 'rest-1',
    sku: 'SKU-1',
    name: 'Sweet Cream Mix',
    uom_purchase: 'fl oz',
    cost_per_unit: 0.066,
    size_value: 1,
    size_unit: 'fl oz',
    yield_pct: 90,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Product;
}

function Harness({
  product,
  yieldOverride,
  onValueChange,
}: {
  product: Product;
  yieldOverride: number | null;
  onValueChange?: (value: number | null) => void;
}) {
  const form = useForm({
    defaultValues: {
      ingredients: [
        {
          product_id: product.id,
          quantity: 5,
          unit: 'fl oz',
          notes: '',
          yield_pct_override: yieldOverride,
        },
      ],
    },
  });

  const watched = form.watch('ingredients.0.yield_pct_override');
  React.useEffect(() => {
    onValueChange?.(watched ?? null);
  }, [watched, onValueChange]);

  return (
    <Form {...form}>
      <RecipeIngredientItem
        index={0}
        control={form.control}
        products={[product]}
        onRemove={vi.fn()}
        showConversionDetails={false}
        toggleConversionDetails={vi.fn()}
        measurementUnits={['fl oz', 'oz', 'each']}
      />
    </Form>
  );
}

describe('RecipeIngredientItem yield field', () => {
  it('shows the inherit chip and the loaded cost when no override is set', () => {
    computeLineCost.mockReturnValue({
      portionCost: 0.33,
      loadedCost: 0.37,
      wasteCost: 0.04,
      yieldPct: 90,
      source: 'product',
      loadedQty: 5.56,
    });

    render(<Harness product={makeProduct()} yieldOverride={null} />);

    expect(screen.getByText('90% from product')).toBeInTheDocument();
    expect(screen.getByText(/Uses 5.56 fl oz from inventory per sale/)).toBeInTheDocument();
    expect(screen.getByText(/portion \$0\.33/)).toBeInTheDocument();
    expect(screen.getByText('$0.37')).toBeInTheDocument();
    expect(screen.queryByText('Low yield — review')).not.toBeInTheDocument();
  });

  it('shows the override chip with the product value when an override is set', () => {
    computeLineCost.mockReturnValue({
      portionCost: 0.33,
      loadedCost: 0.39,
      wasteCost: 0.06,
      yieldPct: 85,
      source: 'override',
      loadedQty: 5.88,
    });

    render(<Harness product={makeProduct()} yieldOverride={85} />);

    expect(screen.getByText('85% override · product 90%')).toBeInTheDocument();
    expect(screen.getByText('$0.39')).toBeInTheDocument();
  });

  it('flags a low yield below 80% with the warning token', () => {
    computeLineCost.mockReturnValue({
      portionCost: 0.33,
      loadedCost: 0.44,
      wasteCost: 0.11,
      yieldPct: 75,
      source: 'override',
      loadedQty: 6.67,
    });

    render(<Harness product={makeProduct()} yieldOverride={75} />);

    const warning = screen.getByText('Low yield — review');
    expect(warning).toBeInTheDocument();
    expect(warning.className).toContain('text-warning');
  });

  it('gives null when the yield field is cleared', async () => {
    computeLineCost.mockReturnValue({
      portionCost: 0.33,
      loadedCost: 0.39,
      wasteCost: 0.06,
      yieldPct: 85,
      source: 'override',
      loadedQty: 5.88,
    });

    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(<Harness product={makeProduct()} yieldOverride={85} onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Yield percent for Sweet Cream Mix');
    await user.clear(input);
    input.blur();

    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });
});
