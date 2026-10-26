/**
 * documentProcessingAuth.ts
 *
 * Caller check and document-source rules for the `process-receipt` and
 * `process-bank-statement` edge functions. Both functions use the service
 * role, so this module is the only tenant boundary they have.
 *
 * All functions are pure or take injected dependencies, so Vitest can load
 * this file without the Deno runtime.
 *
 * Design: docs/superpowers/specs/2026-10-26-document-processing-auth-design.md
 */

/**
 * Roles that can create a `receipt_imports` row. Matches the INSERT policy in
 * 20260723120000_add_collaborator_operations_manager_role.sql.
 */
export const RECEIPT_PROCESS_ROLES: readonly string[] = [
  'owner',
  'manager',
  'operations_manager',
  'collaborator_operations_manager',
];

/**
 * Roles that can manage `bank_statement_uploads` rows. Matches the FOR ALL
 * policy in 20251118100000_add_bank_statement_uploads.sql.
 */
export const BANK_STATEMENT_PROCESS_ROLES: readonly string[] = ['owner', 'manager'];

/** The bucket that holds receipt and bank statement uploads. */
export const DOCUMENT_BUCKET = 'receipt-images';

/**
 * Largest receipt file the server encodes for the AI call. The encode keeps
 * several copies in memory, so the limit stays well below the isolate limit.
 */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** Largest bank statement file. Matches the limit in useBankStatementImport. */
export const MAX_BANK_STATEMENT_BYTES = 5 * 1024 * 1024;

/** MIME prefixes that a receipt can send inline as a data URL. */
export const RECEIPT_INLINE_MIME_PREFIXES: readonly string[] = ['image/', 'application/pdf'];

/** Time limit for one storage download. The old URL fetch used the same limit. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** A document row. Every row belongs to one restaurant. */
export type TenantRecord = { restaurant_id: string };

/**
 * True only for an https URL on the project's own host and port, with no
 * user info, whose path is under `/storage/v1/`. The functions use this
 * check to reject a foreign URL. They never fetch the URL.
 */
export function isAllowedStorageUrl(rawUrl: string, supabaseUrl: string): boolean {
  let url: URL;
  let project: URL;
  try {
    url = new URL(rawUrl);
    project = new URL(supabaseUrl);
  } catch {
    return false;
  }
  return (
    project.protocol === 'https:' &&
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.hostname === project.hostname &&
    url.port === project.port &&
    url.pathname.startsWith('/storage/v1/')
  );
}

/** True only for `data:<mime>;base64,...` where the MIME type has an allowed prefix. */
export function isInlineDataUrl(value: unknown, allowedMimePrefixes: readonly string[]): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(value);
  if (!match) return false;
  const mime = match[1].toLowerCase();
  return allowedMimePrefixes.some((prefix) => mime.startsWith(prefix));
}

/** Decoded size in bytes of a base64 data URL. */
export function inlineDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const STORAGE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * True only for a storage path inside the restaurant's own folder. The row's
 * `raw_file_url` comes from the client, and the service role can read every
 * tenant's files, so the server must check the path before a download.
 */
