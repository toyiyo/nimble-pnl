import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { QuickProductFixDialog } from '@/components/prep/QuickProductFixDialog';

const product = {
  id: 'p1',
  name: 'Onion White',
  cost_per_unit: 6.46,
  uom_purchase: 'lb',
  size_value: 1,
  size_unit: 'lb',
};

describe('QuickProductFixDialog', () => {
  it('submits updated fields', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <QuickProductFixDialog
        open
        onOpenChange={() => undefined}
        product={product}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/Unit Cost/i), { target: { value: '7.25' } });
    fireEvent.change(screen.getByLabelText(/Purchase Unit/i), { target: { value: 'lb' } });
    fireEvent.change(screen.getByLabelText(/Size Value/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Size Unit/i), { target: { value: 'lb' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('p1', {
        cost_per_unit: 7.25,
        uom_purchase: 'lb',
        size_value: 1,
        size_unit: 'lb',
      });
    });
  });
});
