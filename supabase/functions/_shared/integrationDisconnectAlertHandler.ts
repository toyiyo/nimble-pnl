// Pure orchestration for notify-integration-disconnect (design 4.5).
// The Deno entry wires real clients into AlertDeps. Tests inject mocks.

import { sendPaced, type EmailSendResult, type PacedOptions } from './emailQueue.ts';
import {
  buildIntegrationDisconnectEmail,
  buildIntegrationDisconnectSlackPayload,
  type DisconnectAlertInput,
} from './integrationDisconnectAlertContent.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;
const DEFAULT_SLACK_TIMEOUT_MS = 3000;

export interface DisconnectEventRow {
  id: string;
  restaurant_id: string;
  integration: string;
  event: string;
  actor_user_id: string | null;
  reason: string | null;
  reason_text: string | null;
  created_at: string;
}

export interface AlertRecipient {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

export interface AlertDeps {
  getCallerId: () => Promise<string | null>;
  loadEvent: (eventId: string) => Promise<DisconnectEventRow | null>;
  claimAlert: (eventId: string) => Promise<boolean>;
  markAlerted: (eventId: string) => Promise<void>;
  loadRecipients: (restaurantId: string) => Promise<AlertRecipient[]>;
  loadRestaurant: (
    restaurantId: string,
  ) => Promise<{ name: string | null; timezone: string | null } | null>;
  loadActor: (userId: string) => Promise<{ full_name: string | null; email: string | null } | null>;
  sendEmail: (to: string, subject: string, html: string) => Promise<EmailSendResult>;
  fetch: typeof fetch;
  slackWebhookUrl?: string;
  slackTimeoutMs?: number;
  appUrl: string;
  now: () => Date;
  pacedOptions?: PacedOptions;
  log: (message: string) => void;
}

export interface AlertResponse {
  status: number;
  body: Record<string, unknown>;
}

const NOT_FOUND: AlertResponse = { status: 404, body: { error: 'Not found' } };

type SlackStatus = 'sent' | 'failed' | 'skipped';

async function postSlack(deps: AlertDeps, input: DisconnectAlertInput): Promise<SlackStatus> {
  if (!deps.slackWebhookUrl) {
    deps.log('slack_skipped');
    return 'skipped';
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.slackTimeoutMs ?? DEFAULT_SLACK_TIMEOUT_MS,
  );
  try {
    const res = await deps.fetch(deps.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildIntegrationDisconnectSlackPayload(input)),
      signal: controller.signal,
    });
    if (!res.ok) {
      deps.log(`slack_failed status=${res.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    // Log the error name only. A fetch error message can contain the webhook URL, which is a secret.
    deps.log(`slack_failed ${err instanceof Error ? err.name : 'unknown_error'}`);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

// One failed lookup must not stop the other channel. Log the error name only and use the fallback.
function settledValue<T>(
  deps: AlertDeps,
  label: string,
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  if (result.status === 'fulfilled') return result.value;
  const err = result.reason;
  deps.log(`lookup_failed ${label} ${err instanceof Error ? err.name : 'unknown_error'}`);
  return fallback;
}

export async function handleIntegrationDisconnectAlert(
  deps: AlertDeps,
  payload: { eventId?: unknown },
): Promise<AlertResponse> {
  const eventId = payload?.eventId;
  if (typeof eventId !== 'string' || !UUID_RE.test(eventId)) {
    return { status: 400, body: { error: 'Invalid eventId' } };
  }

  const callerId = await deps.getCallerId();
  if (!callerId) return { status: 401, body: { error: 'Unauthorized' } };

  // One 404 for every miss, so a caller cannot probe event ids.
  const event = await deps.loadEvent(eventId);
  if (
    !event ||
    event.actor_user_id !== callerId ||
    event.event !== 'disconnect' ||
    deps.now().getTime() - new Date(event.created_at).getTime() > MAX_EVENT_AGE_MS
  ) {
    return NOT_FOUND;
  }

  if (!(await deps.claimAlert(eventId))) {
    return { status: 200, body: { skipped: 'already_alerted' } };
  }

  const [recipientsResult, restaurantResult, actorResult] = await Promise.allSettled([
    deps.loadRecipients(event.restaurant_id),
    deps.loadRestaurant(event.restaurant_id),
    event.actor_user_id ? deps.loadActor(event.actor_user_id) : Promise.resolve(null),
  ]);
  const recipients = settledValue(deps, 'recipients', recipientsResult, []);
  const restaurant = settledValue(deps, 'restaurant', restaurantResult, null);
  const actor = settledValue(deps, 'actor', actorResult, null);

  const input: DisconnectAlertInput = {
    integration: event.integration,
    restaurantId: event.restaurant_id,
    restaurantName: restaurant?.name ?? null,
    restaurantTimezone: restaurant?.timezone ?? null,
    actorName: actor?.full_name || actor?.email || null,
    actorEmail: actor?.email ?? null,
    occurredAt: event.created_at,
    reason: event.reason,
    reasonText: event.reason_text,
    appUrl: deps.appUrl,
  };

  const { subject, html } = buildIntegrationDisconnectEmail(input);
  const targets = recipients.filter((r): r is AlertRecipient & { email: string } => Boolean(r.email));
  const results = await sendPaced(
    targets,
    (r) => deps.sendEmail(r.email, subject, html),
    deps.pacedOptions,
  );
  const emailsSent = results.filter((r) => r.ok).length;
  const emailsFailed = results.length - emailsSent;

  const slack = await postSlack(deps, input);

  const body = { emailsSent, emailsFailed, slack };
  if (emailsSent > 0 || slack === 'sent') {
    await deps.markAlerted(eventId);
    return { status: 200, body };
  }
  // Nothing went out. Log one line and return 502 so the function logs show the lost alert.
  deps.log(`alert_failed event=${eventId} emails_failed=${emailsFailed} slack=${slack}`);
  return { status: 502, body };
}
