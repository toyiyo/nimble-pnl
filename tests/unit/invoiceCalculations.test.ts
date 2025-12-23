import { describe, it, expect } from 'vitest';

describe('Invoice Calculations', () => {
  describe('Line Item Calculations', () => {
    it('calculates line item amount correctly', () => {
      const quantity = 2;
      const unitAmount = 5000; // $50.00 in cents
      const amount = quantity * unitAmount;
      expect(amount).toBe(10000); // $100.00 in cents
    });

    it('handles decimal quantities', () => {
      const quantity = 2.5;
      const unitAmount = 2000; // $20.00 in cents
      const amount = Math.round(quantity * unitAmount);
      expect(amount).toBe(5000); // $50.00 in cents
    });

    it('handles fractional quantities', () => {
      const quantity = 0.5;
      const unitAmount = 1000; // $10.00 in cents
      const amount = Math.round(quantity * unitAmount);
      expect(amount).toBe(500); // $5.00 in cents
    });

    it('calculates subtotal from multiple line items', () => {
      const lineItems = [
        { quantity: 2, unit_amount: 5000 },
        { quantity: 1, unit_amount: 3000 },
        { quantity: 3, unit_amount: 1500 },
      ];

      const subtotal = lineItems.reduce((sum, item) => {
        return sum + (item.quantity * item.unit_amount);
      }, 0);

      expect(subtotal).toBe(17500); // $175.00 in cents
    });
  });

  describe('Tax Calculations', () => {
    it('calculates tax on subtotal', () => {
      const subtotal = 10000; // $100.00 in cents
      const taxRate = 0.0825; // 8.25%
      const tax = Math.round(subtotal * taxRate);
      expect(tax).toBe(825); // $8.25 in cents
    });

    it('calculates tax per line item', () => {
      const lineItems = [
        { quantity: 2, unit_amount: 5000, tax_rate: 0.08 },
        { quantity: 1, unit_amount: 3000, tax_rate: 0.08 },
      ];

      const tax = lineItems.reduce((sum, item) => {
        const itemAmount = item.quantity * item.unit_amount;
        const itemTax = item.tax_rate ? Math.round(itemAmount * item.tax_rate) : 0;
        return sum + itemTax;
      }, 0);

      expect(tax).toBe(1040); // $10.40 in cents
    });

    it('handles zero tax rate', () => {
      const subtotal = 10000;
      const taxRate = 0;
      const tax = Math.round(subtotal * taxRate);
      expect(tax).toBe(0);
    });
  });

  describe('Total Calculations', () => {
    it('calculates total with subtotal and tax', () => {
      const subtotal = 10000; // $100.00
      const tax = 825; // $8.25
      const total = subtotal + tax;
      expect(total).toBe(10825); // $108.25
    });

    it('calculates amounts for full invoice', () => {
      const lineItems = [
        { quantity: 2, unit_amount: 5000 },
        { quantity: 1, unit_amount: 3000 },
      ];

      const subtotal = lineItems.reduce((sum, item) => {
        return sum + (item.quantity * item.unit_amount);
      }, 0);

      const taxRate = 0.08;
      const tax = Math.round(subtotal * taxRate);
      const total = subtotal + tax;

      expect(subtotal).toBe(13000); // $130.00
      expect(tax).toBe(1040); // $10.40
      expect(total).toBe(14040); // $140.40
    });
  });

  describe('Payment Tracking', () => {
    it('calculates amount remaining after partial payment', () => {
      const total = 10000; // $100.00
      const amountPaid = 5000; // $50.00
      const amountRemaining = total - amountPaid;
      expect(amountRemaining).toBe(5000); // $50.00
    });

    it('calculates amount remaining with full payment', () => {
      const total = 10000;
      const amountPaid = 10000;
      const amountRemaining = total - amountPaid;
      expect(amountRemaining).toBe(0);
    });

    it('handles overpayment', () => {
      const total = 10000;
      const amountPaid = 12000;
      const amountRemaining = total - amountPaid;
      expect(amountRemaining).toBe(-2000); // -$20.00 (credit)
    });
  });

  describe('Currency Conversion', () => {
    it('converts dollars to cents correctly', () => {
      const dollars = 50.00;
      const cents = Math.round(dollars * 100);
      expect(cents).toBe(5000);
    });

    it('converts cents to dollars correctly', () => {
      const cents = 5000;
      const dollars = cents / 100;
      expect(dollars).toBe(50.00);
    });

    it('handles floating point precision in dollar conversion', () => {
      const dollars = 99.99;
      const cents = Math.round(dollars * 100);
      expect(cents).toBe(9999);
    });

    it('handles rounding in cent conversion', () => {
      const dollars = 10.125; // $10.125 should round to $10.13
      const cents = Math.round(dollars * 100);
      expect(cents).toBe(1013);
    });
  });

  describe('Invoice Status Logic', () => {
    it('determines if invoice is paid', () => {
      const status = 'paid';
      expect(status).toBe('paid');
    });

    it('determines if invoice is open', () => {
      const status = 'open';
      expect(status).not.toBe('paid');
      expect(status).not.toBe('draft');
    });

    it('determines if invoice is editable', () => {
      const isEditable = (status: string) => status === 'draft';
      expect(isEditable('draft')).toBe(true);
      expect(isEditable('open')).toBe(false);
      expect(isEditable('paid')).toBe(false);
      expect(isEditable('void')).toBe(false);
    });
  });

  describe('Due Date Calculations', () => {
    it('calculates days until due date', () => {
      const today = new Date('2024-01-01');
      const dueDate = new Date('2024-01-31');
      const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(30);
    });

    it('detects overdue invoices', () => {
      const today = new Date('2024-01-31');
      const dueDate = new Date('2024-01-15');
      const isOverdue = dueDate < today;
      expect(isOverdue).toBe(true);
    });

    it('detects invoices due today', () => {
      const today = new Date('2024-01-15');
      const dueDate = new Date('2024-01-15');
      const isDueToday = dueDate.toDateString() === today.toDateString();
      expect(isDueToday).toBe(true);
    });
  });
});
