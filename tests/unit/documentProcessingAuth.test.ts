/**
 * Tests for the caller check and the source rules that `process-receipt`
 * and `process-bank-statement` share.
 *
 * Design: docs/superpowers/specs/2026-10-26-document-processing-auth-design.md
 */
import { describe, it, expect, vi } from 'vitest';
import {
  authorizeDocumentRequest,
  bytesToDataUrl,
  isAllowedStorageUrl,
  isInlineDataUrl,
  isRestaurantStoragePath,
  BANK_STATEMENT_PROCESS_ROLES,
  RECEIPT_PROCESS_ROLES,
  type DocumentAuthDeps,
} from '../../supabase/functions/_shared/documentProcessingAuth';

const SUPABASE_URL = 'https://abc123.supabase.co';
const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

describe('isAllowedStorageUrl', () => {
  it('accepts a signed URL on the project storage host', () => {
    expect(
      isAllowedStorageUrl(
        `${SUPABASE_URL}/storage/v1/object/sign/receipt-images/${RESTAURANT_ID}/a.pdf?token=x`,
        SUPABASE_URL,
      ),
    ).toBe(true);
  });

  it.each([
    ['another host', 'https://evil.example.com/storage/v1/object/sign/x.pdf'],
    ['a look-alike host', 'https://abc123.supabase.co.evil.com/storage/v1/object/x.pdf'],
    ['localhost', 'https://localhost/storage/v1/object/x.pdf'],
    ['a loopback IP', 'https://127.0.0.1/storage/v1/object/x.pdf'],
    ['the metadata IP', 'https://169.254.169.254/latest/meta-data/'],
    ['the metadata IP with a storage path', 'https://169.254.169.254/storage/v1/object/x.pdf'],
    ['plain http on the project host', 'http://abc123.supabase.co/storage/v1/object/x.pdf'],
    ['user info', 'https://user:pass@abc123.supabase.co/storage/v1/object/x.pdf'],
    ['a different port', 'https://abc123.supabase.co:8443/storage/v1/object/x.pdf'],
    ['a path outside storage', 'https://abc123.supabase.co/rest/v1/receipt_imports'],
    ['a dot-dot escape from storage', 'https://abc123.supabase.co/storage/v1/../rest/v1/x'],
    ['a file URL', 'file:///etc/passwd'],
    ['a bad string', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedStorageUrl(url, SUPABASE_URL)).toBe(false);
  });

  it('rejects every URL when the project URL is not https', () => {
    expect(
      isAllowedStorageUrl('http://kong:8000/storage/v1/object/x.pdf', 'http://kong:8000'),
    ).toBe(false);
  });

  it('rejects every URL when the project URL is missing or bad', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/x.pdf`;
    expect(isAllowedStorageUrl(url, '')).toBe(false);
    expect(isAllowedStorageUrl(url, 'nope')).toBe(false);
  });
});

describe('isInlineDataUrl', () => {
  it('accepts a base64 image or PDF data URL', () => {
    expect(isInlineDataUrl('data:image/jpeg;base64,AAAA', ['image/', 'application/pdf'])).toBe(true);
    expect(isInlineDataUrl('data:application/pdf;base64,JVBE', ['application/pdf'])).toBe(true);
  });

  it('rejects a MIME type that is not on the list', () => {
    expect(isInlineDataUrl('data:text/html;base64,PGh0bWw+', ['image/'])).toBe(false);
    expect(isInlineDataUrl('data:image/png;base64,AAAA', ['application/pdf'])).toBe(false);
  });

  it('rejects a URL and a data URL without base64', () => {
    expect(isInlineDataUrl('https://example.com/a.png', ['image/'])).toBe(false);
    expect(isInlineDataUrl('data:image/png,AAAA', ['image/'])).toBe(false);
  });

  it('rejects a value that is not a string', () => {
    expect(isInlineDataUrl(undefined, ['image/'])).toBe(false);
    expect(isInlineDataUrl(42, ['image/'])).toBe(false);
  });
});

describe('isRestaurantStoragePath', () => {
  it('accepts a receipt path and a bank statement path', () => {
    expect(isRestaurantStoragePath(`${RESTAURANT_ID}/1700000000-Sysco_inv.pdf`, RESTAURANT_ID)).toBe(true);
    expect(
      isRestaurantStoragePath(`${RESTAURANT_ID}/bank-statements/1700000000-chase.pdf`, RESTAURANT_ID),
    ).toBe(true);
  });

  it('rejects a path of a different tenant', () => {
    expect(isRestaurantStoragePath(`${OTHER_RESTAURANT_ID}/a.pdf`, RESTAURANT_ID)).toBe(false);
  });

  it.each([
    ['a dot-dot segment', `${RESTAURANT_ID}/../${OTHER_RESTAURANT_ID}/a.pdf`],
    ['a dot segment', `${RESTAURANT_ID}/./a.pdf`],
    ['an empty segment', `${RESTAURANT_ID}//a.pdf`],
    ['a leading slash', `/${RESTAURANT_ID}/a.pdf`],
    ['a backslash', `${RESTAURANT_ID}/..\\a.pdf`],
    ['a percent escape', `${RESTAURANT_ID}/%2e%2e/a.pdf`],
    ['a query string', `${RESTAURANT_ID}/a.pdf?x=1`],
    ['a fragment', `${RESTAURANT_ID}/a.pdf#x`],
    ['a full URL', `https://abc123.supabase.co/storage/v1/object/${RESTAURANT_ID}/a.pdf`],
    ['the folder only', `${RESTAURANT_ID}/`],
    ['a prefix match on a longer id', `${RESTAURANT_ID}x/a.pdf`],
  ])('rejects %s', (_label, path) => {
    expect(isRestaurantStoragePath(path, RESTAURANT_ID)).toBe(false);
  });

  it('rejects an empty value, a missing restaurant, and a non-string', () => {
    expect(isRestaurantStoragePath('', RESTAURANT_ID)).toBe(false);
    expect(isRestaurantStoragePath(`${RESTAURANT_ID}/a.pdf`, '')).toBe(false);
    expect(isRestaurantStoragePath(null, RESTAURANT_ID)).toBe(false);
  });
});

