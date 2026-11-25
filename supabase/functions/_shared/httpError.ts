// Pure helpers. No Deno globals, so Vitest can import this file.

export class HttpError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.name = 'HttpError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export interface ErrorResponse {
  status: number;
  body: { error: string };
}

/** Maps an unknown error to a response. Only HttpError text reaches the client. */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.publicMessage } };
  }
  return { status: 500, body: { error: 'Request failed' } };
}

/** True when a Postgres error is a unique violation (23505). */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}
