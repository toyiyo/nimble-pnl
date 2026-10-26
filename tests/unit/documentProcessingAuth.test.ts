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
  createDocumentAuthDeps,
  downloadDocumentAsDataUrl,
  isAllowedStorageUrl,
  isInlineDataUrl,
  isRestaurantStoragePath,
  BANK_STATEMENT_PROCESS_ROLES,
  DOCUMENT_BUCKET,
  RECEIPT_PROCESS_ROLES,
  type DocumentAuthDeps,
  type DocumentServiceClient,
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

// ── Supabase-backed dependencies and the storage download ───────────────────

interface FakeOptions {
  user?: { id: string } | null;
  authError?: unknown;
  rows?: Record<string, unknown>;
  rowError?: unknown;
  download?: { data: Blob | null; error: unknown } | Error;
}

function makeClient(opts: FakeOptions = {}) {
  const calls: Array<{ table: string; columns: string; filters: Array<[string, string]> }> = [];
  const downloads: Array<{ bucket: string; path: string }> = [];
  const client: DocumentServiceClient = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user === undefined ? { id: 'user-1' } : opts.user },
        error: opts.authError ?? null,
      })),
    },
    from(table: string) {
      return {
        select(columns: string) {
          const call = { table, columns, filters: [] as Array<[string, string]> };
          calls.push(call);
          const builder = {
            eq(column: string, value: string) {
              call.filters.push([column, value]);
              return builder;
            },
            async maybeSingle() {
              if (opts.rowError) return { data: null, error: opts.rowError };
              return { data: opts.rows?.[table] ?? null, error: null };
            },
          };
          return builder;
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            downloads.push({ bucket, path });
            if (opts.download instanceof Error) throw opts.download;
            return opts.download ?? { data: null, error: { message: 'not found' } };
          },
        };
      },
    },
  };
  return { client, calls, downloads };
}

describe('createDocumentAuthDeps', () => {
  it('reads the user, the row, and the membership role', async () => {
    const { client, calls } = makeClient({
      rows: {
        receipt_imports: { restaurant_id: RESTAURANT_ID, raw_file_url: 'x' },
        user_restaurants: { role: 'owner' },
      },
    });
    const deps = createDocumentAuthDeps<Row>(client, 'receipt_imports', 'restaurant_id, raw_file_url');
    expect(await deps.getUser('jwt')).toEqual({ id: 'user-1' });
    expect(client.auth.getUser).toHaveBeenCalledWith('jwt');
    expect(await deps.loadRecord('r-1')).toEqual({ restaurant_id: RESTAURANT_ID, raw_file_url: 'x' });
    expect(await deps.getMembershipRole('user-1', RESTAURANT_ID)).toBe('owner');
    expect(calls).toEqual([
      { table: 'receipt_imports', columns: 'restaurant_id, raw_file_url', filters: [['id', 'r-1']] },
      {
        table: 'user_restaurants',
        columns: 'role',
        filters: [['user_id', 'user-1'], ['restaurant_id', RESTAURANT_ID]],
      },
    ]);
  });

  it('returns null for an auth error, a missing user, a missing row, and no membership', async () => {
    expect(await createDocumentAuthDeps(makeClient({ authError: { message: 'bad jwt' } }).client, 't', 'c').getUser('x')).toBeNull();
    const deps = createDocumentAuthDeps(makeClient({ user: null }).client, 't', 'c');
    expect(await deps.getUser('x')).toBeNull();
    expect(await deps.loadRecord('r-1')).toBeNull();
    expect(await deps.getMembershipRole('u', RESTAURANT_ID)).toBeNull();
  });

  it('throws on a query error', async () => {
    const deps = createDocumentAuthDeps(makeClient({ rowError: { message: 'boom' } }).client, 't', 'c');
    await expect(deps.loadRecord('r-1')).rejects.toEqual({ message: 'boom' });
    await expect(deps.getMembershipRole('u', RESTAURANT_ID)).rejects.toEqual({ message: 'boom' });
  });
});

describe('downloadDocumentAsDataUrl', () => {
  const path = `${RESTAURANT_ID}/1700000000-inv.pdf`;
  const pdf = () => new Blob([new TextEncoder().encode('%PDF-1.4')], { type: 'application/pdf' });

  it('downloads the row path from the document bucket', async () => {
    const { client, downloads } = makeClient({ download: { data: pdf(), error: null } });
    const result = await downloadDocumentAsDataUrl(client, path, RESTAURANT_ID, 1024, 'application/pdf');
    expect(result).toEqual({ ok: true, dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=', byteLength: 8 });
    expect(downloads).toEqual([{ bucket: DOCUMENT_BUCKET, path }]);
  });

  it('does not download a path of a different tenant', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, downloads } = makeClient({ download: { data: pdf(), error: null } });
    const result = await downloadDocumentAsDataUrl(
      client,
      `${OTHER_RESTAURANT_ID}/a.pdf`,
      RESTAURANT_ID,
      1024,
      'application/pdf',
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_path' });
    expect(downloads).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('rejects a file above the size limit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeClient({ download: { data: pdf(), error: null } });
    const result = await downloadDocumentAsDataUrl(client, path, RESTAURANT_ID, 4, 'application/pdf');
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    errorSpy.mockRestore();
  });

  it('returns download_failed for a storage error and for a throw', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errored = await downloadDocumentAsDataUrl(makeClient().client, path, RESTAURANT_ID, 1024, 'application/pdf');
    const thrown = await downloadDocumentAsDataUrl(
      makeClient({ download: new Error('socket hang up') }).client,
      path,
      RESTAURANT_ID,
      1024,
      'application/pdf',
    );
    expect(errored).toEqual({ ok: false, reason: 'download_failed' });
    expect(thrown).toEqual({ ok: false, reason: 'download_failed' });
    errorSpy.mockRestore();
  });
});
