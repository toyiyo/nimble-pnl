import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

    render(<SetupDialog {...baseProps} rule={rule} ruleId={rule.id} />);
    expect(screen.getByRole('switch', { name: /turn this deposit-match rule on or off/i })).toBeChecked();
    expect(screen.getByText('CARD')).toBeInTheDocument();
    expect(screen.queryByText('WALLET')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /pos source/i })).toBeDisabled();
  });

  it('shows an error state and blocks submission when the edit target rule fails to load', () => {
    render(<SetupDialog {...baseProps} rule={null} ruleId="rule-1" ruleLoadError />);
    expect(screen.getByText(/the rule did not load/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /pos source/i })).not.toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('shows a loading skeleton instead of the form while the edit target rule is still loading', () => {
    render(<SetupDialog {...baseProps} rule={null} isLoadingRule />);
    expect(screen.getByText(/the rule is loading/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /pos source/i })).not.toBeInTheDocument();
  });

  it('disables Save and blocks the submit for an unsupported source (Clover)', async () => {
    render(<SetupDialog {...baseProps} />);
    await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'clover' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('option', { name: 'clover' }));

    expect(screen.getByText(/no normalized card-tender rows yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  describe('bank picker: mask label and suggestion panel', () => {
    const banksWithSuggestion: DepositMatchBank[] = [
      {
        connected_bank_id: 'bank-1',
        institution_name: 'Mercury',
        account_mask: '9866',
        suggested_sources: {},
      } as DepositMatchBank,
      {
        connected_bank_id: 'bank-2',
        institution_name: 'Mercury',
        account_mask: '9510',
        suggested_sources: { toast: 71 },
      } as DepositMatchBank,
    ];

    async function selectToastSource() {
      await userEvent.click(screen.getByRole('combobox', { name: /pos source/i }));
      await waitFor(() => expect(screen.getByRole('option', { name: 'toast' })).toBeInTheDocument());
      await userEvent.click(screen.getByRole('option', { name: 'toast' }));
    }

    it('shows the ••mask label and the Suggested badge on the suggested option only', async () => {
      render(<SetupDialog {...baseProps} banks={banksWithSuggestion} />);
      await selectToastSource();

      await userEvent.click(screen.getByRole('combobox', { name: /bank account/i }));
      const plainOption = await screen.findByRole('option', { name: 'Mercury ••9866' });
      const suggestedOption = screen.getByRole('option', { name: 'Mercury ••9510' });

      expect(within(suggestedOption).getByText('Suggested')).toBeInTheDocument();
      expect(within(plainOption).queryByText('Suggested')).not.toBeInTheDocument();
    });

    it('shows the amber suggestion panel when the picked bank differs from the suggestion', async () => {
      render(<SetupDialog {...baseProps} banks={banksWithSuggestion} />);
      await selectToastSource();

      expect(screen.getByRole('status')).toHaveTextContent('We see TST* deposits in Mercury ••9510.');
      expect(screen.getByRole('button', { name: /use this bank/i })).toBeInTheDocument();
    });

    it('picks the suggested bank and hides the panel when "Use this bank" is clicked', async () => {
      render(<SetupDialog {...baseProps} banks={banksWithSuggestion} />);
      await selectToastSource();

      await userEvent.click(screen.getByRole('button', { name: /use this bank/i }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /bank account/i })).toHaveTextContent('Mercury ••9510');
    });

    it('hides the panel once the suggested bank is already picked directly from the dropdown', async () => {
      render(<SetupDialog {...baseProps} banks={banksWithSuggestion} />);
      await selectToastSource();

      await userEvent.click(screen.getByRole('combobox', { name: /bank account/i }));
      await userEvent.click(await screen.findByRole('option', { name: 'Mercury ••9510' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('"Use this bank" works from the keyboard: Tab to focus, Enter to activate', async () => {
      render(<SetupDialog {...baseProps} banks={banksWithSuggestion} />);
      await selectToastSource();

      const useThisBankButton = screen.getByRole('button', { name: /use this bank/i });
      useThisBankButton.focus();
      expect(useThisBankButton).toHaveFocus();
      await userEvent.keyboard('{Enter}');

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /bank account/i })).toHaveTextContent('Mercury ••9510');
    });
  });
});
