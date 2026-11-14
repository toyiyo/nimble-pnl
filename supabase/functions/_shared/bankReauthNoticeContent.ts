// Pure email/push content builder for the bank-reauth-notices worker's
// escalation ladder (design §4.6's Day 1 / Day 4 / Day 10 / Recovered copy).
// No Supabase/Resend client — directly unit-testable under vitest, mirroring
// the pattern already used by `_shared/shiftDeletedNotification.ts` and
// `_shared/openShiftClaimNotify.ts`.

import { generateEmailTemplate, type EmailTemplateData } from './emailTemplates.ts';
import { safeTz } from './timezone.ts';
import type { NoticeStage } from './bankReauthStages.ts';

export interface BankReauthNoticeInput {
  stage: NoticeStage;
  institutionName: string;
  restaurantId: string;
  restaurantName?: string | null;
  accountMask: string | null;
  deactivatedAt: string; // ISO timestamptz — when this outage started
  elapsedDays?: number; // whole UTC days elapsed; unused for 'recovered'
  dataCurrentThrough?: string | null; // 'recovered' only — how far the backfill reaches
  appUrl: string; // caller-supplied (env-backed) app origin — no hardcoded domain here
  // The restaurant's IANA timezone, used to render deactivatedAt /
  // dataCurrentThrough below. Optional/nullable because not every caller
  // (older tests, a cohort row with a null restaurants.timezone) has it —
  // formatNoticeDate falls back to safeTz()'s restaurant default rather than
  // the server's zone either way.
  restaurantTimezone?: string | null;
}

// deactivatedAt/dataCurrentThrough are `timestamptz` columns — genuine
// moments in time (case b per .superpowers/sdd/tz-sweep-common.md), not
// stored calendar days. This email goes to a restaurant operator, so "what
// day did this happen" must be answered in the RESTAURANT's timezone, not
// this edge function's runtime zone (Deno can't import
// `src/lib/restaurantClock.ts`, but this mirrors its `formatInstant()`
// exactly: `Intl.DateTimeFormat` with an explicit `timeZone`, long-month
// pattern). `emailTemplates.ts`'s `formatDate()` has no timeZone override —
// it renders in whichever zone the process happens to be running in, which
// is the bug this replaces.
function formatNoticeDate(value: string, tz: string | null | undefined): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

const MAX_RESTAURANT_NAME_LENGTH = 60;
const BANKING_PATH = '/banking';
// Keep this key equal to SELECT_RESTAURANT_PARAM in src/lib/restaurantDeepLink.ts.
const SELECT_RESTAURANT_PARAM = 'select_restaurant';

// Clean a restaurant name for a subject line, a push title, and a message.
// Change each run of whitespace or control characters to one space, trim,
// delete bidi controls and zero-width spaces, and cut to MAX_RESTAURANT_NAME_LENGTH.
// Keep U+200C and U+200D: names in some scripts and emoji sequences need them.
// Return null for an empty result.
export function cleanRestaurantName(name: string | null | undefined): string | null {
  const cleaned = (name ?? '')
    .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  return chars.length > MAX_RESTAURANT_NAME_LENGTH
    ? `${chars.slice(0, MAX_RESTAURANT_NAME_LENGTH).join('')}…`
    : cleaned;
}

export interface BankReauthNoticePushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface BankReauthNoticeContent {
  subject: string;
  html: string;
  push?: BankReauthNoticePushPayload;
}

// Matches the `••{mask}` convention BankReauthBanner.tsx already renders
// (design §5.2's own literal example) — kept identical so the email/push
// and the in-app banner describe the same account the same way.
function maskedParenthetical(accountMask: string | null): string {
  return accountMask ? ` (••${accountMask})` : '';
}

interface StageCopy {
  heading: string;
  statusText: string;
  statusColor: string;
  message: string;
  subject: string;
  push?: BankReauthNoticePushPayload;
}

