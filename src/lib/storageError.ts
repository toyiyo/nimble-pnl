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
  empty:
    'This file is empty or your browser could not read it. Try again, or use a different browser.',
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
    const rawCode = rawStatus === undefined || rawStatus === null ? 'unknown' : String(rawStatus);
    let code = rawCode;
    const rawMessage = typeof e.message === 'string' ? e.message : code;
    // Safari can send an empty body. Storage then answers 400 "No content provided".
    if (code === '400' && rawMessage.toLowerCase().includes('no content provided')) {
      code = 'empty';
    }
    return {
      code,
      userMessage: CURATED_MESSAGES[code] ?? generic(code),
      logLine: oneLine(`[${rawCode}] ${rawMessage}`),
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
