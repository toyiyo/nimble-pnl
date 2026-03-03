import type { PaymentMethod } from '@/types/pending-outflows';

export interface LinkedOutflow {
  vendor_name: string;
  notes: string | null;
  reference_number: string | null;
  payment_method: PaymentMethod;
  status?: string;
  created_at?: string;
}

export interface LinkedInfoInput {
  linked_outflows?: LinkedOutflow[] | null;
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

/**
 * Pick the most relevant outflow: exclude voided, sort by created_at desc for determinism.
 */
function pickOutflow(outflows: LinkedOutflow[] | null | undefined): LinkedOutflow | undefined {
  if (!outflows || outflows.length === 0) return undefined;
  const active = outflows.filter(o => o.status !== 'voided');
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  // Deterministic: most recently created first
  return active.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
}

export function computeLinkedInfo(input: LinkedInfoInput): LinkedInfoResult | null {
  const outflow = pickOutflow(input.linked_outflows);

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
