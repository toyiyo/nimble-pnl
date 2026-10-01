import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { SizePackagingSection } from '@/components/SizePackagingSection';

const useProductRecipeUsageCount = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useProductRecipeUsageCount', () => ({
  useProductRecipeUsageCount,
}));

function Harness({ yieldPct }: { yieldPct: number }) {
  const form = useForm({
    defaultValues: {
      name: 'Sweet Cream Mix',
      size_value: 128,
      size_unit: 'fl oz',
      uom_purchase: 'bottle',
      yield_pct: yieldPct,
      waste_reason: '',
    },
  });

  return (
    <Form {...form}>
      <SizePackagingSection form={form} restaurantId="rest-1" productId="product-1" />
    </Form>
  );
}

describe('SizePackagingSection product yield fields', () => {
  it('shows the Usable yield field and the Waste reason field', () => {
    useProductRecipeUsageCount.mockReturnValue({ count: 3, isLoading: false, isError: false });

    render(<Harness yieldPct={100} />);

    expect(screen.getByLabelText('Usable yield')).toBeInTheDocument();
    expect(screen.getByLabelText('Waste reason')).toBeInTheDocument();
  });

  it('shows a low-yield hint under 80%', () => {
    useProductRecipeUsageCount.mockReturnValue({ count: 3, isLoading: false, isError: false });

    render(<Harness yieldPct={75} />);

    const warning = screen.getByText('Low yield — review');
    expect(warning).toBeInTheDocument();
    expect(warning.className).toContain('text-warning');
  });

  it('hides the low-yield hint at 100%', () => {
    useProductRecipeUsageCount.mockReturnValue({ count: 0, isLoading: false, isError: false });

    render(<Harness yieldPct={100} />);

    expect(screen.queryByText('Low yield — review')).not.toBeInTheDocument();
  });

  it('shows the recipe usage count', () => {
    useProductRecipeUsageCount.mockReturnValue({ count: 5, isLoading: false, isError: false });

    render(<Harness yieldPct={100} />);

    expect(screen.getByText('Used in 5 recipes.')).toBeInTheDocument();
  });
});
