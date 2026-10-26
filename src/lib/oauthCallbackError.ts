// User-facing message for a failed POS OAuth callback (Square, Clover, Toast).
//
// The edge functions reject a callback with 401 when the caller has no valid
// session, and with 403 when the signed state is expired, forged, or belongs
// to a different user. supabase-js FunctionsHttpError keeps the fetch Response
// in `context`, so the status is on `error.context.status`.

function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context: unknown }).context;
  if (!context || typeof context !== 'object' || !('status' in context)) return null;
  const status = (context as { status: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export type PosOAuthProviderName = 'Square' | 'Clover' | 'Toast';

export function describeOAuthCallbackError(error: unknown, providerName: PosOAuthProviderName): string {
  const status = httpStatusOf(error);
  if (status === 401) {
    return `Sign in, then connect ${providerName} again.`;
  }
  if (status === 403) {
    return `This connection link expired or belongs to a different account. Start the ${providerName} connection again.`;
  }
  return `Failed to complete the ${providerName} connection.`;
}
