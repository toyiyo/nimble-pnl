import { describe, it, expect, vi } from 'vitest';
import {
  handleIntegrationDisconnectAlert,
  type AlertDeps,
} from '../../supabase/functions/_shared/integrationDisconnectAlertHandler';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-21T12:00:00Z');

function makeDeps(over: Partial<AlertDeps> = {}): AlertDeps {
  return {
    getCallerId: vi.fn(async () => 'u1'),
    loadEvent: vi.fn(async () => ({
      id: EVENT_ID,
      restaurant_id: 'r1',
      integration: 'toast',
      event: 'disconnect',
      actor_user_id: 'u1',
      reason: 'switching_pos',
      reason_text: 'bye',
      created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    })),
    claimAlert: vi.fn(async () => true),
    markAlerted: vi.fn(async () => {}),
    loadRecipients: vi.fn(async () => [
      { user_id: 'o1', email: 'o1@x.com', full_name: 'O1', role: 'owner' },
      { user_id: 'o2', email: 'o2@x.com', full_name: 'O2', role: 'owner' },
    ]),
    loadRestaurant: vi.fn(async () => ({ name: 'Taco', timezone: 'America/New_York' })),
    loadActor: vi.fn(async () => ({ full_name: 'Ana', email: 'ana@x.com' })),
    sendEmail: vi.fn(async () => ({ ok: true, status: 200 })),
    fetch: vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
    slackWebhookUrl: 'https://hooks.example/slack',
    appUrl: 'https://app.example.com',
    now: () => NOW,
    pacedOptions: { sleep: async () => {} },
    log: vi.fn(),
    ...over,
  };
}

describe('handleIntegrationDisconnectAlert', () => {
  it('returns 400 for a bad UUID', async () => {
    const res = await handleIntegrationDisconnectAlert(makeDeps(), { eventId: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when there is no caller', async () => {
    const res = await handleIntegrationDisconnectAlert(
      makeDeps({ getCallerId: vi.fn(async () => null) }),
      { eventId: EVENT_ID },
    );
    expect(res.status).toBe(401);
  });

  it('returns the same 404 for a missing event and a wrong actor', async () => {
    const missing = await handleIntegrationDisconnectAlert(
      makeDeps({ loadEvent: vi.fn(async () => null) }),
      { eventId: EVENT_ID },
    );
    const wrong = await handleIntegrationDisconnectAlert(
      makeDeps({ getCallerId: vi.fn(async () => 'other') }),
      { eventId: EVENT_ID },
    );
    expect(missing.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(wrong.body).toEqual(missing.body);
  });

  it('returns 404 when the event is not a disconnect', async () => {
    const deps = makeDeps();
    (deps.loadEvent as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: EVENT_ID, restaurant_id: 'r1', integration: 'toast', event: 'connect',
      actor_user_id: 'u1', reason: null, reason_text: null, created_at: NOW.toISOString(),
    });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the event is older than 1 hour', async () => {
    const deps = makeDeps();
    (deps.loadEvent as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: EVENT_ID, restaurant_id: 'r1', integration: 'toast', event: 'disconnect',
      actor_user_id: 'u1', reason: null, reason_text: null,
      created_at: new Date(NOW.getTime() - 61 * 60_000).toISOString(),
    });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.status).toBe(404);
    expect(deps.claimAlert).not.toHaveBeenCalled();
  });

  it('skips when the lease claim fails', async () => {
    const deps = makeDeps({ claimAlert: vi.fn(async () => false) });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skipped: 'already_alerted' });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('sends one email to each owner, posts Slack, and marks alerted', async () => {
    const deps = makeDeps();
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.status).toBe(200);
    expect(deps.sendEmail).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual({ emailsSent: 2, emailsFailed: 0, slack: 'sent' });
    expect(deps.markAlerted).toHaveBeenCalledWith(EVENT_ID);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('treats zero owners as success and still posts Slack', async () => {
    const deps = makeDeps({ loadRecipients: vi.fn(async () => []) });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.body).toEqual({ emailsSent: 0, emailsFailed: 0, slack: 'sent' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(deps.markAlerted).toHaveBeenCalled();
  });

  it('uses A team member when the actor is missing', async () => {
    const deps = makeDeps({ loadActor: vi.fn(async () => null) });
    await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    const html = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(html).toContain('A team member');
  });

  it('skips Slack when the webhook is not set', async () => {
    const deps = makeDeps({ slackWebhookUrl: undefined });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ slack: 'skipped' });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('slack_skipped'));
  });

  it('escapes <!channel> and <script> in the Slack body', async () => {
    const deps = makeDeps();
    (deps.loadEvent as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: EVENT_ID, restaurant_id: 'r1', integration: 'toast', event: 'disconnect',
      actor_user_id: 'u1', reason: 'other', reason_text: '<!channel> <script>',
      created_at: NOW.toISOString(),
    });
    await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    const init = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.link_names).toBe(false);
    expect(body.text).not.toContain('<!channel>');
    expect(body.text).not.toContain('<script>');
  });

  it('aborts a slow Slack post and reports failed', async () => {
    const slowFetch = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      }),
    ) as unknown as typeof fetch;
    const deps = makeDeps({ fetch: slowFetch, slackTimeoutMs: 20 });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.body).toMatchObject({ slack: 'failed', emailsSent: 2 });
  });

  it('leaves alerted_at NULL when every send fails', async () => {
    const deps = makeDeps({
      sendEmail: vi.fn(async () => ({ ok: false, status: 500, error: 'x' })),
      fetch: vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    });
    const res = await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(res.body).toMatchObject({ emailsSent: 0, emailsFailed: 2, slack: 'failed' });
    expect(deps.markAlerted).not.toHaveBeenCalled();
  });

  it('marks alerted when only Slack succeeds', async () => {
    const deps = makeDeps({ sendEmail: vi.fn(async () => ({ ok: false, status: 500 })) });
    await handleIntegrationDisconnectAlert(deps, { eventId: EVENT_ID });
    expect(deps.markAlerted).toHaveBeenCalled();
  });
});