export function isRestaurantStoragePath(path: unknown, restaurantId: string): boolean {
  if (typeof path !== 'string' || !restaurantId) return false;
  if (!STORAGE_PATH_CHARS.test(path)) return false;
  const segments = path.split('/');
  if (segments[0] !== restaurantId || segments.length < 2) return false;
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Encode bytes as a base64 data URL. The loop works in chunks to keep the call stack small. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const chunkSize = 32768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export interface DocumentAuthDeps<TRecord extends TenantRecord> {
  /** Return the user for a JWT, or null when the token has no user. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** Return the document row, or null when it does not exist. */
  loadRecord(recordId: string): Promise<TRecord | null>;
  /** Return the user's role in the restaurant, or null when there is no membership. */
  getMembershipRole(userId: string, restaurantId: string): Promise<string | null>;
}

export interface DocumentAuthInput {
  authHeader: string | null;
  recordId: string;
  allowedRoles: readonly string[];
}

export type DocumentAuthResult<TRecord> =
  | { ok: true; userId: string; record: TRecord }
  | { ok: false; status: 400 | 401 | 403 | 404 | 500; error: string };

const NOT_FOUND = 'Document not found';

/**
 * Check that the caller is a signed-in user who can upload documents for the
 * restaurant that owns the row. A missing row and a missing membership get the
 * same 404, so a caller cannot find out if a row of a different tenant exists.
 */
export async function authorizeDocumentRequest<TRecord extends TenantRecord>(
  input: DocumentAuthInput,
  deps: DocumentAuthDeps<TRecord>,
): Promise<DocumentAuthResult<TRecord>> {
  const token = /^Bearer\s+(\S+)$/i.exec(input.authHeader ?? '')?.[1];
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  if (!input.recordId) {
    return { ok: false, status: 400, error: 'Document ID is required' };
  }

  try {
    const user = await deps.getUser(token);
    if (!user) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }

    const record = await deps.loadRecord(input.recordId);
    if (!record) {
      return { ok: false, status: 404, error: NOT_FOUND };
    }

    const role = await deps.getMembershipRole(user.id, record.restaurant_id);
    if (!role) {
      return { ok: false, status: 404, error: NOT_FOUND };
    }
    if (!input.allowedRoles.includes(role)) {
      return { ok: false, status: 403, error: 'You do not have permission to process this document' };
    }

    return { ok: true, userId: user.id, record };
  } catch (error) {
    console.error('Document authorization check failed:', error);
    return { ok: false, status: 500, error: 'Authorization check failed' };
  }
}

// ── Supabase-backed dependencies ─────────────────────────────────────────────

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown }>;

interface FilterBuilder<T> {
  eq(column: string, value: string): FilterBuilder<T>;
  maybeSingle(): QueryResult<T>;
}

/** The part of the service-role Supabase client that this module uses. */
export interface DocumentServiceClient {
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  from(table: string): { select(columns: string): FilterBuilder<unknown> };
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
}

/**
 * Build `DocumentAuthDeps` on the service-role client. A query error throws,
 * so `authorizeDocumentRequest` returns its generic 500. Keep `columns` in
 * step with the fields of `TRecord`: nothing checks the two against each other.
 */
export function createDocumentAuthDeps<TRecord extends TenantRecord>(
  supabase: DocumentServiceClient,
  table: string,
  columns: string,
): DocumentAuthDeps<TRecord> {
  return {
    async getUser(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      return { id: data.user.id };
    },
    async loadRecord(recordId) {
      const { data, error } = await supabase.from(table).select(columns).eq('id', recordId).maybeSingle();
      if (error) throw error;
      return (data as TRecord | null) ?? null;
    },
    async getMembershipRole(userId, restaurantId) {
      const { data, error } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (error) throw error;
      return (data as { role?: string } | null)?.role ?? null;
    },
  };
}

export type DownloadResult =
  | { ok: true; dataUrl: string; byteLength: number }
  | { ok: false; reason: 'invalid_path' | 'download_failed' | 'too_large' };

export interface DownloadOptions {
  /** The row's `raw_file_url`. It comes from the client, so it is checked first. */
  path: unknown;
  restaurantId: string;
  maxBytes: number;
  mime: string;
  timeoutMs?: number;
}

/**
 * Download the row's file from the document bucket and return it as a data
 * URL. The path must be inside the restaurant's folder. The result holds only
 * a reason code, so no storage detail goes to the client.
 */
export async function downloadDocumentAsDataUrl(
  supabase: DocumentServiceClient,
  { path, restaurantId, maxBytes, mime, timeoutMs = DOWNLOAD_TIMEOUT_MS }: DownloadOptions,
): Promise<DownloadResult> {
  if (!isRestaurantStoragePath(path, restaurantId)) {
    console.error('Document path is outside the restaurant folder:', { restaurantId });
    return { ok: false, reason: 'invalid_path' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Download timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const { data, error } = await Promise.race([
      supabase.storage.from(DOCUMENT_BUCKET).download(path as string),
      timeout,
    ]);
    if (error || !data) {
      console.error('Document download failed:', error);
      return { ok: false, reason: 'download_failed' };
    }
    if (data.size > maxBytes) {
      console.error(`Document is too large: ${data.size} bytes, limit ${maxBytes}`);
      return { ok: false, reason: 'too_large' };
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    return { ok: true, dataUrl: bytesToDataUrl(bytes, mime), byteLength: bytes.byteLength };
  } catch (error) {
    console.error('Document download failed:', error);
    return { ok: false, reason: 'download_failed' };
  } finally {
    clearTimeout(timer);
  }
}
