import { describe, it, expect, vi } from 'vitest';
import { handleCreateConnectedAccount } from '../../supabase/functions/_shared/createConnectedAccountHandler';

const RID = 'rest_1';
const ACCT = 'acct_new';
const PROD = 'https://app.easyshifthq.com';

const makeReq = (
  body: unknown = { restaurantId: RID },
  headers: Record<string, string> = { Authorization: 'Bearer tok' },
) =>
  new Request('https://example.test/fn', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const liveOk = { id: 'acct_old', charges_enabled: true, payouts_enabled: true, details_submitted: true };
const liveIncomplete = { id: 'acct_old', charges_enabled: false, payouts_enabled: false, details_submitted: false };

interface Opts {
  user?: unknown;
  authError?: unknown;
  role?: string | null;
  accessError?: unknown;
  existing?: Record<string, unknown> | null;
  existingError?: unknown;
  updateError?: unknown;
  insertError?: unknown;
  raceRow?: Record<string, unknown> | null;
  raceError?: unknown;
  restaurant?: { name: string } | null;
  restaurantError?: unknown;
  live?: unknown;
  created?: unknown;
}

const makeDeps = (o: Opts = {}) => {
  const user = o.user === undefined ? { id: 'u1', email: 'o@x.test' } : o.user;
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: o.authError ?? null });

  const eqUpdate = vi.fn().mockResolvedValue({ error: o.updateError ?? null });
  const update = vi.fn().mockReturnValue({ eq: eqUpdate });
  const insert = vi.fn().mockResolvedValue({ error: o.insertError ?? null });

  // First account lookup is the existing-row check. A second one is the race read.
  const accountLookups = [
    { data: o.existing ?? null, error: o.existingError ?? null },
    { data: o.raceRow ?? null, error: o.raceError ?? null },
  ];

  const from = vi.fn((table: string) => {
    if (table === 'user_restaurants') {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue({
          data: o.role === null ? null : { role: o.role ?? 'owner' },
          error: o.accessError ?? null,
        }),
      };
      return chain;
    }
    if (table === 'restaurants') {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({
          data: o.restaurant === undefined ? { name: 'Cafe' } : o.restaurant,
          error: o.restaurantError ?? null,
        }),
      };
      return chain;
    }
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve(accountLookups.shift())),
      update,
      insert,
    };
    return chain;
  });

  const retrieve = vi.fn().mockResolvedValue(o.live ?? liveOk);
  const create = vi.fn().mockResolvedValue(
    o.created ?? { id: ACCT, charges_enabled: false, payouts_enabled: false, details_submitted: false },
  );
  const linkCreate = vi.fn().mockResolvedValue({ url: 'https://stripe.test/onboard' });

  return {
    deps: {
      stripe: { accounts: { retrieve, create }, accountLinks: { create: linkCreate } },
      db: { from },
      getUser,
      allowedOriginsEnv: undefined,
      corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    },
    from, getUser, update, eqUpdate, insert, retrieve, create, linkCreate,
  };
};

const run = (m: ReturnType<typeof makeDeps>, req = makeReq()) =>
  handleCreateConnectedAccount(req, m.deps as any);

