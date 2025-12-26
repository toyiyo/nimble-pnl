import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { IncomeStatement } from '@/components/financial-statements/IncomeStatement';

// Keep track of income statement data returned by useQuery mock
let currentIncomeData: any = null;

// Mock revenue breakdown hook so we can drive POS vs journal-entry paths
const mockUseRevenueBreakdown = vi.fn();
vi.mock('@/hooks/useRevenueBreakdown', () => ({
  useRevenueBreakdown: (...args: any[]) => mockUseRevenueBreakdown(...args),
}));

// Mock react-query useQuery to return deterministic data (no network/Supabase)
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (opts: any) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
      if (key === 'restaurant') {
        return { data: { name: 'Test Restaurant' }, isLoading: false };
      }
      if (key === 'income-statement') {
        return { data: currentIncomeData, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    },
  };
});

// Silence toasts during tests
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const renderIncomeStatement = () =>
  render(
    <IncomeStatement
      restaurantId="resto-1"
      dateFrom={new Date('2024-01-01')}
      dateTo={new Date('2024-01-31')}
    />
  );

describe('IncomeStatement P&L behavior', () => {
  beforeEach(() => {
    mockUseRevenueBreakdown.mockReset();
  });

  it('uses POS revenue breakdown, nets discounts/refunds, and excludes pass-through from profit', () => {
    mockUseRevenueBreakdown.mockReturnValue({
      data: {
        revenue_categories: [
          {
            account_id: 'rev-food',
            account_code: '4000',
            account_name: 'Food Sales',
            account_type: 'revenue',
            account_subtype: 'food',
            total_amount: 1200,
            transaction_count: 12,
          },
        ],
        discount_categories: [
          {
            account_id: 'disc',
            account_code: '4090',
            account_name: 'Discounts Given',
            account_type: 'revenue',
            account_subtype: 'discounts',
            total_amount: -100,
            transaction_count: 3,
          },
        ],
        refund_categories: [
          {
            account_id: 'refund',
            account_code: '4095',
            account_name: 'Refunds & Returns',
            account_type: 'revenue',
            account_subtype: 'other_income',
            total_amount: -50,
            transaction_count: 1,
          },
        ],
        tax_categories: [
          {
            account_id: 'tax',
            account_code: '2100',
            account_name: 'Sales Tax Payable',
            account_type: 'liability',
            account_subtype: 'sales_tax',
            total_amount: 120,
            transaction_count: 10,
          },
        ],
        tip_categories: [
          {
            account_id: 'tip',
            account_code: '2150',
            account_name: 'Tips Payable',
            account_type: 'liability',
            account_subtype: 'tips',
            total_amount: 80,
            transaction_count: 8,
          },
        ],
        other_liability_categories: [],
        adjustments: [],
        uncategorized_revenue: 0,
        totals: {
          total_collected_at_pos: 1450,
          gross_revenue: 1200,
          categorized_revenue: 1200,
          uncategorized_revenue: 0,
          total_discounts: 100,
          total_refunds: 50,
          net_revenue: 1050,
          sales_tax: 120,
          tips: 80,
          other_liabilities: 0,
        },
        has_categorization_data: true,
        categorization_rate: 100,
      },
      isLoading: false,
    });

    currentIncomeData = {
      revenue: [
        {
          id: 'rev-1',
          account_code: '4000',
          account_name: 'Food Sales',
          account_type: 'revenue',
          current_balance: 1200,
        },
      ],
      cogs: [
        {
          id: 'cogs-1',
          account_code: '5000',
          account_name: 'Food COGS',
          account_type: 'cogs',
          current_balance: 400,
        },
      ],
      expenses: [
        {
          id: 'exp-1',
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          current_balance: 300,
        },
      ],
    };

    renderIncomeStatement();

    // Revenue breakdown and deductions
    expect(screen.getByText('Food Sales')).toBeInTheDocument();
    expect(screen.getAllByText('$1,200.00')).toHaveLength(2); // Category + gross revenue
    expect(screen.getByText('($100.00)')).toBeInTheDocument(); // Discounts
    expect(screen.getByText('($50.00)')).toBeInTheDocument(); // Refunds
    expect(screen.getByText('Net Sales Revenue')).toBeInTheDocument();
    expect(screen.getByText('$1,050.00')).toBeInTheDocument();

    // Pass-through shown but not counted in gross/net profit
    expect(screen.getByText('Sales Tax Payable')).toBeInTheDocument();
    expect(screen.getByText('Tips Payable')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();

    // Profit math uses net revenue, not pass-through
    expect(screen.getByText('Gross Profit')).toBeInTheDocument();
    expect(screen.getByText('$650.00')).toBeInTheDocument(); // 1050 - 400
    expect(screen.getByText('Net Income')).toBeInTheDocument();
    expect(screen.getByText('$350.00')).toBeInTheDocument(); // 650 - 300
  });

  it('includes uncategorized POS revenue in net sales and profit calculations', () => {
    mockUseRevenueBreakdown.mockReturnValue({
      data: {
        revenue_categories: [
          {
            account_id: 'rev-food',
            account_code: '4000',
            account_name: 'Food Sales',
            account_type: 'revenue',
            account_subtype: 'food',
            total_amount: 1200,
            transaction_count: 12,
          },
        ],
        discount_categories: [
          {
            account_id: 'disc',
            account_code: '4090',
            account_name: 'Discounts Given',
            account_type: 'revenue',
            account_subtype: 'discounts',
            total_amount: -100,
            transaction_count: 2,
          },
        ],
        refund_categories: [],
        tax_categories: [
          {
            account_id: 'tax',
            account_code: '2100',
            account_name: 'Sales Tax Payable',
            account_type: 'liability',
            account_subtype: 'sales_tax',
            total_amount: 50,
            transaction_count: 5,
          },
        ],
        tip_categories: [
          {
            account_id: 'tip',
            account_code: '2150',
            account_name: 'Tips Payable',
            account_type: 'liability',
            account_subtype: 'tips',
            total_amount: 20,
            transaction_count: 3,
          },
        ],
        other_liability_categories: [],
        adjustments: [],
        uncategorized_revenue: 300,
        totals: {
          total_collected_at_pos: 1570, // 1500 gross + 50 tax + 20 tips
          gross_revenue: 1500, // 1200 categorized + 300 uncategorized
          categorized_revenue: 1200,
          uncategorized_revenue: 300,
          total_discounts: 100,
          total_refunds: 0,
          net_revenue: 1400, // 1500 - 100
          sales_tax: 50,
          tips: 20,
          other_liabilities: 0,
        },
        has_categorization_data: true,
        categorization_rate: 80,
      },
      isLoading: false,
    });

    currentIncomeData = {
      revenue: [
        {
          id: 'rev-1',
          account_code: '4999',
          account_name: 'Revenue Placeholder',
          account_type: 'revenue',
          current_balance: 1000, // Should be overridden by POS net revenue in calculations
        },
      ],
      cogs: [
        {
          id: 'cogs-1',
          account_code: '5000',
          account_name: 'Food COGS',
          account_type: 'cogs',
          current_balance: 500,
        },
      ],
      expenses: [
        {
          id: 'exp-1',
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          current_balance: 400,
        },
      ],
    };

    renderIncomeStatement();

    // Gross revenue reflects categorized + uncategorized
    expect(screen.getByText('Gross Revenue')).toBeInTheDocument();
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();

    // Net sales revenue nets discounts from gross (includes uncategorized)
    expect(screen.getByText('Net Sales Revenue')).toBeInTheDocument();
    expect(screen.getByText('$1,400.00')).toBeInTheDocument();

    // Profit uses net sales (1400) minus COGS/expenses
    expect(screen.getByText('Gross Profit')).toBeInTheDocument();
    expect(screen.getByText('$900.00')).toBeInTheDocument(); // 1400 - 500
    const netIncomeRow = screen.getByText('Net Income').closest('div');
    expect(netIncomeRow).not.toBeNull();
    expect(within(netIncomeRow as HTMLElement).getByText('$500.00')).toBeInTheDocument(); // 900 - 400
  });

  it('falls back to journal entries when POS breakdown is unavailable', () => {
    mockUseRevenueBreakdown.mockReturnValue({
      data: null,
      isLoading: false,
    });

    currentIncomeData = {
      revenue: [
        {
          id: 'rev-1',
          account_code: '4000',
          account_name: 'Food Sales',
          account_type: 'revenue',
          current_balance: 2000,
        },
      ],
      cogs: [
        {
          id: 'cogs-1',
          account_code: '5000',
          account_name: 'Food COGS',
          account_type: 'cogs',
          current_balance: 800,
        },
      ],
      expenses: [
        {
          id: 'exp-1',
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          current_balance: 900,
        },
      ],
    };

    renderIncomeStatement();

    // Falls back to journal revenue totals
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getAllByText('$2,000.00')).toHaveLength(2); // Category + total

    // Profit math from journal entries
    expect(screen.getByText('$1,200.00')).toBeInTheDocument(); // Gross Profit: 2000 - 800
    expect(screen.getByText('$300.00')).toBeInTheDocument(); // Net Income: 1200 - 900
    expect(screen.queryByText(/Net Sales Revenue/i)).not.toBeInTheDocument();
  });

  it('treats empty revenue breakdown as no categorization and falls back to journal totals', () => {
    mockUseRevenueBreakdown.mockReturnValue({
      data: {
        revenue_categories: [],
        discount_categories: [],
        refund_categories: [],
        tax_categories: [],
        tip_categories: [],
        other_liability_categories: [],
        adjustments: [],
        uncategorized_revenue: 0,
        totals: {
          total_collected_at_pos: 0,
          gross_revenue: 0,
          categorized_revenue: 0,
          uncategorized_revenue: 0,
          total_discounts: 0,
          total_refunds: 0,
          net_revenue: 0,
          sales_tax: 0,
          tips: 0,
          other_liabilities: 0,
        },
        has_categorization_data: false,
        categorization_rate: 0,
      },
      isLoading: false,
    });

    currentIncomeData = {
      revenue: [
        {
          id: 'rev-1',
          account_code: '4000',
          account_name: 'Food Sales',
          account_type: 'revenue',
          current_balance: 500,
        },
      ],
      cogs: [],
      expenses: [],
    };

    renderIncomeStatement();

    const totalRevenueRow = screen.getByText('Total Revenue').closest('div');
    expect(totalRevenueRow).not.toBeNull();
    expect(within(totalRevenueRow as HTMLElement).getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByText(/Net Sales Revenue/i)).not.toBeInTheDocument();
  });

  it('formats zero revenue with expenses as negative net income', () => {
    mockUseRevenueBreakdown.mockReturnValue({
      data: null,
      isLoading: false,
    });

    currentIncomeData = {
      revenue: [],
      cogs: [],
      expenses: [
        {
          id: 'exp-1',
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          current_balance: 100,
        },
      ],
    };

    renderIncomeStatement();

    const totalRevenueRow = screen.getByText('Total Revenue').closest('div');
    expect(totalRevenueRow).not.toBeNull();
    expect(within(totalRevenueRow as HTMLElement).getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    expect(screen.getAllByText('$100.00')).toHaveLength(2); // expense line + total
    const netIncomeRow = screen.getByText('Net Income').closest('div');
    expect(netIncomeRow).not.toBeNull();
    expect(within(netIncomeRow as HTMLElement).getByText('-$100.00')).toBeInTheDocument();
  });
});
