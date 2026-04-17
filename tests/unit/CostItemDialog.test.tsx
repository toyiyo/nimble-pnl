import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostItemDialog } from '../../src/components/budget/CostItemDialog';
import type { CostBreakdownItem } from '../../src/types/operatingCosts';

const fixedItem: CostBreakdownItem = {
  id: 'cost-1',
  name: 'Rent',
  category: 'rent',
  daily: 100,
  monthly: 3000,
  isPercentage: false,
  source: 'manual',
};

const percentageItem: CostBreakdownItem = {
  id: 'cost-2',
  name: 'Food Cost Target',
  category: 'food_cost',
  daily: 0,
  monthly: 0,
  percentage: 28,
  isPercentage: true,
  source: 'manual',
};

describe('CostItemDialog', () => {
  it('should pre-fill name and monthly amount when editing a fixed cost item', () => {
    render(
      <CostItemDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        editingItem={fixedItem}
      />
    );

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Rent');

    const amountInput = screen.getByLabelText('Monthly Amount') as HTMLInputElement;
    expect(amountInput.value).toBe('3000.00');
  });

  it('should pre-fill name and percentage when editing a percentage cost item', () => {
    render(
      <CostItemDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        editingItem={percentageItem}
      />
    );

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Food Cost Target');

    const percentageInput = screen.getByLabelText('Percentage') as HTMLInputElement;
    expect(percentageInput.value).toBe('28');
  });

  it('should show empty fields when no editingItem is provided', () => {
    render(
      <CostItemDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        editingItem={null}
      />
    );

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('should show "Edit Cost Item" title when editing', () => {
    render(
      <CostItemDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        editingItem={fixedItem}
      />
    );

    expect(screen.getByText('Edit Cost Item')).toBeTruthy();
  });

  it('should show "Save Changes" button when editing', () => {
    render(
      <CostItemDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        editingItem={fixedItem}
      />
    );

    expect(screen.getByText('Save Changes')).toBeTruthy();
  });
});
