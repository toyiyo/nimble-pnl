import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DuplicateReceiptDialog } from '@/components/receipt/DuplicateReceiptDialog';
import type { ReceiptImport } from '@/hooks/useReceiptImport';

const baseExisting: ReceiptImport = {
  id: 'r-prev',
  restaurant_id: 'rest-123',
  vendor_name: 'Sysco',
  supplier_id: null,
  raw_file_url: 'rest-123/123-r.pdf',
  file_name: 'invoice.pdf',
  file_size: 100,
  processed_at: null,
  status: 'mapped',
  total_amount: 1284.5,
  imported_total: 1284.5,
  raw_ocr_data: null,
  created_at: '2026-05-12T00:00:00Z',
  updated_at: '2026-05-12T00:00:00Z',
  processed_by: null,
  purchase_date: '2026-05-12',
  file_hash: 'abc',
};

describe('DuplicateReceiptDialog', () => {
  let onCancel: ReturnType<typeof vi.fn>;
  let onProceed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onCancel = vi.fn();
    onProceed = vi.fn();
  });

  function renderDialog(open = true, existing = baseExisting) {
    return render(
      <MemoryRouter>
        <DuplicateReceiptDialog
          open={open}
          existing={existing}
          onCancel={onCancel}
          onProceed={onProceed}
        />
      </MemoryRouter>,
    );
  }

  it('renders the existing receipt vendor and total formatted to 2 decimals', () => {
    renderDialog();
    expect(screen.getByText(/Possible duplicate receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/Sysco/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,?284\.50/)).toBeInTheDocument();
  });

  it('links to /receipt-import?receipt=<id> for the previous receipt', () => {
    renderDialog();
    const link = screen.getByRole('link', { name: /view previous receipt/i });
    expect(link).toHaveAttribute('href', '/receipt-import?receipt=r-prev');
  });

  it('fires onCancel when Cancel button clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('fires onProceed when Upload anyway clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /upload anyway/i }));
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires onCancel when Escape pressed (Radix onOpenChange)', () => {
    renderDialog();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders Cancel before Upload anyway in DOM order (Cancel is primary)', () => {
    renderDialog();
    const buttons = screen.getAllByRole('button');
    const cancelIdx = buttons.findIndex((b) => /^cancel$/i.test(b.textContent ?? ''));
    const proceedIdx = buttons.findIndex((b) => /upload anyway/i.test(b.textContent ?? ''));
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(proceedIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeLessThan(proceedIdx);
  });

  it('falls back to "Unknown vendor" when vendor_name is null', () => {
    renderDialog(true, { ...baseExisting, vendor_name: null });
    expect(screen.getByText(/unknown vendor/i)).toBeInTheDocument();
  });

  it('renders an em-dash for the total when total_amount is null', () => {
    renderDialog(true, { ...baseExisting, total_amount: null });
    expect(screen.getByText(/—/)).toBeInTheDocument();
  });

  it('falls back to "an earlier date" when created_at cannot be parsed', () => {
    renderDialog(true, { ...baseExisting, created_at: 'invalid-date' });
    expect(screen.getByText(/an earlier date/i)).toBeInTheDocument();
  });
});