describe('handleCreateConnectedAccount', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const m = makeDeps();
    const res = await run(m, makeReq({ restaurantId: RID }, {}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it('returns 401 when the token lookup fails', async () => {
    const m = makeDeps({ user: null, authError: { message: 'bad' } });
    const res = await run(m);
    expect(res.status).toBe(401);
    expect(m.getUser).toHaveBeenCalledWith('tok');
  });

  it('returns 400 on an invalid body', async () => {
    const m = makeDeps();
    const res = await run(m, makeReq('not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  it('returns 400 when restaurantId is missing', async () => {
    const m = makeDeps();
    const res = await run(m, makeReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Restaurant ID is required' });
  });

  it('returns 403 when the user is not an owner', async () => {
    const m = makeDeps({ role: 'manager' });
    const res = await run(m);
    expect(res.status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no membership row', async () => {
    const m = makeDeps({ role: null });
    const res = await run(m);
    expect(res.status).toBe(403);
  });

  it('returns a safe 500 on an access lookup error', async () => {
    const m = makeDeps({ accessError: { message: 'db secret detail' } });
    const res = await run(m);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('db secret detail');
  });

  it('statusOnly with no row returns a null account and calls no Stripe API', async () => {
    const m = makeDeps({ existing: null });
    const res = await run(m, makeReq({ restaurantId: RID, statusOnly: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, accountId: null, onboardingComplete: false });
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('statusOnly syncs the row from the live account and makes no link', async () => {
    const m = makeDeps({ existing: { id: 'row1', stripe_account_id: 'acct_old' } });
    const res = await run(m, makeReq({ restaurantId: RID, statusOnly: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, accountId: 'acct_old', onboardingComplete: true });
    expect(m.retrieve).toHaveBeenCalledWith('acct_old');
    expect(m.update.mock.calls[0][0]).toMatchObject({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      onboarding_complete: true,
    });
    expect(m.eqUpdate).toHaveBeenCalledWith('id', 'row1');
    expect(m.linkCreate).not.toHaveBeenCalled();
  });

  it('statusOnly fails with 500 when the update fails', async () => {
    const m = makeDeps({
      existing: { id: 'row1', stripe_account_id: 'acct_old' },
      updateError: { message: 'update detail' },
    });
    const res = await run(m, makeReq({ restaurantId: RID, statusOnly: true }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('update detail');
  });

  it('returns 500 when the existing row lookup fails', async () => {
    const m = makeDeps({ existingError: { message: 'lookup detail' } });
    const res = await run(m);
    expect(res.status).toBe(500);
  });

  it('continues without a link failure when the update fails and the caller is not statusOnly', async () => {
    const m = makeDeps({
      existing: { id: 'row1', stripe_account_id: 'acct_old' },
      updateError: { message: 'update detail' },
      live: liveOk,
    });
    const res = await run(m);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ onboardingComplete: true });
  });

  it('returns the already-set-up message when the live account is complete', async () => {
    const m = makeDeps({ existing: { id: 'row1', stripe_account_id: 'acct_old' } });
    const res = await run(m);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      accountId: 'acct_old',
      onboardingComplete: true,
      message: 'Stripe Connect account is already set up',
    });
    expect(m.linkCreate).not.toHaveBeenCalled();
  });

  it('retrieves the existing account and creates a link when onboarding is incomplete', async () => {
    const m = makeDeps({
      existing: { id: 'row1', stripe_account_id: 'acct_old' },
      live: liveIncomplete,
    });
    const res = await run(m);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, accountId: 'acct_old', onboardingUrl: 'https://stripe.test/onboard' });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.retrieve).toHaveBeenCalledTimes(2);
    expect(m.linkCreate.mock.calls[0][0]).toMatchObject({
      account: 'acct_old',
      type: 'account_onboarding',
      return_url: `${PROD}/invoices?success=true&account=acct_old`,
    });
  });

  it('creates an account with the idempotency key and inserts a row', async () => {
    const m = makeDeps({ existing: null });
    const res = await run(m);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, accountId: ACCT, onboardingUrl: 'https://stripe.test/onboard' });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'connect-acct-' + RID });
    expect(m.create.mock.calls[0][0]).toMatchObject({
      country: 'US',
      email: 'o@x.test',
      business_profile: { name: 'Cafe' },
      metadata: { restaurant_id: RID, restaurant_name: 'Cafe', requested_by_user_id: 'u1' },
    });
    expect(m.insert).toHaveBeenCalledWith({
      restaurant_id: RID,
      stripe_account_id: ACCT,
      account_type: 'express',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_complete: false,
    });
    expect(m.linkCreate.mock.calls[0][0]).toMatchObject({ account: ACCT });
  });

  it('returns 500 when the restaurant lookup fails', async () => {
    const m = makeDeps({ restaurantError: { message: 'r detail' }, restaurant: null });
    const res = await run(m);
    expect(res.status).toBe(500);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('on a 23505 race, uses the stored account and creates no second one', async () => {
    const m = makeDeps({
      existing: null,
      insertError: { code: '23505', message: 'dup' },
      raceRow: { stripe_account_id: 'acct_winner' },
      live: { id: 'acct_winner' },
    });
    const res = await run(m);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, accountId: 'acct_winner' });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.retrieve).toHaveBeenCalledWith('acct_winner');
    expect(m.linkCreate.mock.calls[0][0]).toMatchObject({ account: 'acct_winner' });
  });

  it('returns 500 when a 23505 race finds no stored row', async () => {
    const m = makeDeps({ existing: null, insertError: { code: '23505' }, raceRow: null });
    const res = await run(m);
    expect(res.status).toBe(500);
    expect(m.linkCreate).not.toHaveBeenCalled();
  });

  it('returns 500 and makes no link on another insert error', async () => {
    const m = makeDeps({ existing: null, insertError: { code: '42501', message: 'insert detail' } });
    const res = await run(m);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('insert detail');
    expect(m.linkCreate).not.toHaveBeenCalled();
  });

  it('adds CORS headers to error responses', async () => {
    const m = makeDeps();
    const res = await run(m, makeReq({}, {}));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
