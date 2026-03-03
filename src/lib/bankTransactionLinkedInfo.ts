import type { PaymentMethod } from '@/types/pending-outflows';

export interface LinkedInfoInput {
  linked_outflows?: Array<{
    vendor_name: string;
    notes: string | null;
    reference_number: string | null;
    payment_method: PaymentMethod;
  }> | null;
  expense_invoice_upload?: {
    vendor_name: string | null;
    invoice_number: string | null;
  } | null;
  expense_invoice_upload_id?: string | null;
}

export interface LinkedInfoResult {
  type: 'check' | 'ach' | 'invoice' | 'other';
  badge: string;
  vendor: string | null;
  detail: string | null;
}

const MAX_DETAIL_LENGTH = 80;

function truncate(text: string | null): string | null {
  if (!text) return null;
  if (text.length <= MAX_DETAIL_LENGTH) return text;
  return text.slice(0, MAX_DETAIL_LENGTH) + '...';
}

export function computeLinkedInfo(input: LinkedInfoInput): LinkedInfoResult | null {
  const outflow = input.linked_outflows?.[0];

  if (outflow) {
    const method = outflow.payment_method;

    if (method === 'check') {
      return {
        type: 'check',
        badge: outflow.reference_number ? `Check #${outflow.reference_number}` : 'Check',
        vendor: outflow.vendor_name,
        detail: truncate(outflow.notes),
      };
    }

    if (method === 'ach') {
      return {
        type: 'ach',
        badge: 'ACH',
        vendor: outflow.vendor_name,
        detail: truncate(outflow.notes),
      };
    }

    return {
      type: 'other',
      badge: 'Payment',
      vendor: outflow.vendor_name,
      detail: truncate(outflow.notes),
    };
  }

  if (input.expense_invoice_upload_id && input.expense_invoice_upload) {
    return {
      type: 'invoice',
      badge: 'Invoice',
      vendor: input.expense_invoice_upload.vendor_name,
      detail: truncate(input.expense_invoice_upload.invoice_number),
    };
  }

  return null;
}
