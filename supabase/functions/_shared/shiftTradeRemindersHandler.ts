// Orchestration for the shift-trade-reminders worker. The entry file wires
// the real clients into this dependency interface. The tests inject mocks
// and a clock.
//
// Order for each candidate:
//   1. Check the run budget. If it is used up, count the rest as deferred.
//   2. Employee stage: read the audience. This read is read-only, so it can
//      come before the claim. If the audience does not fit the rest of the
//      push budget, count this candidate and the rest as deferred.
//   3. Claim the (trade, stage). A false claim means another run sent it,
//      or the trade is no longer open: count skipped and do not send.
//   4. Check the channels. All channels off: count skipped. The claim stays.
//   5. Send. Log counts and ids only. Never log an email address or a name.
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
  type EmployeeReminderStage,
  type ReminderPush,
  type ReminderShiftInfo,
} from './shiftTradeReminderContent.ts';

/** Wall-clock budget for one run. The rest stay due for the next tick. */
export const RUN_BUDGET_MS = 60_000;
/**
 * Push-target budget for one run. It is the same as the per-call cap in
 * webPushHelper.ts, so one call never drops targets.
 */
export const MAX_PUSH_TARGETS = 500;
/** p_limit for the candidates RPC. */
export const CANDIDATE_LIMIT = 50;
/** Most candidate pages in one run. */
export const MAX_CANDIDATE_PAGES = 10;
/**
 * Smallest email budget for one candidate. The run budget is checked before
 * the claim, so a claim near the end of the run still gets time to email.
 */
const MIN_EMAIL_BUDGET_MS = 15_000;

const LOG_PREFIX = '[shift-trade-reminders]';

export type ReminderStage = EmployeeReminderStage | 'unclaimed';