describe('bytesToDataUrl', () => {
  it('encodes bytes as a base64 data URL', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4');
    expect(bytesToDataUrl(bytes, 'application/pdf')).toBe('data:application/pdf;base64,JVBERi0xLjQ=');
  });

  it('encodes input that is larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).fill(65);
    const result = bytesToDataUrl(bytes, 'application/pdf');
    const decoded = atob(result.replace('data:application/pdf;base64,', ''));
    expect(decoded.length).toBe(100_000);
    expect(decoded.startsWith('AAAA')).toBe(true);
  });
});

type Row = { restaurant_id: string; raw_file_url: string | null };

function makeDeps(overrides: Partial<DocumentAuthDeps<Row>> = {}): DocumentAuthDeps<Row> {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    loadRecord: vi.fn().mockResolvedValue({ restaurant_id: RESTAURANT_ID, raw_file_url: 'x' }),
    getMembershipRole: vi.fn().mockResolvedValue('manager'),
    ...overrides,
  };
}

describe('authorizeDocumentRequest', () => {
  const base = {
    authHeader: 'Bearer user-jwt',
    recordId: 'receipt-1',
    allowedRoles: RECEIPT_PROCESS_ROLES,
  };

  it('allows a member with an upload role and returns the row', async () => {
    const deps = makeDeps();
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toEqual({
      ok: true,
      userId: 'user-1',
      record: { restaurant_id: RESTAURANT_ID, raw_file_url: 'x' },
    });
    expect(deps.getUser).toHaveBeenCalledWith('user-jwt');
    expect(deps.loadRecord).toHaveBeenCalledWith('receipt-1');
    expect(deps.getMembershipRole).toHaveBeenCalledWith('user-1', RESTAURANT_ID);
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['a header without Bearer', 'user-jwt'],
    ['an empty Bearer token', 'Bearer '],
  ])('returns 401 for %s and does not load the row', async (_label, authHeader) => {
    const deps = makeDeps();
    const result = await authorizeDocumentRequest({ ...base, authHeader }, deps);
    expect(result).toMatchObject({ ok: false, status: 401, error: 'Authentication required' });
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.loadRecord).not.toHaveBeenCalled();
  });

  it('returns 401 when the token has no user (for example the anon key)', async () => {
    const deps = makeDeps({ getUser: vi.fn().mockResolvedValue(null) });
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(deps.loadRecord).not.toHaveBeenCalled();
  });

  it('returns 400 when the record id is missing', async () => {
    const deps = makeDeps();
    const result = await authorizeDocumentRequest({ ...base, recordId: '' }, deps);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(deps.loadRecord).not.toHaveBeenCalled();
  });

  it('returns 404 when the row does not exist', async () => {
    const deps = makeDeps({ loadRecord: vi.fn().mockResolvedValue(null) });
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toMatchObject({ ok: false, status: 404, error: 'Document not found' });
    expect(deps.getMembershipRole).not.toHaveBeenCalled();
  });

  it('returns the same 404 when the user is not a member of the row restaurant', async () => {
    const deps = makeDeps({ getMembershipRole: vi.fn().mockResolvedValue(null) });
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toMatchObject({ ok: false, status: 404, error: 'Document not found' });
  });

  it('returns 403 for a member whose role cannot upload', async () => {
    const deps = makeDeps({ getMembershipRole: vi.fn().mockResolvedValue('staff') });
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('applies the narrower bank statement role list', async () => {
    const deps = makeDeps({ getMembershipRole: vi.fn().mockResolvedValue('operations_manager') });
    const receipt = await authorizeDocumentRequest(base, deps);
    const bank = await authorizeDocumentRequest(
      { ...base, allowedRoles: BANK_STATEMENT_PROCESS_ROLES },
      deps,
    );
    expect(receipt.ok).toBe(true);
    expect(bank).toMatchObject({ ok: false, status: 403 });
  });

  it('returns a generic 500 when a dependency throws, and logs the detail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ loadRecord: vi.fn().mockRejectedValue(new Error('db password leaked')) });
    const result = await authorizeDocumentRequest(base, deps);
    expect(result).toEqual({ ok: false, status: 500, error: 'Authorization check failed' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('role lists', () => {
  it('match the RLS policies that let the UI create the rows', () => {
    expect([...RECEIPT_PROCESS_ROLES].sort()).toEqual(
      ['collaborator_operations_manager', 'manager', 'operations_manager', 'owner'],
    );
    expect([...BANK_STATEMENT_PROCESS_ROLES].sort()).toEqual(['manager', 'owner']);
  });
});