function bankingPath(restaurantId: string): string {
  return `${BANKING_PATH}?${SELECT_RESTAURANT_PARAM}=${encodeURIComponent(restaurantId)}`;
}

function copyForStage(input: BankReauthNoticeInput): StageCopy {
  const bankLabel = `${input.institutionName}${maskedParenthetical(input.accountMask)}`;
  const stoppedDate = formatNoticeDate(input.deactivatedAt, input.restaurantTimezone);
  const name = cleanRestaurantName(input.restaurantName);
  const prefix = name ? `${name}: ` : '';
  const at = name ? ` at ${name}` : '';
  const path = bankingPath(input.restaurantId);

  switch (input.stage) {
    case 'day_1':
      return {
        subject: `${prefix}Reconnect ${input.institutionName} — bank sync paused`,
        heading: 'Your bank connection needs attention',
        statusText: 'Needs reauthorization',
        statusColor: '#f59e0b',
        message: `${bankLabel}${at} ended its connection to EasyShiftHQ on ${stoppedDate}. Transactions have stopped syncing until you reconnect.`,
        push: {
          title: `${prefix}${input.institutionName} needs reconnecting`,
          body: 'Bank sync paused — reconnect to resume transactions.',
          url: path,
          tag: `bank-reauth-${input.stage}`,
        },
      };
    case 'day_4': {
      const days = input.elapsedDays ?? 4;
      return {
        subject: `${prefix}Still disconnected — ${input.institutionName} needs reauthorization`,
        heading: 'Your bank connection is still down',
        statusText: 'Needs reauthorization',
        statusColor: '#f59e0b',
        message: `${bankLabel}${at} has been disconnected since ${stoppedDate} — that is ${days} days of transactions not yet synced. Reconnect to catch up before the gap grows.`,
        push: {
          title: `${prefix}${input.institutionName} still disconnected`,
          body: `${days} days of transactions are missing — reconnect now.`,
          url: path,
          tag: `bank-reauth-${input.stage}`,
        },
      };
    }
    case 'day_10':
      // No push at day_10 — design §4.6: "Consequence tone; no push, this is
      // not an interrupt."
      return {
        subject: `${prefix}Action needed — ${input.institutionName} still disconnected`,
        heading: 'Your bank connection has been down for over a week',
        statusText: 'Needs reauthorization',
        statusColor: '#f59e0b',
        message: `${bankLabel}${at} has been disconnected since ${stoppedDate}. Your P&L and reconciliation are missing this account's transactions until you reconnect.`,
      };
    case 'recovered': {
      // Email-only receipt — design §4.6's recipients table has no push row
      // for 'recovered'.
      const through = input.dataCurrentThrough
        ? formatNoticeDate(input.dataCurrentThrough, input.restaurantTimezone)
        : 'today';
      return {
        subject: `${prefix}${input.institutionName} reconnected`,
        heading: 'Your bank connection is back',
        statusText: 'Reconnected',
        statusColor: '#10b981',
        message: `${bankLabel}${at} is syncing again. Transaction history has backfilled through ${through}.`,
      };
    }
  }
}

export function buildBankReauthNoticeContent(input: BankReauthNoticeInput): BankReauthNoticeContent {
  const copy = copyForStage(input);
  const reconnectUrl = `${input.appUrl.replace(/\/+$/, '')}${bankingPath(input.restaurantId)}`;

  const emailData: EmailTemplateData = {
    heading: copy.heading,
    statusBadge: { text: copy.statusText, color: copy.statusColor },
    message: copy.message,
    ctaButton: { text: 'Go to Banking', url: reconnectUrl },
    ...(input.stage === 'recovered'
      ? {}
      : {
          footerNote:
            'Reconnecting takes under a minute and does not affect your existing transaction history.',
        }),
  };

  return { subject: copy.subject, html: generateEmailTemplate(emailData), push: copy.push };
}
