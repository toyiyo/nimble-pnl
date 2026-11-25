import { describe, it, expect, vi } from 'vitest';
import { handleAccountUpdated } from '../../supabase/functions/_shared/stripeAccountUpdatedHandler';

const ACCT = 'acct_123';

const makeEvent = (over: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  type: 'account.updated',
  account: ACCT,
  data: { object: { id: ACCT, charges_enabled: false } },
  ...over,
});

const makeDeps = (opts: {
  row?: { id: string } | null;
  selectError?: unknown;
  updateError?: unknown;
  live?: unknown;
  retrieveError?: Error;
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
  return {
    deps: { stripe: { accounts: { retrieve } }, db: { from } },
    from, select, eqSelect, update, eqUpdate, retrieve,
  };
};

describe('handleAccountUpdated', () => {
  it('ignores events with no event.account', async () => {
    const m = makeDeps();
    const res = await handleAccountUpdated(makeEvent({ account: undefined }), m.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(m.from).not.toHaveBeenCalled();
  });

  it('ignores events when data.object.id differs from event.account', async () => {
    const m = makeDeps();
    const res = await handleAccountUpdated(
      makeEvent({ data: { object: { id: 'acct_other' } } }),
      m.deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(m.retrieve).not.toHaveBeenCalled();
  });

  it('returns unknown when no row matches the account', async () => {
    const m = makeDeps({ row: null });
    const res = await handleAccountUpdated(makeEvent(), m.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, unknown: true });
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('uses the live account and updates only the status columns', async () => {
    const m = makeDeps();
    const res = await handleAccountUpdated(makeEvent(), m.deps);
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

  it('trusts the live account, not the event payload', async () => {
    const m = makeDeps({
      live: { charges_enabled: false, payouts_enabled: false, details_submitted: true },
    });
    const res = await handleAccountUpdated(
      makeEvent({ data: { object: { id: ACCT, charges_enabled: true } } }),
      m.deps,
    );
    expect(res.status).toBe(200);
    const payload = m.update.mock.calls[0][0];
    expect(payload.charges_enabled).toBe(false);
    expect(payload.onboarding_complete).toBe(false);
  });

  it('adds the given headers to the response', async () => {
    const m = makeDeps();
    const res = await handleAccountUpdated(makeEvent(), m.deps, { 'X-Test': '1' });
    expect(res.headers.get('X-Test')).toBe('1');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('logs event id, type and account id when processing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = makeDeps({ retrieveError: new Error('boom') });
    await handleAccountUpdated(makeEvent(), m.deps);
    expect(spy).toHaveBeenCalledWith(
      '[INVOICE-WEBHOOK][account.updated] Processing failed:',
      expect.objectContaining({ eventId: 'evt_1', eventType: 'account.updated', accountId: ACCT }),
    );
    spy.mockRestore();
  });

  it('returns 500 with a safe body on a Stripe error', async () => {
    const m = makeDeps({ retrieveError: new Error('stripe secret detail') });
    const res = await handleAccountUpdated(makeEvent(), m.deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('Webhook processing failed');
    expect(text).not.toContain('stripe secret detail');
  });

  it('returns 500 with a safe body on a DB update error', async () => {
    const m = makeDeps({ updateError: { message: 'db detail' } });
    const res = await handleAccountUpdated(makeEvent(), m.deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('Webhook processing failed');
    expect(text).not.toContain('db detail');
  });

  it('returns 500 on a DB select error', async () => {
    const m = makeDeps({ selectError: { message: 'db detail' } });
    const res = await handleAccountUpdated(makeEvent(), m.deps);
    expect(res.status).toBe(500);
  });
});
