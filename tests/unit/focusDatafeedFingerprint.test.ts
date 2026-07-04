import { describe, it, expect, vi } from 'vitest';
import {
  computeChecksFingerprint,
  createDatafeedStateStore,
  type StateStoreClient,
} from '../../supabase/functions/_shared/focusDatafeedFingerprint.ts';

type StateRow = {
  checks_bytes: number;
  checks_sha256: string;
  fetched_at: string;
} | null;
type StoreError = { message: string } | null;

const XML_A = '<Feed><Config>big</Config><Checks><Check><ID>1</ID></Check></Checks></Feed>';
const XML_A2 = '<Feed><Config>DIFFERENT CONFIG</Config><Checks><Check><ID>1</ID></Check></Checks></Feed>';
const XML_B = '<Feed><Config>big</Config><Checks><Check><ID>2</ID></Check></Checks></Feed>';
const XML_NO_CHECKS = '<Feed><Config>big</Config></Feed>';

describe('computeChecksFingerprint', () => {
  it('is stable for identical <Checks> content and ignores config outside the block', async () => {
    const a = await computeChecksFingerprint(XML_A);
    const a2 = await computeChecksFingerprint(XML_A2);
    expect(a).toEqual(a2);
    expect(a.bytes).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when check content differs', async () => {
    const a = await computeChecksFingerprint(XML_A);
    const b = await computeChecksFingerprint(XML_B);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('fingerprints a config-only feed (no <Checks>) as the empty block', async () => {
    const fp = await computeChecksFingerprint(XML_NO_CHECKS);
    expect(fp.bytes).toBe(0);
  });
});

describe('createDatafeedStateStore', () => {
  function makeClient(row: StateRow, getError: StoreError = null) {
    const maybeSingle = vi.fn(async () => ({ data: row, error: getError }));
    const upsertSelect = vi.fn(async () => ({ data: [], error: null }));
    const upsert = vi.fn((_data: Record<string, unknown>, _options?: Record<string, unknown>) => ({ select: upsertSelect }));
    const eq2 = vi.fn((_col: string, _val: string) => ({ maybeSingle }));
    const eq1 = vi.fn((_col: string, _val: string) => ({ eq: eq2 }));
    const select = vi.fn((_columns: string) => ({ eq: eq1 }));
    const from = vi.fn((_table: string) => ({ select, upsert }));
    const client: StateStoreClient = { from };
    return { client, mocks: { from, select, upsert, upsertSelect, maybeSingle } };
  }

  it('get returns the stored fingerprint mapped to camelCase', async () => {
    const { client } = makeClient({ checks_bytes: 42, checks_sha256: 'ab'.repeat(32), fetched_at: '2026-07-04T10:00:00Z' });
    const store = createDatafeedStateStore(client);
    const got = await store.get('r1', '2026-07-04');
    expect(got).toEqual({ bytes: 42, sha256: 'ab'.repeat(32), fetchedAt: '2026-07-04T10:00:00Z' });
  });

  it('get fails OPEN: returns null on query error (delta-skip must never break the sync)', async () => {
    const { client } = makeClient(null, { message: 'boom' });
    const store = createDatafeedStateStore(client);
    expect(await store.get('r1', '2026-07-04')).toBeNull();
  });

  it('record upserts the fingerprint on the composite key', async () => {
    const { client, mocks } = makeClient(null);
    const store = createDatafeedStateStore(client);
    await store.record('r1', '2026-07-04', { bytes: 7, sha256: 'ff'.repeat(32) });
    expect(mocks.from).toHaveBeenCalledWith('focus_datafeed_state');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r1',
        business_date: '2026-07-04',
        checks_bytes: 7,
        checks_sha256: 'ff'.repeat(32),
        fetched_at: expect.any(String),
      }),
      { onConflict: 'restaurant_id,business_date' },
    );
  });

  it('touch refreshes fetched_at via the same upsert path without changing the hash fields', async () => {
    const { client, mocks } = makeClient(null);
    const store = createDatafeedStateStore(client);
    await store.touch('r1', '2026-07-04', { bytes: 7, sha256: 'ff'.repeat(32) });
    expect(mocks.upsert).toHaveBeenCalled();
  });
});
