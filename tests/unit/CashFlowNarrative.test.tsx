import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashFlowNarrative } from '@/components/banking/cashflow/CashFlowNarrative';
import type { CashFlowInsight } from '@/lib/cashflowInsights';

describe('CashFlowNarrative', () => {
  it('shows each insight title and body as visible text', () => {
    const insights: CashFlowInsight[] = [
      {
        id: 'revenue-change',
        title: 'Revenue increased',
        body: 'Money in for July 2026 was $12,000, versus an average of $9,500 over the previous three months.',
      },
    ];
    render(<CashFlowNarrative insights={insights} />);

    expect(screen.getByText('Revenue increased')).toBeInTheDocument();
    expect(screen.getByText(/Money in for July 2026 was/)).toBeInTheDocument();
  });

  it('wraps a dollar amount in the body in a chip span', () => {
    const insights: CashFlowInsight[] = [
      {
        id: 'revenue-change',
        title: 'Revenue increased',
        body: 'Money in for July 2026 was $12,000, versus an average of $9,500 over the previous three months.',
      },
    ];
    render(<CashFlowNarrative insights={insights} />);

    const chip = screen.getByText('$12,000');
    expect(chip.className).toContain('bg-muted');
    expect(chip.className).toContain('rounded-md');
    expect(chip.className).toContain('px-1');
  });

  it('wraps the payee name in the body in a chip span for a top-source insight', () => {
    const insights: CashFlowInsight[] = [
      {
        id: 'top-source-change',
        title: 'Acme Distributors increased',
        body: 'Acme Distributors brought in $5,000 last month, versus an average of $3,000 over the previous three months.',
      },
    ];
    render(<CashFlowNarrative insights={insights} />);

    const payeeChip = screen.getByText('Acme Distributors', { selector: 'span' });
    expect(payeeChip.className).toContain('bg-muted');
    expect(payeeChip.className).toContain('rounded-md');
    expect(payeeChip.className).toContain('px-1');
  });

  it('always shows the trends caption', () => {
    render(<CashFlowNarrative insights={[]} />);
    expect(
      screen.getByText('Trends are generated and may include inaccuracies.')
    ).toBeInTheDocument();
  });

  it('shows a fallback line when there are no insights', () => {
    render(<CashFlowNarrative insights={[]} />);
    expect(screen.getByText(/No notable trends/)).toBeInTheDocument();
  });
});
