import { describe, it, expect, vi } from 'vitest';
import { handleStripeConnectWebhook } from '../../supabase/functions/_shared/stripeConnectWebhookHandler';

const ACCT = 'acct_123';

const makeReq = (headers: Record<string, string> = { 'stripe-signature': 'sig' }) =>
  new Request('https://example.test/hook', { method: 'POST', headers, body: '{"raw":true}' });

const makeEvent = (over: Record<string, unknown> = {}) => ({
  type: 'account.updated',
  account: ACCT,
  data: { object: { id: ACCT, charges_enabled: false } },
  ...over,
});

const makeDeps = (opts: {
  event?: unknown;
  constructError?: Error;
  row?: { id: string } | null;
  selectError?: unknown;
  updateError?: unknown;
  live?: unknown;
  retrieveError?: Error;
  secret?: string;
} = {}) => {
  const eqUpdate = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const update = vi.fn().mockReturnValue({ eq: eqUpdate });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.row === undefined ? { id: 'row1' } : opts.row,
    error: opts.selectError ?? null,
  });
  const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: eqSelect });
  const from = vi.fn().mockReturnValue({ select, update });
  const retrieve = opts.retrieveError
    ? vi.fn().mockRejectedValue(opts.retrieveError)
    : vi.fn().mockResolvedValue(
        opts.live ?? { charges_enabled: true, payouts_enabled: true, details_submitted: true },
      );
  const constructEventAsync = opts.constructError
    ? vi.fn().mockRejectedValue(opts.constructError)
    : vi.fn().mockResolvedValue(opts.event ?? makeEvent());
  return {
    deps: {
      secret: opts.secret ?? 'whsec_test',
      stripe: { webhooks: { constructEventAsync }, accounts: { retrieve } },
      db: { from },
    },
    from, select, eqSelect, update, eqUpdate, retrieve, constructEventAsync,
  };
};

describe('handleStripeConnectWebhook', () => {
  it('returns 500 when the secret is empty', async () => {
    const m = makeDeps({ secret: '' });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(500);
    expect(m.constructEventAsync).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature header is missing', async () => {
    const m = makeDeps();
    const res = await handleStripeConnectWebhook(makeReq({}), m.deps as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    const m = makeDeps({ constructError: new Error('bad sig detail') });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('bad sig detail');
  });

  it('reads the raw body before the signature check', async () => {
    const m = makeDeps();
    await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(m.constructEventAsync).toHaveBeenCalledWith('{"raw":true}', 'sig', 'whsec_test');
  });

  it('ignores events that are not account.updated', async () => {
    const m = makeDeps({ event: makeEvent({ type: 'customer.created' }) });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(m.from).not.toHaveBeenCalled();
  });

  it('ignores events with no event.account', async () => {
    const m = makeDeps({ event: makeEvent({ account: undefined }) });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(m.from).not.toHaveBeenCalled();
  });

  it('ignores events when data.object.id differs from event.account', async () => {
    const m = makeDeps({ event: makeEvent({ data: { object: { id: 'acct_other' } } }) });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(m.retrieve).not.toHaveBeenCalled();
  });

  it('returns unknown when no row matches the account', async () => {
    const m = makeDeps({ row: null });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, unknown: true });
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('uses the live account and updates only the status columns', async () => {
    const m = makeDeps();
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(200);
    expect(m.retrieve).toHaveBeenCalledWith(ACCT);
    expect(m.eqSelect).toHaveBeenCalledWith('stripe_account_id', ACCT);
    const payload = m.update.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ['charges_enabled', 'details_submitted', 'onboarding_complete', 'payouts_enabled', 'updated_at'],
    );
    expect(payload).toMatchObject({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      onboarding_complete: true,
    });
    expect(m.eqUpdate).toHaveBeenCalledWith('stripe_account_id', ACCT);
  });

  it('returns 500 with a safe body on a Stripe error', async () => {
    const m = makeDeps({ retrieveError: new Error('stripe secret detail') });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('Webhook processing failed');
    expect(text).not.toContain('stripe secret detail');
  });

  it('returns 500 with a safe body on a DB update error', async () => {
    const m = makeDeps({ updateError: { message: 'db detail' } });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('Webhook processing failed');
    expect(text).not.toContain('db detail');
  });

  it('returns 500 on a DB select error', async () => {
    const m = makeDeps({ selectError: { message: 'db detail' } });
    const res = await handleStripeConnectWebhook(makeReq(), m.deps as any);
    expect(res.status).toBe(500);
  });
});
