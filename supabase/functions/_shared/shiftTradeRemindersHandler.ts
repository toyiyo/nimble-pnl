// Pure orchestration for the shift-trade-reminders worker (design B5).
//
// The Deno entry (`shift-trade-reminders/index.ts`) wires real Supabase RPC,
// Resend and web-push clients into this dependency interface. Tests inject
// mocks and a clock. The layout follows `_shared/bankReauthNoticesHandler.ts`.
//
// Order for each candidate:
//   1. Check the run budget. If it is used up, count the rest as deferred.
//   2. Claim the (trade, stage). A false claim means another run sent it,
//      or the trade is no longer open: count skipped and do not send.
//   3. Check the channels. All channels off: count skipped. The claim stays.
//   4. Read the audience and send.
//   5. Log counts and ids only. Never log an email address or a name.
//
// The claim comes BEFORE the send. A crash after the claim loses one
// reminder. A crash never sends the same stage two times (TLA+ model
// specs/tla/shift-trade-reminders/ShiftTradeReminders.tla).

import { sendPaced, type EmailSendResult } from './emailQueue.ts';
import { truncateError } from './emailSendSummary.ts';
import type { ChannelDecision, NotificationType } from './resolveChannels.ts';
import { TRADE_REMINDER_TYPE } from './notificationActionTypes.ts';
import {
  buildEmployeeReminderPush,
  buildPosterUnclaimedPush,
  buildSchedulerUnclaimedEmail,
  buildSchedulerUnclaimedPush,
  type ReminderPush,
  type ReminderShiftInfo,
} from './shiftTradeReminderContent.ts';

/** Wall-clock budget for one run. The rest stay due for the next tick. */
export const RUN_BUDGET_MS = 60_000;
/** Push-target budget for one run. */
export const MAX_PUSH_TARGETS = 1_000;
/** p_limit for the candidates RPC. */
export const CANDIDATE_LIMIT = 50;
/**
 * Smallest email budget for one candidate. The run budget is checked before
 * the claim, so a claim near the end of the run still gets time to email.
 */
const MIN_EMAIL_BUDGET_MS = 15_000;

const LOG_PREFIX = '[shift-trade-reminders]';

export type ReminderStage = '72h' | '24h' | '6h' | 'unclaimed';

export interface ReminderCandidateRow {
  shift_trade_id: string;
  restaurant_id: string;
  stage: ReminderStage;
  start_time: string;
  end_time: string;
  position: string | null;
  is_published: boolean | null;
  offered_by_employee_id: string;
  offered_by_name: string | null;
  offered_by_user_id: string | null;
  target_employee_id: string | null;
  restaurant_name: string | null;
  restaurant_timezone: string | null;
}

export interface UnclaimedRecipientRow {
  user_id: string;
  email: string | null;
  kind: 'scheduler' | 'poster';
}

