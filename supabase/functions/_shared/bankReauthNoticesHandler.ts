// Pure orchestration for the bank-reauth-notices worker (design §4.6).
//
// Walks both cohorts — still-down (A) and recovered (B) — turns each row
// into the stage due right now via `_shared/bankReauthStages.ts`, gates each
// channel through the caller-injected `resolveChannels` decision, renders
// content via `_shared/bankReauthNoticeContent.ts`, sends, and finally
// records a dedupe row per (connected_bank_id, stage, deactivated_at) — the
// real client implements this as an `ON CONFLICT DO NOTHING` upsert so a
// concurrent double-run of the worker is a no-op rather than a 23505.
//
// The Deno entry (`bank-reauth-notices/index.ts`) wires real Supabase RPC /
// Resend / web-push clients into this dependency interface; tests inject
// mocks — mirrors `_shared/trialExpiryEmailsHandler.ts`.

import { nextStage, recipientsForStage, type ElapsedStage, type NoticeStage } from './bankReauthStages.ts';
import { buildBankReauthNoticeContent } from './bankReauthNoticeContent.ts';

export interface CohortARow {
  connected_bank_id: string;
  restaurant_id: string;
  institution_name: string;
  account_mask: string | null;
  deactivated_at: string;
  elapsed_days: number;
  sent_stages: string[];
}

export interface CohortBRow {
  connected_bank_id: string;
  restaurant_id: string;
  institution_name: string;
  account_mask: string | null;
  deactivated_at: string;
  data_current_through: string | null;
}

export interface RecipientRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

interface FetchResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export type FetchCohortAFn = () => Promise<FetchResult<CohortARow[]>>;
export type FetchCohortBFn = () => Promise<FetchResult<CohortBRow[]>>;
export type FetchRecipientsFn = (
  restaurantId: string,
  roles: Array<'owner' | 'manager'>,
) => Promise<FetchResult<RecipientRow[]>>;

export type ResolveChannelsFn = (restaurantId: string) => Promise<{ email: boolean; push: boolean }>;

export type SendEmailFn = (msg: {
  to: string;
  from: string;
  subject: string;
  html: string;
}) => Promise<{ id: string | null; error: { message: string } | null }>;

export type SendPushFn = (
  userIds: string[],
  restaurantId: string,
  payload: { title: string; body: string; url: string; tag: string },
) => Promise<{ sent: number }>;

export type RecordNoticeFn = (row: {
  restaurant_id: string;
  connected_bank_id: string;
  stage: NoticeStage;
  deactivated_at: string;
}) => Promise<{ error: { message: string } | null }>;

export interface BankReauthNoticesDeps {
  fetchCohortA: FetchCohortAFn;
  fetchCohortB: FetchCohortBFn;
  fetchRecipients: FetchRecipientsFn;
  resolveChannels: ResolveChannelsFn;
  sendEmail: SendEmailFn;
  sendPush: SendPushFn;
  recordNotice: RecordNoticeFn;
  fromEmail: string;
  appUrl: string;
}

export interface BankReauthNoticeResult {
  connected_bank_id: string;
  restaurant_id: string;
  stage: NoticeStage;
  status: 'sent' | 'error';
  emailsSent: number;
  pushSent: number;
  error?: string;
}

export interface BankReauthNoticesRunResult {
  cohortACount: number;
  cohortBCount: number;
  results: BankReauthNoticeResult[];
  error?: string;
}

interface NoticeTarget {
  restaurantId: string;
  connectedBankId: string;
  institutionName: string;
  accountMask: string | null;
  deactivatedAt: string;
  elapsedDays?: number;
  dataCurrentThrough?: string | null;
  stage: NoticeStage;
}