export interface ReminderCandidateRow {
  shift_trade_id: string;
  restaurant_id: string;
  stage: ReminderStage;
  start_time: string;
  end_time: string;
  position: string | null;
  is_published: boolean | null;
  offered_by_name: string | null;
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
  /** `skipped` counts the targets that the push helper did not process. */
  sendPush: (
    userIds: string[],
    restaurantId: string,
    payload: ReminderPush,
  ) => Promise<{ sent: number; skipped: number }>;
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

interface Loggers {
  log: (line: string) => void;
  logError: (line: string) => void;
}

const errorText = (err: unknown): string =>
  truncateError(err instanceof Error ? err.message : String(err));

function emptyOutcome(): CandidateOutcome {
  return { pushed: 0, pushTargets: 0, emailed: 0 };
}

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

/** Sends one push call. The target count excludes the targets that the helper skipped. */
async function pushCounted(
  deps: ShiftTradeRemindersDeps,
  row: ReminderCandidateRow,
  userIds: string[],
  payload: ReminderPush,
  { log }: Loggers,
): Promise<{ sent: number; targets: number }> {
  const res = await deps.sendPush(userIds, row.restaurant_id, payload);
  if (res.skipped > 0) {
    log(`${LOG_PREFIX} push skipped trade=${row.shift_trade_id} skipped=${res.skipped}`);
  }
  return { sent: res.sent, targets: userIds.length - res.skipped };
}

async function sendEmployeeStage(
  deps: ShiftTradeRemindersDeps,
  row: ReminderCandidateRow,
  stage: EmployeeReminderStage,
  userIds: string[],
  loggers: Loggers,
): Promise<CandidateOutcome> {
  const outcome = emptyOutcome();
  if (userIds.length === 0) return outcome;

  const payload = buildEmployeeReminderPush(toShiftInfo(row), stage, new Date(deps.now()));
  // Chunks of MAX_PUSH_TARGETS, so the push helper never drops a target.
  for (let i = 0; i < userIds.length; i += MAX_PUSH_TARGETS) {
    const res = await pushCounted(deps, row, userIds.slice(i, i + MAX_PUSH_TARGETS), payload, loggers);
    outcome.pushed += res.sent;
    outcome.pushTargets += res.targets;
  }
  return outcome;
}

async function sendUnclaimedStage(
  deps: ShiftTradeRemindersDeps,
  row: ReminderCandidateRow,
  channels: ChannelDecision,
  runStartedAt: number,
  loggers: Loggers,
): Promise<CandidateOutcome> {
  const { logError } = loggers;
  const outcome = emptyOutcome();
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
    const pushTo = async (
      label: 'scheduler' | 'poster',
      userIds: string[],
      buildPush: (info: ReminderShiftInfo) => ReminderPush,
    ): Promise<void> => {
      if (userIds.length === 0) return;
      try {
        const res = await pushCounted(deps, row, userIds, buildPush(info), loggers);
        outcome.pushed += res.sent;
        outcome.pushTargets += res.targets;
      } catch (err) {
        logError(`${LOG_PREFIX} ${label} push failed trade=${row.shift_trade_id}: ${errorText(err)}`);
      }
    };
    await Promise.all([
      pushTo('scheduler', schedulers.map((r) => r.user_id), buildSchedulerUnclaimedPush),
      pushTo('poster', posterIds, buildPosterUnclaimedPush),
    ]);
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

const candidateKey = (row: ReminderCandidateRow): string => `${row.shift_trade_id}:${row.stage}`;

export async function runShiftTradeReminders(
  deps: ShiftTradeRemindersDeps,
): Promise<ShiftTradeRemindersResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const logError = deps.logError ?? ((line: string) => console.error(line));
  const loggers: Loggers = { log, logError };
  const runStartedAt = deps.now();
  const nowIso = new Date(runStartedAt).toISOString();
  const result: ShiftTradeRemindersResult = {
    candidates: 0,
    claimed: 0,
    pushed: 0,
    emailed: 0,
    skipped: 0,
    deferred: 0,
  };

  // The channel settings do not change in one run, so read them one time
  // for each (restaurant, type).
  const channelCache = new Map<string, ChannelDecision>();
  const channelsFor = async (restaurantId: string, type: NotificationType): Promise<ChannelDecision> => {
    const key = `${restaurantId}:${type}`;
    let decision = channelCache.get(key);
    if (!decision) {
      decision = await deps.resolveChannels(restaurantId, type);
      channelCache.set(key, decision);
    }
    return decision;
  };

  let pushTargets = 0;
  const outOfBudget = () => deps.now() - runStartedAt >= RUN_BUDGET_MS || pushTargets >= MAX_PUSH_TARGETS;
  // A row that a run did not claim can come back on a later page.
  const seen = new Set<string>();
  let stopped = false;

  for (let page = 0; page < MAX_CANDIDATE_PAGES && !stopped; page++) {
    if (page > 0 && outOfBudget()) break;

    const candidatesRes = await deps.fetchCandidates(nowIso, CANDIDATE_LIMIT);
    if (candidatesRes.error) {
      logError(`${LOG_PREFIX} candidates read failed: ${truncateError(candidatesRes.error.message)}`);
      result.error = candidatesRes.error.message;
      break;
    }
    const rows = candidatesRes.data ?? [];
    const candidates = rows.filter((row) => !seen.has(candidateKey(row)));
    for (const row of candidates) seen.add(candidateKey(row));
    result.candidates += candidates.length;

    for (let i = 0; i < candidates.length; i++) {
      const row = candidates[i];
      const stage = row.stage;
      const isUnclaimed = stage === 'unclaimed';

      if (outOfBudget()) {
        result.deferred += candidates.length - i;
        stopped = true;
        break;
      }

      try {
        let audience: string[] = [];
        if (!isUnclaimed) {
          const audienceRes = await deps.fetchAudience(row.shift_trade_id);
          if (audienceRes.error) {
            // No claim, so the next run tries this stage again.
            logError(`${LOG_PREFIX} audience read failed trade=${row.shift_trade_id}: ${truncateError(audienceRes.error.message)}`);
            result.skipped += 1;
            continue;
          }
          audience = (audienceRes.data ?? []).map((r) => r.user_id);
          // An empty run sends a large audience in chunks. Otherwise the
          // audience must fit the rest of the push budget.
          if (pushTargets > 0 && pushTargets + audience.length > MAX_PUSH_TARGETS) {
            result.deferred += candidates.length - i;
            stopped = true;
            break;
          }
        }

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

        const type = isUnclaimed ? TRADE_REMINDER_TYPE.unclaimed : TRADE_REMINDER_TYPE.employee;
        const channels = await channelsFor(row.restaurant_id, type);
        const allOff = isUnclaimed ? !channels.email && !channels.push : !channels.push;
        if (allOff) {
          result.skipped += 1;
          log(`${LOG_PREFIX} channels off trade=${row.shift_trade_id} stage=${row.stage} restaurant=${row.restaurant_id}`);
          continue;
        }

        const outcome =
          isUnclaimed
            ? await sendUnclaimedStage(deps, row, channels, runStartedAt, loggers)
            : await sendEmployeeStage(deps, row, stage, audience, loggers);

        pushTargets += outcome.pushTargets;
        result.pushed += outcome.pushed;
        result.emailed += outcome.emailed;

        log(
          `${LOG_PREFIX} sent trade=${row.shift_trade_id} stage=${row.stage} restaurant=${row.restaurant_id} ` +
            `push_targets=${outcome.pushTargets} pushed=${outcome.pushed} emailed=${outcome.emailed}`,
        );
      } catch (err) {
        // One failed candidate must not stop the loop. The claim stays.
        logError(`${LOG_PREFIX} send failed trade=${row.shift_trade_id} stage=${row.stage}: ${errorText(err)}`);
      }
    }

    // A short page means no more rows are due. A page of seen rows only
    // means the rest did not change, so another read gives nothing new.
    if (rows.length < CANDIDATE_LIMIT || candidates.length === 0) break;
  }

  log(
    `${LOG_PREFIX} candidates=${result.candidates} claimed=${result.claimed} pushed=${result.pushed} ` +
      `emailed=${result.emailed} skipped=${result.skipped} deferred=${result.deferred}`,
  );

  return result;
}