interface FetchResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface ShiftTradeRemindersDeps {
  fetchCandidates: (nowIso: string, limit: number) => Promise<FetchResult<ReminderCandidateRow[]>>;
  claim: (tradeId: string, stage: ReminderStage) => Promise<FetchResult<boolean>>;
  resolveChannels: (restaurantId: string, type: NotificationType) => Promise<ChannelDecision>;
  fetchAudience: (tradeId: string) => Promise<FetchResult<Array<{ user_id: string }>>>;
  fetchUnclaimedRecipients: (tradeId: string) => Promise<FetchResult<UnclaimedRecipientRow[]>>;
  sendPush: (userIds: string[], restaurantId: string, payload: ReminderPush) => Promise<{ sent: number }>;
  sendEmail: (to: string, subject: string, html: string) => Promise<EmailSendResult>;
  /** Epoch milliseconds. */
  now: () => number;
  /** Injectable for tests; sendPaced uses it for pacing. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  logError?: (line: string) => void;
  appUrl: string;
}

export interface ShiftTradeRemindersResult {
  candidates: number;
  claimed: number;
  pushed: number;
  emailed: number;
  skipped: number;
  deferred: number;
  error?: string;
}

interface CandidateOutcome {
  pushed: number;
  pushTargets: number;
  emailed: number;
}

const errorText = (err: unknown): string =>
  truncateError(err instanceof Error ? err.message : String(err));

function toShiftInfo(row: ReminderCandidateRow): ReminderShiftInfo {
  return {
    tradeId: row.shift_trade_id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantTimezone: row.restaurant_timezone,
    startTime: row.start_time,
    endTime: row.end_time,
    position: row.position,
    isPublished: row.is_published,
    posterName: row.offered_by_name,
  };
}

async function sendEmployeeStage(
  deps: ShiftTradeRemindersDeps,
  row: ReminderCandidateRow,
  stage: Exclude<ReminderStage, 'unclaimed'>,
  logError: (line: string) => void,
): Promise<CandidateOutcome> {
  const audience = await deps.fetchAudience(row.shift_trade_id);
  if (audience.error) {
    logError(`${LOG_PREFIX} audience read failed trade=${row.shift_trade_id}: ${truncateError(audience.error.message)}`);
    return { pushed: 0, pushTargets: 0, emailed: 0 };
  }
  const userIds = (audience.data ?? []).map((r) => r.user_id);
  if (userIds.length === 0) return { pushed: 0, pushTargets: 0, emailed: 0 };

  const payload = buildEmployeeReminderPush(toShiftInfo(row), stage, new Date(deps.now()));
  const res = await deps.sendPush(userIds, row.restaurant_id, payload);
  return { pushed: res.sent, pushTargets: userIds.length, emailed: 0 };
}

async function sendUnclaimedStage(
  deps: ShiftTradeRemindersDeps,
  row: ReminderCandidateRow,
  channels: ChannelDecision,
  runStartedAt: number,
  logError: (line: string) => void,
): Promise<CandidateOutcome> {
  const outcome: CandidateOutcome = { pushed: 0, pushTargets: 0, emailed: 0 };
  const recipientsRes = await deps.fetchUnclaimedRecipients(row.shift_trade_id);
  if (recipientsRes.error) {
    logError(`${LOG_PREFIX} recipients read failed trade=${row.shift_trade_id}: ${truncateError(recipientsRes.error.message)}`);
    return outcome;
  }
  const recipients = recipientsRes.data ?? [];
  const schedulers = recipients.filter((r) => r.kind === 'scheduler');
  const posterIds = recipients.filter((r) => r.kind === 'poster').map((r) => r.user_id);
  const info = toShiftInfo(row);

  if (channels.push) {
    // Each push is independent. A failure in one must not stop the other.
    const schedulerIds = schedulers.map((r) => r.user_id);
    if (schedulerIds.length > 0) {
      try {
        const res = await deps.sendPush(schedulerIds, row.restaurant_id, buildSchedulerUnclaimedPush(info));
        outcome.pushed += res.sent;
        outcome.pushTargets += schedulerIds.length;
      } catch (err) {
        logError(`${LOG_PREFIX} scheduler push failed trade=${row.shift_trade_id}: ${errorText(err)}`);
      }
    }
    if (posterIds.length > 0) {
      try {
        const res = await deps.sendPush(posterIds, row.restaurant_id, buildPosterUnclaimedPush(info));
        outcome.pushed += res.sent;
        outcome.pushTargets += posterIds.length;
      } catch (err) {
        logError(`${LOG_PREFIX} poster push failed trade=${row.shift_trade_id}: ${errorText(err)}`);
      }
    }
  }

  if (channels.email) {
    const emailTargets = schedulers.filter(
      (r): r is UnclaimedRecipientRow & { email: string } => Boolean(r.email),
    );
    if (emailTargets.length > 0) {
      const email = buildSchedulerUnclaimedEmail(info, new Date(deps.now()), deps.appUrl);
      const remainingMs = RUN_BUDGET_MS - (deps.now() - runStartedAt);
      const results = await sendPaced(
        emailTargets,
        (r) => deps.sendEmail(r.email, email.subject, email.html),
        {
          sleep: deps.sleep,
          now: deps.now,
          budgetMs: Math.max(remainingMs, MIN_EMAIL_BUDGET_MS),
          label: 'shift-trade-reminders',
        },
      );
      for (const r of results) {
        if (r.ok) {
          outcome.emailed += 1;
        } else {
          // The user id only. truncateError removes an echoed address.
          const reason = r.error ? truncateError(r.error) : `HTTP ${r.status}`;
          logError(
            `${LOG_PREFIX} email failed trade=${row.shift_trade_id} user=${r.recipient.user_id}: ${reason}`,
          );
        }
      }
    }
  }

  return outcome;
}

export async function runShiftTradeReminders(
  deps: ShiftTradeRemindersDeps,
): Promise<ShiftTradeRemindersResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const logError = deps.logError ?? ((line: string) => console.error(line));
  const runStartedAt = deps.now();
  const result: ShiftTradeRemindersResult = {
    candidates: 0,
    claimed: 0,
    pushed: 0,
    emailed: 0,
    skipped: 0,
    deferred: 0,
  };

  const candidatesRes = await deps.fetchCandidates(new Date(runStartedAt).toISOString(), CANDIDATE_LIMIT);
  if (candidatesRes.error) {
    logError(`${LOG_PREFIX} candidates read failed: ${truncateError(candidatesRes.error.message)}`);
    return { ...result, error: candidatesRes.error.message };
  }
  const candidates = candidatesRes.data ?? [];
  result.candidates = candidates.length;

  let pushTargets = 0;

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];

    // 1. Run budget, checked before each claim.
    if (deps.now() - runStartedAt >= RUN_BUDGET_MS || pushTargets >= MAX_PUSH_TARGETS) {
      result.deferred = candidates.length - i;
      break;
    }

    try {
      // 2. Claim before send.
      const claim = await deps.claim(row.shift_trade_id, row.stage);
      if (claim.error) {
        logError(`${LOG_PREFIX} claim failed trade=${row.shift_trade_id} stage=${row.stage}: ${truncateError(claim.error.message)}`);
        result.skipped += 1;
        continue;
      }
      if (claim.data !== true) {
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;

      // 3. Channel gate, after the claim.
      const type = row.stage === 'unclaimed' ? TRADE_REMINDER_TYPE.unclaimed : TRADE_REMINDER_TYPE.employee;
      const channels = await deps.resolveChannels(row.restaurant_id, type);
      const allOff = row.stage === 'unclaimed' ? !channels.email && !channels.push : !channels.push;
      if (allOff) {
        result.skipped += 1;
        log(`${LOG_PREFIX} channels off trade=${row.shift_trade_id} stage=${row.stage} restaurant=${row.restaurant_id}`);
        continue;
      }

      // 4. Send.
      const outcome =
        row.stage === 'unclaimed'
          ? await sendUnclaimedStage(deps, row, channels, runStartedAt, logError)
          : await sendEmployeeStage(deps, row, row.stage, logError);

      pushTargets += outcome.pushTargets;
      result.pushed += outcome.pushed;
      result.emailed += outcome.emailed;

      // 5. Counts and ids only.
      log(
        `${LOG_PREFIX} sent trade=${row.shift_trade_id} stage=${row.stage} restaurant=${row.restaurant_id} ` +
          `push_targets=${outcome.pushTargets} pushed=${outcome.pushed} emailed=${outcome.emailed}`,
      );
    } catch (err) {
      // One failed candidate must not stop the loop. The claim stays.
      logError(`${LOG_PREFIX} send failed trade=${row.shift_trade_id} stage=${row.stage}: ${errorText(err)}`);
    }
  }

  log(
    `${LOG_PREFIX} candidates=${result.candidates} claimed=${result.claimed} pushed=${result.pushed} ` +
      `emailed=${result.emailed} skipped=${result.skipped} deferred=${result.deferred}`,
  );

  return result;
}
