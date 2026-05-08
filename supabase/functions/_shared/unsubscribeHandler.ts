// Pure logic for the unsubscribe-email edge function.
//
// Split out of index.ts so it can be unit-tested under Vitest. The Deno
// edge entrypoint wires `secret` from env and `insert` to a real
// Supabase client; tests inject mocks.

import {
  verifyUnsubscribe,
  type UnsubList,
} from './unsubscribeToken.ts';

export type UnsubInsertFn = (row: {
  user_id: string;
  list: UnsubList;
  source: string;
}) => Promise<{ error: { message: string } | null }>;

export interface UnsubRequest {
  token: string;
  list: UnsubList;
}

export interface UnsubDeps {
  secret: string;
  insert: UnsubInsertFn;
  source?: string;
}

export interface UnsubResult {
  status: number;
  body: { ok?: true; error?: string };
}

const VALID_LISTS: ReadonlySet<UnsubList> = new Set([
  'trial_lifecycle',
  'marketing',
  'all',
]);

export async function processUnsubscribe(
  req: UnsubRequest,
  deps: UnsubDeps
): Promise<UnsubResult> {
  if (!deps.secret) {
    return { status: 500, body: { error: 'Unsubscribe service not configured' } };
  }
  if (!req.token) {
    return { status: 400, body: { error: 'Missing token' } };
  }
  if (!req.list || !VALID_LISTS.has(req.list)) {
    return { status: 400, body: { error: 'Invalid list' } };
  }

  try {
    const verified = await verifyUnsubscribe(req.token, deps.secret);
    if (!verified) {
      return { status: 401, body: { error: 'Invalid or expired token' } };
    }
    if (verified.list !== req.list) {
      return { status: 400, body: { error: 'List mismatch' } };
    }

    const { error } = await deps.insert({
      user_id: verified.user_id,
      list: verified.list,
      source: deps.source ?? 'email_link',
    });
    if (error) {
      return { status: 500, body: { error: error.message } };
    }
    return { status: 200, body: { ok: true } };
  } catch (e) {
    // Preserve the {status, body} contract even if a dependency throws
    // — the Deno entry expects a result object, not an exception.
    console.error('[unsubscribe] unexpected error:', (e as Error).message);
    return { status: 500, body: { error: 'Unexpected error' } };
  }
}