async function processTarget(
  deps: BankReauthNoticesDeps,
  target: NoticeTarget,
): Promise<BankReauthNoticeResult> {
  const { roles, channels } = recipientsForStage(target.stage);
  const decision = await deps.resolveChannels(target.restaurantId);
  const wantsEmail = channels.includes('email') && decision.email;
  const wantsPush = channels.includes('push') && decision.push;

  let recipients: RecipientRow[] = [];
  // Skip the recipients round-trip entirely when both channels are gated
  // off for this restaurant — nothing to send, so nothing to look up.
  if (wantsEmail || wantsPush) {
    const recRes = await deps.fetchRecipients(target.restaurantId, roles);
    if (recRes.error) {
      return {
        connected_bank_id: target.connectedBankId,
        restaurant_id: target.restaurantId,
        stage: target.stage,
        status: 'error',
        emailsSent: 0,
        pushSent: 0,
        error: recRes.error.message,
      };
    }
    recipients = recRes.data ?? [];
  }

  const content = buildBankReauthNoticeContent({
    stage: target.stage,
    institutionName: target.institutionName,
    accountMask: target.accountMask,
    deactivatedAt: target.deactivatedAt,
    elapsedDays: target.elapsedDays,
    dataCurrentThrough: target.dataCurrentThrough,
    appUrl: deps.appUrl,
  });

  let emailsSent = 0;
  let emailAttempted = 0;
  if (wantsEmail) {
    const emailTargets = recipients.filter(
      (r): r is RecipientRow & { email: string } => Boolean(r.email),
    );
    emailAttempted = emailTargets.length;
    const sends = await Promise.all(
      emailTargets.map((r) =>
        deps.sendEmail({ to: r.email, from: deps.fromEmail, subject: content.subject, html: content.html }),
      ),
    );
    emailsSent = sends.filter((s) => !s.error && s.id).length;
  }

  let pushSent = 0;
  let pushAttempted = 0;
  if (wantsPush && content.push) {
    const userIds = recipients.map((r) => r.user_id);
    if (userIds.length > 0) {
      pushAttempted = userIds.length;
      const pushRes = await deps.sendPush(userIds, target.restaurantId, content.push);
      pushSent = pushRes.sent;
    }
  }

  // A channel that had recipients but delivered to none of them is a
  // transient failure (e.g. Resend/web-push outage), not a "reached this
  // stage" event — don't record the dedupe row, or this stage would be
  // silently and permanently skipped on every future run. This is distinct
  // from both channels being disabled for this restaurant (wantsEmail/
  // wantsPush false), which correctly still records below.
  const deliveryFailed =
    (emailAttempted > 0 && emailsSent === 0) || (pushAttempted > 0 && pushSent === 0);
  if (deliveryFailed) {
    return {
      connected_bank_id: target.connectedBankId,
      restaurant_id: target.restaurantId,
      stage: target.stage,
      status: 'error',
      emailsSent,
      pushSent,
      error: 'all attempted sends failed for this stage',
    };
  }

  // Record the dedupe row regardless of whether anything actually sent —
  // both channels being disabled for this restaurant still means this stage
  // was reached and should not be re-evaluated on tomorrow's run.
  const recorded = await deps.recordNotice({
    restaurant_id: target.restaurantId,
    connected_bank_id: target.connectedBankId,
    stage: target.stage,
    deactivated_at: target.deactivatedAt,
  });

  return {
    connected_bank_id: target.connectedBankId,
    restaurant_id: target.restaurantId,
    stage: target.stage,
    status: recorded.error ? 'error' : 'sent',
    emailsSent,
    pushSent,
    ...(recorded.error ? { error: recorded.error.message } : {}),
  };
}

export async function runBankReauthNotices(
  deps: BankReauthNoticesDeps,
): Promise<BankReauthNoticesRunResult> {
  const [cohortARes, cohortBRes] = await Promise.all([deps.fetchCohortA(), deps.fetchCohortB()]);

  if (cohortARes.error) {
    return { cohortACount: 0, cohortBCount: 0, results: [], error: cohortARes.error.message };
  }
  if (cohortBRes.error) {
    return { cohortACount: 0, cohortBCount: 0, results: [], error: cohortBRes.error.message };
  }

  const cohortA = cohortARes.data ?? [];
  const cohortB = cohortBRes.data ?? [];

  // Each row is an independent bank/restaurant — processTarget's DB and
  // channel round-trips have no data dependency on any other row in the same
  // cohort, so both cohorts run concurrently rather than one row at a time.
  const cohortAResults = await Promise.all(
    cohortA.map((row) => {
      // Only the currently-applicable stage is ever a candidate — an
      // already-sent stage, or day 0 (in-app only, no notice), yields null
      // and this bank is skipped for this run entirely
      // (bankReauthStages.nextStage).
      const stage = nextStage(row.sent_stages as ElapsedStage[], row.elapsed_days);
      if (!stage) return null;
      return processTarget(deps, {
        restaurantId: row.restaurant_id,
        connectedBankId: row.connected_bank_id,
        institutionName: row.institution_name,
        accountMask: row.account_mask,
        deactivatedAt: row.deactivated_at,
        elapsedDays: row.elapsed_days,
        stage,
      });
    }),
  );

  const cohortBResults = await Promise.all(
    cohortB.map((row) =>
      processTarget(deps, {
        restaurantId: row.restaurant_id,
        connectedBankId: row.connected_bank_id,
        institutionName: row.institution_name,
        accountMask: row.account_mask,
        deactivatedAt: row.deactivated_at,
        dataCurrentThrough: row.data_current_through,
        stage: 'recovered',
      }),
    ),
  );

  const results: BankReauthNoticeResult[] = [
    ...cohortAResults.filter((r): r is BankReauthNoticeResult => r !== null),
    ...cohortBResults,
  ];

  return { cohortACount: cohortA.length, cohortBCount: cohortB.length, results };
}
