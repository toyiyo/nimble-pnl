/**
 * focusHttpFetch.ts
 *
 * A `fetch`-compatible transport that routes Focus POS HTTP calls through the
 * Postgres `focus_http_request` RPC (libcurl / OpenSSL).
 *
 * Why: Focus's legacy Azure/IIS servers reset Deno's (rustls) TLS handshake, so
 * Supabase Edge Functions cannot reach Focus with the built-in `fetch`. Postgres
 * libcurl connects fine (same OpenSSL stack as curl/Node). This adapter is
 * injected as `deps.fetch`, so focusPortalClient / focusReportClient keep ALL
 * their login / cookie / redirect / parse logic unchanged — only the socket
 * moves to Postgres.
 *
 * The RPC does not follow redirects (so a 302 + Set-Cookie is surfaced for the
 * cookie jar) and applies its own libcurl timeout, so `redirect` and `signal`
 * from the RequestInit are intentionally ignored here.
 */

interface RpcHeader {
  field: string;
  value: string;
}

interface RpcResult {
  status: number;
  headers: RpcHeader[] | null;
  body: string | null;
}

/** Minimal Supabase client surface this adapter needs. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Build a minimal Response-like object from the RPC result. */
function toResponse(r: RpcResult): Response {
  const headers = r.headers ?? [];
  const get = (name: string): string | null => {
    const lc = name.toLowerCase();
    const found = headers.find((x) => (x.field ?? '').toLowerCase() === lc);
    return found ? found.value : null;
  };
  const getSetCookie = (): string[] =>
    headers.filter((x) => (x.field ?? '').toLowerCase() === 'set-cookie').map((x) => x.value);
  const bodyText = r.body ?? '';

  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: { get, getSetCookie } as unknown as Headers,
    text: () => Promise.resolve(bodyText),
    // Some callers `await res.body?.cancel()`; provide a no-op so it's safe.
    body: { cancel: () => Promise.resolve() } as unknown as ReadableStream<Uint8Array>,
  } as unknown as Response;
}

/** Normalise a RequestInit's headers (Headers | array | record) to a plain object. */
function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else {
    Object.assign(out, h);
  }
  return out;
}

/**
 * Returns a `fetch`-like function bound to a Supabase service-role client.
 * Only method / headers / body are honoured (redirect + timeout are handled by
 * the `focus_http_request` RPC).
 */
export function makeFocusHttpFetch(client: RpcClient): typeof fetch {
  const focusFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = headersToObject(init?.headers);
    const body =
      init?.body == null ? null : typeof init.body === 'string' ? init.body : String(init.body);

    const { data, error } = await client.rpc('focus_http_request', {
      p_url: url,
      p_method: method,
      p_headers: headers,
      p_body: body,
    });
    if (error) {
      throw new Error(`focus_http_request transport failed: ${error.message}`);
    }
    return toResponse(data as RpcResult);
  };

  return focusFetch as unknown as typeof fetch;
}
