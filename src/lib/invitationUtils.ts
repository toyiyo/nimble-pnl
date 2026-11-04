const DAY_MS = 1000 * 60 * 60 * 24;

export function formatExpiresIn(expiresAt: string): string {
  const expiresDate = new Date(expiresAt);
  if (isNaN(expiresDate.getTime())) return 'Unknown expiration';
  const ms = expiresDate.getTime() - Date.now();
  const days = ms >= 0 ? Math.floor(ms / DAY_MS) : Math.ceil(ms / DAY_MS);
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return 'Expires tomorrow';
  if (days === 0) return ms >= 0 ? 'Expires today' : 'Expired today';
  if (days === -1) return 'Expired yesterday';
  return `Expired ${Math.abs(days)} days ago`;
}

export function classifyInvitationError(message: string): 'expired' | 'invalid' {
  return message === 'Invitation has expired' ? 'expired' : 'invalid';
}

export interface FunctionErrorBody {
  success?: boolean;
  code?: string;
  error?: string;
}

// supabase.functions.invoke returns a FunctionsHttpError for a non-2xx
// status. The JSON body is in error.context (a Response). Returns null when
// the error has no readable JSON object body.
export async function readFunctionErrorBody(error: unknown): Promise<FunctionErrorBody | null> {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: { json?: unknown } }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body: unknown = await (context as Response).json();
    return body && typeof body === 'object' ? (body as FunctionErrorBody) : null;
  } catch {
    return null;
  }
}
