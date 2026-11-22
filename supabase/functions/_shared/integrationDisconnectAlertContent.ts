// Pure content builders for the integration disconnect alert (design 4.5).
// No client code, so vitest tests it directly.

import { generateEmailTemplate, formatDateTime } from './emailTemplates.ts';
import { safeTz } from './timezone.ts';
import { cleanRestaurantName } from './bankReauthNoticeContent.ts';

// Keep these labels equal to DISCONNECT_REASON_LABELS in src/lib/integrationDisconnect.ts.
const REASON_LABELS: Record<string, string> = {
  switching_pos: 'I am switching to a different POS',
  credentials_changed: 'My credentials changed',
  temporary_close: 'We are closed for a while',
  no_value: 'I do not get value from it',
  too_expensive: 'It costs too much',
  other: 'Other',
};

const INTEGRATION_NAMES: Record<string, string> = {
  revel: 'Revel',
  toast: 'Toast',
  square: 'Square',
  clover: 'Clover',
  shift4: 'Shift4',
  focus: 'Focus',
  bank: 'Bank',
};

export const MAX_REASON_TEXT_LENGTH = 500;
const FALLBACK_ACTOR = 'A team member';

export interface DisconnectAlertInput {
  integration: string;
  restaurantId: string;
  restaurantName: string | null;
  restaurantTimezone?: string | null;
  actorName: string | null;
  actorEmail?: string | null;
  occurredAt: string;
  reason: string | null;
  reasonText: string | null;
  appUrl: string;
}

export function integrationDisplayName(key: string): string {
  return INTEGRATION_NAMES[key] ?? key;
}

export function reasonLabel(reason: string | null): string | null {
  return reason ? (REASON_LABELS[reason] ?? reason) : null;
}

function capReasonText(text: string | null): string | null {
  if (!text) return null;
  return Array.from(text).slice(0, MAX_REASON_TEXT_LENGTH).join('');
}

export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function restaurantLabel(input: DisconnectAlertInput): string {
  return cleanRestaurantName(input.restaurantName) ?? 'your restaurant';
}

export function buildIntegrationDisconnectEmail(input: DisconnectAlertInput): {
  subject: string;
  html: string;
} {
  const integration = integrationDisplayName(input.integration);
  const restaurant = restaurantLabel(input);
  const actor = input.actorName?.trim() || FALLBACK_ACTOR;
  const when = formatDateTime(input.occurredAt, safeTz(input.restaurantTimezone));
  const label = reasonLabel(input.reason);
  const text = capReasonText(input.reasonText);

  const items = [
    { label: 'Integration', value: integration },
    { label: 'Disconnected by', value: actor },
    { label: 'When', value: when },
    ...(label ? [{ label: 'Reason', value: label }] : []),
    ...(text ? [{ label: 'Details', value: text }] : []),
  ];

  const html = generateEmailTemplate({
    heading: `${integration} was disconnected`,
    statusBadge: { text: 'Disconnected', color: '#ef4444' },
    message: `${actor} disconnected ${integration} from ${restaurant}. This is a security alert for restaurant owners.`,
    detailsCard: { items },
    ctaButton: { text: 'Reconnect', url: `${input.appUrl.replace(/\/+$/, '')}/integrations` },
  });

  return { subject: `${integration} was disconnected from ${restaurant}`, html };
}

export interface SlackPayload {
  text: string;
  link_names: false;
  blocks: unknown[];
}

export function buildIntegrationDisconnectSlackPayload(input: DisconnectAlertInput): SlackPayload {
  const integration = integrationDisplayName(input.integration);
  const restaurant = restaurantLabel(input);
  const label = reasonLabel(input.reason);
  const text = capReasonText(input.reasonText);
  const actorEmail = input.actorEmail ?? 'unknown';

  const fields = [
    { type: 'plain_text', text: `Restaurant: ${restaurant}` },
    { type: 'plain_text', text: `Restaurant id: ${input.restaurantId}` },
    { type: 'plain_text', text: `Actor: ${actorEmail}` },
    { type: 'plain_text', text: `Reason: ${label ?? 'none'}` },
    ...(text ? [{ type: 'plain_text', text: `Details: ${text}` }] : []),
  ];

  return {
    // The top-level text is mrkdwn, so escape every free-text value.
    text: escapeSlackText(`${integration} was disconnected from ${restaurant}`),
    link_names: false,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${integration} disconnected` },
      },
      { type: 'section', fields },
    ],
  };
}
