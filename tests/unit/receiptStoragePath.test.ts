import { describe, it, expect } from 'vitest';
import { receiptStoragePath } from '../../supabase/functions/_shared/receiptStoragePath';

const RID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const OTHER = '6fa459ea-ee8a-3ca4-894e-db77e160355e';

describe('receiptStoragePath', () => {
  it('returns a plain path in the restaurant folder', () => {
    expect(receiptStoragePath(`${RID}/1700000000-receipt.pdf`, RID)).toBe(`${RID}/1700000000-receipt.pdf`);
  });

  it('returns a nested path in the restaurant folder', () => {
    expect(receiptStoragePath(`${RID}/expense-invoices/a.pdf`, RID)).toBe(`${RID}/expense-invoices/a.pdf`);
  });

  it('extracts the path from a full storage URL', () => {
    const url = `https://x.supabase.co/storage/v1/object/public/receipt-images/${RID}/a.png`;
    expect(receiptStoragePath(url, RID)).toBe(`${RID}/a.png`);
  });

  it('ignores the query string of a full storage URL', () => {
    const url = `https://x.supabase.co/storage/v1/object/sign/receipt-images/${RID}/a.png?token=abc`;
    expect(receiptStoragePath(url, RID)).toBe(`${RID}/a.png`);
  });

  it('accepts an upper-case restaurant id in the path', () => {
    expect(receiptStoragePath(`${RID.toUpperCase()}/a.pdf`, RID)).toBe(`${RID.toUpperCase()}/a.pdf`);
  });

  it('refuses a path in the folder of another restaurant', () => {
    expect(receiptStoragePath(`${OTHER}/a.pdf`, RID)).toBeNull();
  });

  it('refuses a full URL that points into the folder of another restaurant', () => {
    const url = `https://x.supabase.co/storage/v1/object/public/receipt-images/${OTHER}/a.pdf`;
    expect(receiptStoragePath(url, RID)).toBeNull();
  });

  it('refuses a path without a restaurant folder', () => {
    expect(receiptStoragePath('a.pdf', RID)).toBeNull();
  });

  it('refuses a path with a dot segment', () => {
    expect(receiptStoragePath(`${RID}/../${OTHER}/a.pdf`, RID)).toBeNull();
    expect(receiptStoragePath(`${RID}/./a.pdf`, RID)).toBeNull();
  });

  // The URL parser in fetch() turns these forms into a `..` segment or a `/`.
  it('refuses a percent-encoded dot segment', () => {
    expect(receiptStoragePath(`${RID}/%2e%2e/${OTHER}/a.pdf`, RID)).toBeNull();
    expect(receiptStoragePath(`${RID}/.%2E/${OTHER}/a.pdf`, RID)).toBeNull();
  });

  it('refuses a backslash', () => {
    expect(receiptStoragePath(`${RID}/..\\${OTHER}\\a.pdf`, RID)).toBeNull();
  });

  it('refuses a tab or a newline in a segment', () => {
    expect(receiptStoragePath(`${RID}/.\t./${OTHER}/a.pdf`, RID)).toBeNull();
    expect(receiptStoragePath(`${RID}/.\n./${OTHER}/a.pdf`, RID)).toBeNull();
  });

  it('refuses a path with an empty segment', () => {
    expect(receiptStoragePath(`${RID}//a.pdf`, RID)).toBeNull();
  });

  it('refuses a full URL for another bucket', () => {
    const url = `https://x.supabase.co/storage/v1/object/public/other-bucket/${RID}/a.pdf`;
    expect(receiptStoragePath(url, RID)).toBeNull();
  });

  it('refuses an empty value or an empty restaurant id', () => {
    expect(receiptStoragePath('', RID)).toBeNull();
    expect(receiptStoragePath(`${RID}/a.pdf`, '')).toBeNull();
  });
});
