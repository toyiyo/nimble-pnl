// Pure logic for the trial-expiry-emails edge function.
//
// The Deno entry wires real Supabase / Resend / PostHog clients into the
// dependency interface; tests inject mocks. Telemetry failures must
// never surface to the caller — every send is independent.

import { renderTrialEmail, type EmailType, type Variant } from './trialEmailTemplates.ts';
import { signUnsubscribe } from './unsubscribeToken.ts';

export interface TrialEmailRow {
  restaurant_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  trial_day: number;
  activated: boolean;
  email_type: EmailType;
}

export type FetchCandidatesFn = () => Promise<{
  data: TrialEmailRow[] | null;
  error: { message: string } | null;
}>;

export type SendEmailFn = (msg: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}) => Promise<{ id: string | null; error: { message: string } | null }>;

export type RecordSentFn = (row: {
  restaurant_id: string;
  user_id: string;
  email_type: EmailType;
  variant: Variant;
  trial_day_at_send: number;
  resend_message_id: string | null;
}) => Promise<{ error: { message: string } | null }>;

export type TelemetryFn = (input: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) => Promise<void>;

export interface TrialEmailDeps {
  fetchCandidates: FetchCandidatesFn;
  send: SendEmailFn;
  record: RecordSentFn;
  capture: TelemetryFn;
  fromEmail: string;
  appUrl: string;
  unsubscribeSecret: string;
}

export interface PerEmailResult {
  user_id: string;
  restaurant_id: string;
  email_type: EmailType;
  variant: Variant;
  status: 'sent' | 'error';
  error?: string;
  record_error?: string;
  message_id?: string | null;
}

export interface TrialEmailRunResult {
  count: number;
  results: PerEmailResult[];
  error?: string;
}

function firstNameOf(full?: string | null): string {
  const trimmed = full?.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

async function buildUnsubscribeUrl(
  appUrl: string,
  userId: string,
  secret: string
): Promise<string> {
  const token = await signUnsubscribe(
    { user_id: userId, list: 'trial_lifecycle' },
    secret
  );
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}&list=trial_lifecycle`;
}

export async function runTrialExpiryEmails(
  deps: TrialEmailDeps
): Promise<TrialEmailRunResult> {
  const { data, error } = await deps.fetchCandidates();
  if (error) {
    return { count: 0, results: [], error: error.message };
  }
  const rows = data ?? [];
  const results: PerEmailResult[] = [];

  for (const row of rows) {
    const variant: Variant = row.activated ? 'activated' : 'not_activated';
    const unsubscribeUrl = await buildUnsubscribeUrl(
      deps.appUrl,
      row.user_id,
      deps.unsubscribeSecret
    );
    const rendered = renderTrialEmail(row.email_type, variant, {
      firstName: firstNameOf(row.full_name),
      unsubscribeUrl,
      appUrl: deps.appUrl,
    });

    const sent = await deps.send({
      to: row.email,
      from: deps.fromEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (sent.error || !sent.id) {
      results.push({
        user_id: row.user_id,
        restaurant_id: row.restaurant_id,
        email_type: row.email_type,
        variant,
        status: 'error',
        error: sent.error?.message ?? 'unknown send error',
      });
      continue;
    }

    const recorded = await deps.record({
      restaurant_id: row.restaurant_id,
      user_id: row.user_id,
      email_type: row.email_type,
      variant,
      trial_day_at_send: row.trial_day,
      resend_message_id: sent.id,
    });

    try {
      await deps.capture({
        distinctId: row.user_id,
        event: 'trial_email_sent',
        properties: {
          restaurant_id: row.restaurant_id,
          email_type: row.email_type,
          variant,
          trial_day: row.trial_day,
          activated: row.activated,
        },
      });
    } catch (e) {
      console.warn('[trial-expiry-emails] telemetry capture failed:', (e as Error).message);
    }

    results.push({
      user_id: row.user_id,
      restaurant_id: row.restaurant_id,
      email_type: row.email_type,
      variant,
      status: 'sent',
      message_id: sent.id,
      ...(recorded.error ? { record_error: recorded.error.message } : {}),
    });
  }

  return { count: rows.length, results };
}
