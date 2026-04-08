import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpenseSuggestionBanner } from '../../src/components/budget/ExpenseSuggestionBanner';
import type { ExpenseSuggestion } from '../../src/types/operatingCosts';

const mockSuggestion: ExpenseSuggestion = {
  id: 'abc-landlord:rent',
  payeeName: 'ABC Landlord',
  suggestedName: 'Rent / Lease',
  costType: 'fixed',
  monthlyAmount: 350000, // $3,500.00 in cents
  confidence: 0.9,
  source: 'bank',
  matchedMonths: 3,
};

function makeSuggestion(overrides: Partial<ExpenseSuggestion> = {}): ExpenseSuggestion {
  return { ...mockSuggestion, ...overrides };
}

describe('ExpenseSuggestionBanner', () => {
  it('renders suggestion with payee name and amount', () => {
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText('ABC Landlord')).toBeTruthy();
    expect(screen.getByText(/\$3,500/)).toBeTruthy();
    expect(screen.getByText(/Rent \/ Lease/)).toBeTruthy();
  });

  it('calls onAccept with suggestion when Add to Budget clicked', () => {
    const onAccept = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={onAccept}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add to budget/i }));
    expect(onAccept).toHaveBeenCalledWith(mockSuggestion);
  });

  it('calls onSnooze with suggestion id when Not Now clicked', () => {
    const onSnooze = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={onSnooze}
        onDismiss={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onSnooze).toHaveBeenCalledWith('abc-landlord:rent');
  });

  it('calls onDismiss with suggestion id when Dismiss clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ExpenseSuggestionBanner
        suggestions={[mockSuggestion]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('abc-landlord:rent');
  });

  it('shows max 3 suggestions with Show N more link', () => {
    const suggestions: ExpenseSuggestion[] = [
      makeSuggestion({ id: 's1', payeeName: 'Vendor A' }),
      makeSuggestion({ id: 's2', payeeName: 'Vendor B' }),
      makeSuggestion({ id: 's3', payeeName: 'Vendor C' }),
      makeSuggestion({ id: 's4', payeeName: 'Vendor D' }),
      makeSuggestion({ id: 's5', payeeName: 'Vendor E' }),
    ];

    render(
      <ExpenseSuggestionBanner
        suggestions={suggestions}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    // Only 3 "Add to Budget" buttons should be visible
    const addButtons = screen.getAllByRole('button', { name: /add to budget/i });
    expect(addButtons).toHaveLength(3);

    // "Show 2 more" link should be visible
    expect(screen.getByText(/show 2 more/i)).toBeTruthy();
  });

  it('renders nothing when suggestions array is empty', () => {
    const { container } = render(
      <ExpenseSuggestionBanner
        suggestions={[]}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows all suggestions after clicking Show N more', () => {
    const suggestions: ExpenseSuggestion[] = [
      makeSuggestion({ id: 's1', payeeName: 'Vendor A' }),
      makeSuggestion({ id: 's2', payeeName: 'Vendor B' }),
      makeSuggestion({ id: 's3', payeeName: 'Vendor C' }),
      makeSuggestion({ id: 's4', payeeName: 'Vendor D' }),
      makeSuggestion({ id: 's5', payeeName: 'Vendor E' }),
    ];

    render(
      <ExpenseSuggestionBanner
        suggestions={suggestions}
        onAccept={vi.fn()}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    // Click "Show 2 more"
    fireEvent.click(screen.getByText(/show 2 more/i));

    // Now all 5 "Add to Budget" buttons should be visible
    const addButtons = screen.getAllByRole('button', { name: /add to budget/i });
    expect(addButtons).toHaveLength(5);

    // "Show N more" link should be gone
    expect(screen.queryByText(/show \d+ more/i)).toBeNull();
  });
});
