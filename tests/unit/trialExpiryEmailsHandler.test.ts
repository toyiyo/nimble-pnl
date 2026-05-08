import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runTrialExpiryEmails,
  type TrialEmailRow,
  type TrialEmailDeps,
  type SendEmailFn,
  type RecordSentFn,
  type TelemetryFn,
} from '../../supabase/functions/_shared/trialExpiryEmailsHandler';
import { verifyUnsubscribe } from '../../supabase/functions/_shared/unsubscribeToken';

const SECRET = 'unit-secret';
const APP_URL = 'https://app.example.com';
const FROM = 'Test <test@example.com>';

function row(over: Partial<TrialEmailRow> = {}): TrialEmailRow {
  return {
    restaurant_id: 'r-1',
    user_id: 'u-1',
    email: 'op@example.com',
    full_name: 'Operator One',
    trial_day: 7,
    activated: false,
    email_type: 'halfway',
    ...over,
  };
}

interface SendCall {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface SentCall {
  restaurant_id: string;
  user_id: string;
  email_type: string;
  variant: string;
  trial_day_at_send: number;
  resend_message_id: string | null;
}

function makeDeps(opts: {
  candidates?: TrialEmailRow[];
  sendImpl?: SendEmailFn;
  recordImpl?: RecordSentFn;
  telemetryImpl?: TelemetryFn;
} = {}) {
  const sendCalls: SendCall[] = [];
  const sentCalls: SentCall[] = [];
  const telemetry: Array<{ event: string; props: Record<string, unknown> }> = [];

  const fetchCandidates = vi
    .fn()
    .mockResolvedValue({ data: opts.candidates ?? [], error: null });

  const send: SendEmailFn = opts.sendImpl ?? (async (msg) => {
    sendCalls.push({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    return { id: `resend-${sendCalls.length}`, error: null };
  });

  const record: RecordSentFn = opts.recordImpl ?? (async (row) => {
    sentCalls.push(row);
    return { error: null };
  });

  const capture: TelemetryFn = opts.telemetryImpl ?? (async (input) => {
    telemetry.push({ event: input.event, props: input.properties ?? {} });
  });

  const deps: TrialEmailDeps = {
    fetchCandidates,
    send,
    record,
    capture,
    fromEmail: FROM,
    appUrl: APP_URL,
    unsubscribeSecret: SECRET,
  };

  return { deps, sendCalls, sentCalls, telemetry, fetchCandidates };
}

describe('runTrialExpiryEmails', () => {
  let env: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    env = makeDeps();
  });

  it('returns count=0 with no candidates', async () => {
    const { deps } = env;
    const out = await runTrialExpiryEmails(deps);
    expect(out.count).toBe(0);
    expect(out.results).toEqual([]);
  });

  it('uses activated variant when row.activated=true', async () => {
    env = makeDeps({ candidates: [row({ activated: true, email_type: 'halfway' })] });
    const out = await runTrialExpiryEmails(env.deps);
    expect(out.results[0].variant).toBe('activated');
    expect(env.sentCalls[0].variant).toBe('activated');
  });

  it('uses not_activated variant when row.activated=false', async () => {
    env = makeDeps({ candidates: [row({ activated: false, email_type: '3_days' })] });
    const out = await runTrialExpiryEmails(env.deps);
    expect(out.results[0].variant).toBe('not_activated');
    expect(env.sentCalls[0].variant).toBe('not_activated');
  });

  it('sends to row.email with rendered subject/html/text', async () => {
    env = makeDeps({ candidates: [row({ email: 'recipient@op.com' })] });
    await runTrialExpiryEmails(env.deps);
    expect(env.sendCalls).toHaveLength(1);
    expect(env.sendCalls[0].to).toBe('recipient@op.com');
    expect(env.sendCalls[0].subject.length).toBeGreaterThan(0);
    expect(env.sendCalls[0].html).toContain('<');
    expect(env.sendCalls[0].text).not.toMatch(/<[^>]+>/);
  });

  it('records the sent email with resend_message_id and trial_day_at_send', async () => {
    env = makeDeps({ candidates: [row({ trial_day: 11, email_type: '3_days' })] });
    await runTrialExpiryEmails(env.deps);
    expect(env.sentCalls).toHaveLength(1);
    expect(env.sentCalls[0]).toMatchObject({
      restaurant_id: 'r-1',
      user_id: 'u-1',
      email_type: '3_days',
      trial_day_at_send: 11,
      resend_message_id: 'resend-1',
    });
  });

  it('captures trial_email_sent telemetry per send', async () => {
    env = makeDeps({ candidates: [row({ activated: true, email_type: 'tomorrow' })] });
    await runTrialExpiryEmails(env.deps);
    expect(env.telemetry).toHaveLength(1);
    expect(env.telemetry[0].event).toBe('trial_email_sent');
    expect(env.telemetry[0].props).toMatchObject({
      email_type: 'tomorrow',
      variant: 'activated',
      restaurant_id: 'r-1',
    });
  });

  it('embeds an unsubscribe URL with a verifiable HMAC token', async () => {
    env = makeDeps({ candidates: [row({ user_id: 'u-99' })] });
    await runTrialExpiryEmails(env.deps);
    const html = env.sendCalls[0].html;
    const m = html.match(/unsubscribe\?token=([^&]+)&amp;list=trial_lifecycle/);
    expect(m).not.toBeNull();
    const verified = await verifyUnsubscribe(decodeURIComponent(m![1]), SECRET);
    expect(verified).toEqual({ user_id: 'u-99', list: 'trial_lifecycle' });
  });

  it('marks the row as error and skips record when send fails', async () => {
    const failingSend: SendEmailFn = async () => ({
      id: null,
      error: { message: 'resend down' },
    });
    env = makeDeps({ candidates: [row()], sendImpl: failingSend });
    const out = await runTrialExpiryEmails(env.deps);
    expect(out.results[0].status).toBe('error');
    expect(out.results[0].error).toMatch(/resend/i);
    expect(env.sentCalls).toHaveLength(0);
    expect(env.telemetry).toHaveLength(0);
  });

  it('continues processing siblings after one row fails', async () => {
    let n = 0;
    const sometimesFail: SendEmailFn = async (msg) => {
      n++;
      if (n === 1) return { id: null, error: { message: 'first failed' } };
      return { id: `ok-${n}`, error: null };
    };
    env = makeDeps({
      candidates: [row({ user_id: 'u-1' }), row({ user_id: 'u-2' })],
      sendImpl: sometimesFail,
    });
    const out = await runTrialExpiryEmails(env.deps);
    expect(out.count).toBe(2);
    expect(out.results[0].status).toBe('error');
    expect(out.results[1].status).toBe('sent');
    expect(env.sentCalls).toHaveLength(1);
    expect(env.sentCalls[0].user_id).toBe('u-2');
  });

  it('does not throw when telemetry capture rejects', async () => {
    const broken: TelemetryFn = async () => {
      throw new Error('posthog blew up');
    };
    env = makeDeps({ candidates: [row()], telemetryImpl: broken });
    const out = await runTrialExpiryEmails(env.deps);
    expect(out.results[0].status).toBe('sent');
  });

  it('returns count=0 and surfaces an error when fetchCandidates fails', async () => {
    const deps: TrialEmailDeps = {
      ...env.deps,
      fetchCandidates: async () => ({ data: null, error: { message: 'rpc broke' } }),
    };
    const out = await runTrialExpiryEmails(deps);
    expect(out.count).toBe(0);
    expect(out.error).toMatch(/rpc/);
  });

  it('still returns sent=true when record fails (telemetry continues)', async () => {
    const failingRecord: RecordSentFn = async () => ({
      error: { message: 'unique violation' },
    });
    env = makeDeps({ candidates: [row()], recordImpl: failingRecord });
    const out = await runTrialExpiryEmails(env.deps);
    // Email was sent successfully — but we couldn't record dedupe.
    // Spec choice: we report 'sent' but include record_error so an
    // operator can investigate. Telemetry still fires.
    expect(out.results[0].status).toBe('sent');
    expect(out.results[0].record_error).toMatch(/unique/);
    expect(env.telemetry).toHaveLength(1);
  });
});
