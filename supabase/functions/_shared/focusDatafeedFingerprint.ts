/**
 * focusDatafeedFingerprint.ts
 *
 * Content-hash delta detection for Focus Lynk datafeeds. The <Checks> block is
 * the only part of the ~4.5 MB feed that carries transaction data (~90 % is
 * static config), so its byte length + SHA-256 is a reliable "did anything
 * change?" signal. Fingerprints persist in focus_datafeed_state, one row per
 * (restaurant, business_date).
 *
 * FAIL-OPEN CONTRACT: every store operation tolerates errors — a broken state
 * read/write must degrade to "reprocess the feed", never break the sync.
 */

import { extractChecksBlock } from './focusDatafeedParser.ts';

export interface ChecksFingerprint {
  bytes: number;
  sha256: string;
}

export interface StoredFingerprint extends ChecksFingerprint {
  fetchedAt: string;
}

/** Minimal Supabase surface (service-role client in prod; mock in tests). */
export interface StateStoreClient {
  from(table: string): {
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): Promise<{
            data: { checks_bytes: number; checks_sha256: string; fetched_at: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    upsert(
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): { select(): Promise<{ data: unknown; error: { message: string } | null }> };
  };
}

export interface DatafeedStateStore {
  /** Stored fingerprint for (restaurant, date), or null when absent OR on error (fail open). */
  get(restaurantId: string, businessDate: string): Promise<StoredFingerprint | null>;
  /** Feed unchanged: refresh fetched_at (keeps the 6-h yesterday-window bookkeeping honest). */
  touch(restaurantId: string, businessDate: string, fp: ChecksFingerprint): Promise<void>;
  /** Feed processed: persist the new fingerprint. */
  record(restaurantId: string, businessDate: string, fp: ChecksFingerprint): Promise<void>;
}

/** SHA-256 (hex) + byte length of the <Checks> block; empty block when absent. */
export async function computeChecksFingerprint(xml: string): Promise<ChecksFingerprint> {
  const block = extractChecksBlock(xml) ?? '';
  const data = new TextEncoder().encode(block);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { bytes: data.byteLength, sha256 };
}

export function createDatafeedStateStore(client: StateStoreClient): DatafeedStateStore {
  const upsertRow = async (
    restaurantId: string,
    businessDate: string,
    fp: ChecksFingerprint,
    label: string,
  ): Promise<void> => {
    try {
      const { error } = await client
        .from('focus_datafeed_state')
        .upsert(
          {
            restaurant_id: restaurantId,
            business_date: businessDate,
            checks_bytes: fp.bytes,
            checks_sha256: fp.sha256,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'restaurant_id,business_date' },
        )
        .select();
      if (error) {
        console.warn(`focus_datafeed_state ${label} failed for ${restaurantId}/${businessDate}: ${error.message}`);
      }
    } catch (err: unknown) {
      console.warn(
        `focus_datafeed_state ${label} threw for ${restaurantId}/${businessDate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    async get(restaurantId, businessDate) {
      try {
        const { data, error } = await client
          .from('focus_datafeed_state')
          .select('checks_bytes, checks_sha256, fetched_at')
          .eq('restaurant_id', restaurantId)
          .eq('business_date', businessDate)
          .maybeSingle();
        if (error || !data) return null;
        return { bytes: data.checks_bytes, sha256: data.checks_sha256, fetchedAt: data.fetched_at };
      } catch {
        return null;
      }
    },
    touch: (restaurantId, businessDate, fp) => upsertRow(restaurantId, businessDate, fp, 'touch'),
    record: (restaurantId, businessDate, fp) => upsertRow(restaurantId, businessDate, fp, 'record'),
  };
}
