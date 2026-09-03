import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SetupDialog } from '@/components/deposit-match/SetupDialog';
import type { DepositMatchBank, DepositMatchRule } from '@/types/depositMatch';

const createMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock('@/hooks/useDepositMatch', () => ({
  useCreateDepositMatchRule: () => ({ mutate: createMutate, isPending: false }),
  useUpdateDepositMatchRule: () => ({ mutate: updateMutate, isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const banks: DepositMatchBank[] = [
  { connected_bank_id: 'bank-1', institution_name: 'First Bank' } as DepositMatchBank,
];

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  restaurantId: 'restaurant-1',
  banks,
  rule: null as DepositMatchRule | null,
};

describe('SetupDialog', () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
  });

  it('starts a new rule on the first source (focus), active, with its measured card tender list', () => {
    render(<SetupDialog {...baseProps} />);
    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).toBeChecked();
    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('MC')).toBeInTheDocument();
  });

  it('switches a new Square rule to Active off by default, per the design addendum', async () => {
    render(<SetupDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'square' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'square' }));

    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).not.toBeChecked();
    expect(screen.getByText('CARD')).toBeInTheDocument();
    expect(screen.getByText('WALLET')).toBeInTheDocument();
  });

  it('switches a new Revel rule to Active off, with the production-verified raw_json code preloaded', async () => {
    render(<SetupDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'revel' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'revel' }));

    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).not.toBeChecked();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('lets the owner flip Active on for a new Square rule before saving', async () => {
    render(<SetupDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'square' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'square' }));

    const activeSwitch = screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i });
    expect(activeSwitch).not.toBeChecked();
    await userEvent.click(activeSwitch);
    expect(activeSwitch).toBeChecked();

    await userEvent.click(screen.getByRole('combobox', { name: /bank account/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'First Bank' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'First Bank' }));

    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    expect(payload.active).toBe(true);
    expect(payload.pos_source).toBe('square');
  });

  it('removes a value from the card tender list and adds a new one', async () => {
    render(<SetupDialog {...baseProps} />);
    // focus is the first source, active by default with 4 measured tenders.
    await userEvent.click(screen.getByRole('button', { name: /remove visa/i }));
    expect(screen.queryByText('Visa')).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: /new card tender value/i }), 'Diners');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('Diners')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: /bank account/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'First Bank' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'First Bank' }));

    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    expect(payload.source_config).toEqual({ card_tender_names: ['MC', 'Amex', 'Discover', 'Diners'] });
  });

  it('shows no card tender list editor for toast (a measured scalar config, not a list)', async () => {
    render(<SetupDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'toast' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'toast' }));

    expect(screen.queryByText('Card tenders')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).toBeChecked();
  });

  it('edit mode preloads the existing rule\'s active flag and source_config, source select disabled', () => {
    const rule = {
      id: 'rule-1',
      restaurant_id: 'restaurant-1',
      pos_source: 'square',
      rail: 'card',
      connected_bank_id: 'bank-1',
      settlement: 'net',
      lag_days_min: 1,
      lag_days_max: 2,
      fee_pct_min: 2.6,
      fee_pct_max: 2.9,
      amount_tolerance: 0,
      amount_tolerance_pct: 0,
      source_config: { card_source_types: ['CARD'] },
      descriptor_pattern: null,
      active: true,
      created_at: '',
      updated_at: '',
    } as DepositMatchRule;

    render(<SetupDialog {...baseProps} rule={rule} />);
    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).toBeChecked();
    expect(screen.getByText('CARD')).toBeInTheDocument();
    expect(screen.queryByText('WALLET')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /pos source/i })).toBeDisabled();
  });
});
