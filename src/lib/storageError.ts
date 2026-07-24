export interface StorageErrorInfo {
  /** HTTP-ish status ('400', '413', ...), 'network', or 'unknown'. */
  code: string;
  /** Curated, safe-to-render toast text. Never contains raw server output. */
  userMessage: string;
  /** Single-line, '[code]'-prefixed summary carrying the raw body for logs/Faro. */
  logLine: string;
}

/** Longer than Radix's ~5s default so a reportable code survives on screen. */
export const UPLOAD_ERROR_TOAST_DURATION = 12000;

const CURATED_MESSAGES: Record<string, string> = {
  '413': 'This file is too large to upload.',
  '415': "That file type isn't supported.",
  '409': 'A file with that name already exists.',
};

function generic(code: string): string {
  return `Upload failed (code ${code}). Please try again — if it keeps happening, share this code with support.`;
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim();
}

export function describeStorageError(error: unknown): StorageErrorInfo {
  // StorageApiError — duck-typed on HTTP status fields (avoids importing the class).
  if (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'statusCode' in error)
  ) {
    const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
    const rawStatus = e.status ?? e.statusCode;
    const code = rawStatus === undefined || rawStatus === null ? 'unknown' : String(rawStatus);
    const rawMessage = typeof e.message === 'string' ? e.message : code;
    return {
      code,
      userMessage: CURATED_MESSAGES[code] ?? generic(code),
      logLine: oneLine(`[${code}] ${rawMessage}`),
    };
  }

  // StorageUnknownError — carries originalError; the fetch never completed.
  if (typeof error === 'object' && error !== null && 'originalError' in error) {
    const e = error as { message?: unknown };
    const rawMessage = typeof e.message === 'string' ? e.message : 'network error';
    return {
      code: 'network',
      userMessage: generic('network'),
      logLine: oneLine(`[network] ${rawMessage}`),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown',
      userMessage: generic('unknown'),
      logLine: oneLine(`[unknown] ${error.message}`),
    };
  }

  return {
    code: 'unknown',
    userMessage: generic('unknown'),
    logLine: oneLine(`[unknown] ${String(error)}`),
  };
}
