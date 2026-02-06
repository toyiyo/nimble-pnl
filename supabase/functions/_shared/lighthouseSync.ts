/**
 * Lighthouse Sync Utilities
 *
 * Shared logic for Shift4/Lighthouse POS integration.
 * Used by both shift4-sync-data (manual) and shift4-bulk-sync (cron).
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EncryptionService } from "./encryption.ts";

// Types

export interface Shift4Connection {
  id: string;
  restaurant_id: string;
  merchant_id: string;
  email?: string;
  password?: string;
  lighthouse_token?: string;
  lighthouse_token_expires_at?: string;
  lighthouse_location_ids?: string;
  initial_sync_done?: boolean;
  sync_cursor?: number;
  is_active?: boolean;
  connection_status?: string;
  last_error?: string;
  last_error_at?: string;
  last_sync_time?: string;
}

export interface LighthouseSyncOptions {
  maxTickets?: number;
}

export interface SyncStats {
  ticketsReceived: number;
  ticketsProcessed: number;
  ticketsVoided: number;
  ticketsMissingOrder: number;
  rowsQueued: number;
  rowsInserted: number;
  duplicatesSkipped: number;
  errors: string[];
}

interface YMD {
  year: number;
  month: number;
  day: number;
}

// Lighthouse API Types

interface LighthousePermission {
  l?: number;
}

interface LighthouseTicketItem {
  name?: string;
  qty?: number | string;
  subtotal?: number | string;
  discountTotal?: number | string;
  surTotal?: number | string;
  status?: string;
}

interface LighthousePayment {
  tenderType?: string;
  tip?: number | string;
  // Array format: [tenderType, amount, tax, tip]
}

interface LighthouseTicket {
  orderNumber?: string | number;
  order?: string | number;
  ticket?: string | number;
  ticketNumber?: string | number;
  status?: string;
  completed?: string;
  opened?: string;
  grandTotal?: number | string;
  locationId?: number | string;
  location_id?: number | string;
  loc_id?: number | string;
  items?: LighthouseTicketItem[];
  ticketDiscounts?: Array<[string, number | string] | { name?: string; amount?: number | string }>;
  ticketFees?: Array<[string, ...unknown[]] | { name?: string; amount?: number | string; grandTotal?: number | string }>;
  ticketTaxes?: Array<[string, number | string] | { name?: string; amount?: number | string }>;
  ticketPayments?: Array<LighthousePayment | [string, number | string, number | string, number | string]>;
}

interface UnifiedSalesRow {
  restaurant_id: string;
  pos_system: string;
  external_order_id: string;
  external_item_id: string;
  item_name: string;
  item_type: string;
  adjustment_type: string | null;
  quantity: number;
  total_price: number | null;
  unit_price?: number | null;
  sale_date: string;
  sale_time: string;
  raw_data: unknown;
  synced_at: string;
  updated_at: string;
}

// Utility Functions

function getLocalYMD(date: Date, timeZone: string): YMD {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const result: YMD = { year: 0, month: 0, day: 0 };

  for (const part of parts) {
    if (part.type === 'year') result.year = parseInt(part.value, 10);
    else if (part.type === 'month') result.month = parseInt(part.value, 10);
    else if (part.type === 'day') result.day = parseInt(part.value, 10);
  }

  return result;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function localTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const formatter = getFormatter(timeZone);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = formatter.formatToParts(new Date(utcGuess));

  function readPart(type: string): number {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  }

  const correctedUtc = Date.UTC(
    readPart('year'),
    readPart('month') - 1,
    readPart('day'),
    readPart('hour'),
    readPart('minute'),
    readPart('second')
  );
  const offset = correctedUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${entries.join(',')}}`;
}

export async function makeHashId(base: string, payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${base}|${stableStringify(payload)}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${base}-${hashHex.slice(0, 12)}`;
}

export function parseCurrency(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTicketLocationId(
  ticket: LighthouseTicket,
  fallback: number
): number {
  const rawId = ticket.locationId ?? ticket.location_id ?? ticket.loc_id;
  if (typeof rawId === 'number') return rawId;
  if (typeof rawId === 'string' && rawId) {
    const parsed = parseInt(rawId, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

interface ParsedDateTime {
  dateStr: string;
  timeStr: string;
  utcDate: Date;
}

function parseTicketDateTime(value: unknown, timezone: string): ParsedDateTime | null {
  if (!value || typeof value !== 'string') return null;

  const [mdy, timeRaw] = value.trim().split(/\s+/);
  if (!mdy || !timeRaw) return null;

  const [mm, dd, yyyy] = mdy.split('/').map((n) => parseInt(n, 10));
  const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})(AM|PM)/i);
  if (!mm || !dd || !yyyy || !timeMatch) return null;

  const [, hh, min, ampm] = timeMatch;
  let hour = parseInt(hh, 10);
  const minute = parseInt(min, 10);
  const isPM = ampm.toUpperCase() === 'PM';

  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;

  const dateStr = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const utcDate = localTimeToUtc(yyyy, mm, dd, hour, minute, timezone);

  return { dateStr, timeStr, utcDate };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 500
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

// Lighthouse API Functions

export async function authenticateLighthouse(
  email: string,
  password: string
): Promise<{ token: string; locationIds: number[] }> {
  const response = await fetch('https://lighthouse-api.harbortouch.com/api/v1/auth/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lighthouse authentication failed: ${errorText}`);
  }

  const authResponse = await response.json();
  const locationIds = Array.from(new Set(
    (authResponse.permissions || [])
      .map((p: { l?: number }) => p.l)
      .filter((l: unknown): l is number => typeof l === 'number')
  )) as number[];

  return { token: authResponse.token, locationIds };
}

export async function getValidLighthouseToken(
  supabase: SupabaseClient,
  connection: Shift4Connection,
  encryption: EncryptionService
): Promise<{ token: string; locationIds: number[] }> {
  const now = new Date();
  const expiresAt = connection.lighthouse_token_expires_at
    ? new Date(connection.lighthouse_token_expires_at)
    : null;

  // Use cached token if valid
  if (connection.lighthouse_token && expiresAt && expiresAt > now) {
    const token = await encryption.decrypt(connection.lighthouse_token);
    const locationIds = connection.lighthouse_location_ids
      ? JSON.parse(connection.lighthouse_location_ids).filter(
          (l: unknown): l is number => typeof l === 'number'
        )
      : [];
    return { token, locationIds };
  }

  // Need fresh authentication
  if (!connection.email || !connection.password) {
    throw new Error('No Lighthouse credentials available');
  }

  const email = await encryption.decrypt(connection.email);
  const password = await encryption.decrypt(connection.password);
  const { token, locationIds } = await authenticateLighthouse(email, password);

  // Cache the token
  await supabase.from('shift4_connections').update({
    lighthouse_token: await encryption.encrypt(token),
    lighthouse_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    lighthouse_location_ids: JSON.stringify(locationIds),
    updated_at: new Date().toISOString()
  }).eq('id', connection.id);

  return { token, locationIds };
}

export async function fetchLighthouseTickets(
  token: string,
  start: string,
  end: string,
  locations: number[],
  locale = 'en-US'
): Promise<LighthouseTicket[]> {
  const url = 'https://lighthouse-api.harbortouch.com/api/v1/reports/echo-pro/ticket-detail-closed';
  const payload = {
    start,
    end,
    locations,
    intradayPeriodGroupGuids: [],
    revenueCenterGuids: [],
    locale
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json',
      'origin': 'https://lh.shift4.com',
      'referer': 'https://lh.shift4.com/',
      'x-access-token': token
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lighthouse ticket fetch failed: ${errorText}`);
  }

  const data = await response.json();
  return Array.isArray(data.rows) ? data.rows : [];
}

// Ticket Processing

export async function processTicket(
  supabase: SupabaseClient,
  ticket: LighthouseTicket,
  restaurantId: string,
  locationId: number,
  timezone: string,
  fallbackDateString: string,
  rangeStart: Date,
  stats: SyncStats
): Promise<void> {
  const ticketStatus = ticket.status;
  if (typeof ticketStatus === 'string' && ticketStatus.toLowerCase().includes('void')) {
    stats.ticketsVoided++;
    return;
  }

  const orderNumber = ticket.orderNumber || ticket.order || ticket.ticket || ticket.ticketNumber;
  if (!orderNumber) {
    stats.ticketsMissingOrder++;
    console.warn('[Lighthouse Sync] Skipping ticket without order number');
    return;
  }

  const parsedCompleted = parseTicketDateTime(ticket.completed || ticket.opened, timezone);
  const saleDateString = parsedCompleted?.dateStr || fallbackDateString;
  const saleTimeString = parsedCompleted?.timeStr || '00:00:00';
  const saleTimeCompact = saleTimeString.replace(/:/g, '');
  const createdDate = parsedCompleted?.utcDate || rangeStart;
  const merchantId = locationId !== null ? String(locationId) : 'unknown';
  const chargeId = `${orderNumber}-${merchantId}-${saleDateString}-${saleTimeCompact}`;

  // Upsert to shift4_charges
  const grandTotal = parseCurrency(ticket.grandTotal);
  const { error: chargeError } = await supabase.from('shift4_charges').upsert({
    restaurant_id: restaurantId,
    charge_id: chargeId,
    merchant_id: merchantId,
    amount: Math.round(grandTotal * 100),
    currency: 'USD',
    status: 'completed',
    refunded: false,
    captured: true,
    created_at_ts: Math.floor(createdDate.getTime() / 1000),
    created_time: createdDate.toISOString(),
    service_date: saleDateString,
    service_time: saleTimeString,
    description: `Ticket ${orderNumber}`,
    tip_amount: 0,
    raw_json: ticket,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'restaurant_id,charge_id' });

  if (chargeError) {
    stats.errors.push(`Charge upsert failed for ticket ${orderNumber}: ${chargeError.message}`);
    return;
  }

  // Fetch existing item IDs to prevent duplicates
  const { data: existingRows } = await supabase
    .from('unified_sales')
    .select('external_item_id')
    .eq('restaurant_id', restaurantId)
    .eq('pos_system', 'lighthouse')
    .eq('external_order_id', chargeId);

  const existingIds = new Set((existingRows || []).map((r) => r.external_item_id));
  const unifiedRows: UnifiedSalesRow[] = [];
  let lineIndex = 0;
  let duplicatesThisTicket = 0;

  // Process items
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  for (const item of items) {
    if (item.status && typeof item.status === 'string' &&
        item.status.toLowerCase().includes('void')) {
      continue;
    }

    const qty = Number(item.qty) || 0;
    const itemSubtotal = parseCurrency(item.subtotal);
    const itemName = item.name || 'Item';
    const discount = parseCurrency(item.discountTotal);
    const sur = parseCurrency(item.surTotal);

    const baseId = await makeHashId(`${chargeId}-item-${lineIndex}`, {
      name: itemName, qty, subtotal: itemSubtotal, discount, sur
    });

    if (!existingIds.has(baseId)) {
      unifiedRows.push({
        restaurant_id: restaurantId,
        pos_system: 'lighthouse',
        external_order_id: chargeId,
        external_item_id: baseId,
        item_name: itemName,
        item_type: 'sale',
        adjustment_type: null,
        quantity: qty || 1,
        total_price: itemSubtotal,
        unit_price: itemSubtotal && qty ? itemSubtotal / qty : null,
        sale_date: saleDateString,
        sale_time: saleTimeString,
        raw_data: item,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      existingIds.add(baseId);
    } else {
      duplicatesThisTicket++;
    }

    // Item discount
    if (discount && Math.abs(discount) > 0.0001) {
      const discountId = await makeHashId(`${chargeId}-item-discount-${lineIndex}`, {
        name: itemName, discount
      });
      if (!existingIds.has(discountId)) {
        unifiedRows.push({
          restaurant_id: restaurantId,
          pos_system: 'lighthouse',
          external_order_id: chargeId,
          external_item_id: discountId,
          item_name: `${itemName} Discount`,
          item_type: 'discount',
          adjustment_type: 'discount',
          total_price: -Math.abs(discount),
          quantity: 1,
          sale_date: saleDateString,
          sale_time: saleTimeString,
          raw_data: item,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        existingIds.add(discountId);
      } else {
        duplicatesThisTicket++;
      }
    }

    // Item surcharge
    if (sur && Math.abs(sur) > 0.0001) {
      const feeId = await makeHashId(`${chargeId}-item-fee-${lineIndex}`, {
        name: itemName, surcharge: sur
      });
      if (!existingIds.has(feeId)) {
        unifiedRows.push({
          restaurant_id: restaurantId,
          pos_system: 'lighthouse',
          external_order_id: chargeId,
          external_item_id: feeId,
          item_name: `${itemName} Surcharge`,
          item_type: 'service_charge',
          adjustment_type: 'service_charge',
          total_price: sur,
          quantity: 1,
          sale_date: saleDateString,
          sale_time: saleTimeString,
          raw_data: item,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        existingIds.add(feeId);
      } else {
        duplicatesThisTicket++;
      }
    }

    lineIndex++;
  }

  // Process ticket-level discounts
  const ticketDiscounts = Array.isArray(ticket.ticketDiscounts) ? ticket.ticketDiscounts : [];
  for (const [idx, d] of ticketDiscounts.entries()) {
    const name = Array.isArray(d) ? d[0] : d?.name || 'Ticket Discount';
    const amount = Array.isArray(d) ? parseCurrency(d[1]) : parseCurrency(d?.amount);
    if (!amount) continue;

    const discountId = await makeHashId(`${chargeId}-discount-${idx}`, d);
    if (!existingIds.has(discountId)) {
      unifiedRows.push({
        restaurant_id: restaurantId,
        pos_system: 'lighthouse',
        external_order_id: chargeId,
        external_item_id: discountId,
        item_name: name,
        item_type: 'discount',
        adjustment_type: 'discount',
        total_price: -Math.abs(amount),
        quantity: 1,
        sale_date: saleDateString,
        sale_time: saleTimeString,
        raw_data: d,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      existingIds.add(discountId);
    } else {
      duplicatesThisTicket++;
    }
  }

  // Process ticket-level fees
  const ticketFees = Array.isArray(ticket.ticketFees) ? ticket.ticketFees : [];
  for (const [idx, f] of ticketFees.entries()) {
    const name = Array.isArray(f) ? f[0] : f?.name || 'Fee';
    const amount = Array.isArray(f)
      ? parseCurrency(f[4] ?? f[1])
      : parseCurrency(f?.grandTotal || f?.amount);
    if (!amount) continue;

    const feeId = await makeHashId(`${chargeId}-fee-${idx}`, f);
    if (!existingIds.has(feeId)) {
      unifiedRows.push({
        restaurant_id: restaurantId,
        pos_system: 'lighthouse',
        external_order_id: chargeId,
        external_item_id: feeId,
        item_name: name,
        item_type: 'service_charge',
        adjustment_type: 'service_charge',
        total_price: amount,
        quantity: 1,
        sale_date: saleDateString,
        sale_time: saleTimeString,
        raw_data: f,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      existingIds.add(feeId);
    } else {
      duplicatesThisTicket++;
    }
  }

  // Process ticket-level taxes
  const ticketTaxes = Array.isArray(ticket.ticketTaxes) ? ticket.ticketTaxes : [];
  for (const [idx, t] of ticketTaxes.entries()) {
    const name = Array.isArray(t) ? t[0] : t?.name || 'Tax';
    const amount = Array.isArray(t) ? parseCurrency(t[1]) : parseCurrency(t?.amount);
    if (!amount) continue;

    const taxId = await makeHashId(`${chargeId}-tax-${idx}`, t);
    if (!existingIds.has(taxId)) {
      unifiedRows.push({
        restaurant_id: restaurantId,
        pos_system: 'lighthouse',
        external_order_id: chargeId,
        external_item_id: taxId,
        item_name: name,
        item_type: 'tax',
        adjustment_type: 'tax',
        total_price: amount,
        quantity: 1,
        sale_date: saleDateString,
        sale_time: saleTimeString,
        raw_data: t,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      existingIds.add(taxId);
    } else {
      duplicatesThisTicket++;
    }
  }

  // Process tips from payments
  const payments = Array.isArray(ticket.ticketPayments) ? ticket.ticketPayments : [];
  for (const [idx, p] of payments.entries()) {
    const tipAmount = Array.isArray(p) ? parseCurrency(p[3]) : parseCurrency(p?.tip);
    if (!tipAmount) continue;

    const tenderType = Array.isArray(p) ? p[0] : p?.tenderType || 'Tip';
    const tipId = await makeHashId(`${chargeId}-tip-${idx}`, p);
    if (!existingIds.has(tipId)) {
      unifiedRows.push({
        restaurant_id: restaurantId,
        pos_system: 'lighthouse',
        external_order_id: chargeId,
        external_item_id: tipId,
        item_name: `${tenderType} Tip`,
        item_type: 'tip',
        adjustment_type: 'tip',
        total_price: tipAmount,
        quantity: 1,
        sale_date: saleDateString,
        sale_time: saleTimeString,
        raw_data: p,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      existingIds.add(tipId);
    } else {
      duplicatesThisTicket++;
    }
  }

  // Insert unified_sales rows
  if (unifiedRows.length) {
    stats.rowsQueued += unifiedRows.length;
    const { error: insertError } = await supabase.from('unified_sales').insert(unifiedRows);
    if (insertError) {
      stats.errors.push(`Bulk insert failed for ticket ${orderNumber}: ${insertError.message}`);
    } else {
      stats.rowsInserted += unifiedRows.length;
    }
  }

  if (duplicatesThisTicket > 0) {
    stats.duplicatesSkipped += duplicatesThisTicket;
  }

  stats.ticketsProcessed++;
}

// Main Sync Function

export async function syncLighthouseData(
  supabase: SupabaseClient,
  connection: Shift4Connection,
  startDate: Date,
  endDate: Date,
  restaurantTimezone: string,
  encryption: EncryptionService,
  options: LighthouseSyncOptions = {}
): Promise<SyncStats> {
  const stats: SyncStats = {
    ticketsReceived: 0,
    ticketsProcessed: 0,
    ticketsVoided: 0,
    ticketsMissingOrder: 0,
    rowsQueued: 0,
    rowsInserted: 0,
    duplicatesSkipped: 0,
    errors: []
  };

  // Get valid Lighthouse token
  const { token, locationIds } = await getValidLighthouseToken(
    supabase, connection, encryption
  );

  if (!locationIds.length) {
    throw new Error('No valid Lighthouse location IDs found for sync');
  }

  // Prepare date range in restaurant timezone
  const startParts = getLocalYMD(startDate, restaurantTimezone);
  const endParts = getLocalYMD(endDate, restaurantTimezone);
  const rangeStart = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 0, 0, 0));
  const rangeEnd = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day, 23, 59, 59, 999));
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();
  const fallbackDateString = `${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;

  console.log(`[Lighthouse Sync] Fetching tickets: ${rangeStartIso} -> ${rangeEndIso} (locations: ${locationIds.join(',')})`);

  // Fetch tickets with retry
  const tickets = await withRetry(
    () => fetchLighthouseTickets(token, rangeStartIso, rangeEndIso, locationIds),
    3, 750
  );

  stats.ticketsReceived = tickets.length;
  console.log(`[Lighthouse Sync] Received ${tickets.length} tickets`);

  // Process tickets (with optional limit)
  const maxTickets = options.maxTickets || tickets.length;
  const ticketsToProcess = tickets.slice(0, maxTickets);

  for (const ticket of ticketsToProcess) {
    const locationId = extractTicketLocationId(ticket, locationIds[0]);
    await processTicket(
      supabase, ticket, connection.restaurant_id,
      locationId, restaurantTimezone, fallbackDateString,
      rangeStart, stats
    );
  }

  console.log(`[Lighthouse Sync] Completed: ${stats.ticketsProcessed} processed, ${stats.rowsInserted} rows inserted`);
  return stats;
}
