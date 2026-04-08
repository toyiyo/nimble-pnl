import { describe, it, expect } from 'vitest';
import { computeLinkedInfo } from '@/lib/bankTransactionLinkedInfo';

describe('computeLinkedInfo', () => {
  it('returns null when no linked data exists', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toBeNull();
  });

  it('returns null for empty linked_outflows array', () => {
    const result = computeLinkedInfo({
      linked_outflows: [],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toBeNull();
  });

  it('returns check info from linked outflow with payment_method=check', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: 'Accounting services',
        reference_number: '5',
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'check',
      badge: 'Check #5',
      vendor: 'Brand LLC',
      detail: 'Accounting services',
    });
  });

  it('returns ACH info from linked outflow with payment_method=ach', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Sysco Foods',
        notes: 'Weekly delivery payment',
        reference_number: 'ACH-1234',
        payment_method: 'ach',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'ach',
      badge: 'ACH',
      vendor: 'Sysco Foods',
      detail: 'Weekly delivery payment',
    });
  });

  it('returns other payment info from linked outflow with payment_method=other', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Office Depot',
        notes: 'Supplies',
        reference_number: null,
        payment_method: 'other',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'other',
      badge: 'Payment',
      vendor: 'Office Depot',
      detail: 'Supplies',
    });
  });

  it('returns invoice info from expense_invoice_upload', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: {
        vendor_name: 'ACME Corp',
        invoice_number: 'INV-2026-042',
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result).toEqual({
      type: 'invoice',
      badge: 'Invoice',
      vendor: 'ACME Corp',
      detail: 'INV-2026-042',
    });
  });

  it('returns invoice info with null invoice_number', () => {
    const result = computeLinkedInfo({
      linked_outflows: null,
      expense_invoice_upload: {
        vendor_name: 'ACME Corp',
        invoice_number: null,
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result).toEqual({
      type: 'invoice',
      badge: 'Invoice',
      vendor: 'ACME Corp',
      detail: null,
    });
  });

  it('prefers linked_outflow over expense_invoice_upload when both exist', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: 'From outflow',
        reference_number: '10',
        payment_method: 'check',
      }],
      expense_invoice_upload: {
        vendor_name: 'Brand LLC',
        invoice_number: 'INV-001',
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result?.type).toBe('check');
    expect(result?.detail).toBe('From outflow');
  });

  it('handles check with no reference_number', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: null,
        reference_number: null,
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toEqual({
      type: 'check',
      badge: 'Check',
      vendor: 'Brand LLC',
      detail: null,
    });
  });

  it('returns null when all fields are undefined (empty object)', () => {
    const result = computeLinkedInfo({});
    expect(result).toBeNull();
  });

  it('excludes voided outflows', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Voided Vendor',
        notes: 'Should not show',
        reference_number: '99',
        payment_method: 'check',
        status: 'voided',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result).toBeNull();
  });

  it('picks the most recently created outflow when multiple exist', () => {
    const result = computeLinkedInfo({
      linked_outflows: [
        {
          vendor_name: 'Old Vendor',
          notes: 'First',
          reference_number: '1',
          payment_method: 'check',
          status: 'pending',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          vendor_name: 'New Vendor',
          notes: 'Second',
          reference_number: '2',
          payment_method: 'check',
          status: 'cleared',
          created_at: '2026-02-01T00:00:00Z',
        },
      ],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result?.vendor).toBe('New Vendor');
    expect(result?.badge).toBe('Check #2');
  });

  it('falls back to invoice when all outflows are voided', () => {
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Voided',
        notes: null,
        reference_number: null,
        payment_method: 'check',
        status: 'voided',
      }],
      expense_invoice_upload: {
        vendor_name: 'Invoice Vendor',
        invoice_number: 'INV-100',
      },
      expense_invoice_upload_id: 'some-uuid',
    });
    expect(result?.type).toBe('invoice');
    expect(result?.vendor).toBe('Invoice Vendor');
  });

  it('truncates long detail text to 80 chars', () => {
    const longNotes = 'A'.repeat(100);
    const result = computeLinkedInfo({
      linked_outflows: [{
        vendor_name: 'Brand LLC',
        notes: longNotes,
        reference_number: null,
        payment_method: 'check',
      }],
      expense_invoice_upload: null,
      expense_invoice_upload_id: null,
    });
    expect(result?.detail?.length).toBeLessThanOrEqual(83);
    expect(result?.detail?.endsWith('...')).toBe(true);
  });
});
