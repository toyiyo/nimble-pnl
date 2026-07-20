/**
 * Revel Classic API client (per-restaurant credentials).
 * Each request authenticates with header `API-AUTHENTICATION: <apiKey>:<apiSecret>`
 * against the merchant's own base URL https://<subdomain>.revelup.com/.
 * Credentials are stored per restaurant (AES-GCM encrypted) in revel_connections.
 */

/** Normalize a user-supplied Revel URL or subdomain to the merchant base URL. */
export function revelBaseUrl(instance: string): string {
  const sub = String(instance)
    .replace(/^https?:\/\//, '')
    .replace(/\.revelup\.com\/?.*$/, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
  return `https://${sub}.revelup.com`;
}

/** Extract the numeric order id from an OrderItem's `order` FK (URI or id). */
export function extractOrderId(order: unknown): string | null {
  if (order === null || order === undefined) return null;
  const s = String(order);
  const m = s.match(/Order\/(\d+)/) || s.match(/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Fetch all OrderItems in a date range and group them by their parent order id.
 * Classic Revel does not bundle line items in the Order/OrderAllInOne resource, so
 * we pull /resources/OrderItem/ separately (Tastypie pagination) and join on order id.
 */
export async function fetchOrderItemsByDate(
  instance: string,
  apiKey: string,
  apiSecret: string,
  start: string,
  end: string,
  pageLimit = 500,
  maxPages = 60,
): Promise<Record<string, any[]>> {
  const byOrder: Record<string, any[]> = {};
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      created_date__gte: `${start}T00:00:00`,
      created_date__lte: `${end}T23:59:59`,
      limit: String(pageLimit),
      offset: String(page * pageLimit),
      order_by: 'created_date',
    });
    const res = await revelFetch(instance, apiKey, apiSecret, `/resources/OrderItem/?${params.toString()}`);
    if (!res.ok) break;
    const body = await res.json();
    const items: any[] = body.objects ?? body.results ?? (Array.isArray(body) ? body : []);
    for (const it of items) {
      const oid = extractOrderId(it.order);
      if (!oid) continue;
      (byOrder[oid] ??= []).push(it);
    }
    if (items.length < pageLimit) break;
    await new Promise((r) => setTimeout(r, 250)); // be gentle on the API between pages
  }
  return byOrder;
}

/**
 * Fetch all Payments in a date range, grouped by parent order id.
 * Payments carry tips (mostly credit-card tips), tenders, and refunds — none of which
 * live on the Order/OrderAllInOne resource — so we pull /resources/Payment/ separately.
 */
export async function fetchPaymentsByDate(
  instance: string,
  apiKey: string,
  apiSecret: string,
  start: string,
  end: string,
  pageLimit = 500,
  maxPages = 60,
): Promise<Record<string, any[]>> {
  const byOrder: Record<string, any[]> = {};
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      created_date__gte: `${start}T00:00:00`,
      created_date__lte: `${end}T23:59:59`,
      limit: String(pageLimit),
      offset: String(page * pageLimit),
      order_by: 'created_date',
    });
    const res = await revelFetch(instance, apiKey, apiSecret, `/resources/Payment/?${params.toString()}`);
    if (!res.ok) break;
    const body = await res.json();
    const rows: any[] = body.objects ?? body.results ?? (Array.isArray(body) ? body : []);
    for (const p of rows) {
      const oid = extractOrderId(p.order);
      if (!oid) continue;
      (byOrder[oid] ??= []).push(p);
    }
    if (rows.length < pageLimit) break;
    await new Promise((r) => setTimeout(r, 250)); // be gentle on the API between pages
  }
  return byOrder;
}

/** Authed fetch against a merchant's Classic Revel API. */
export async function revelFetch(
  instance: string,
  apiKey: string,
  apiSecret: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = revelBaseUrl(instance);
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const controller = new AbortController();
  // Busy days return large item/payment pages; give Revel room to respond.
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'API-AUTHENTICATION': `${apiKey}:${apiSecret}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
