/**
 * Delivery of claimed schedule notifications. Both notifiers use it:
 * notify-schedule-published (one message per employee with all of the
 * employee's pending changes) and notify-shift-changed (one change).
 *
 * Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
 * TLA+:   specs/tla/publish-notifications/PublishNotifications.tla
 *
 * Rules that the TLA+ model checks:
 *   - Each claimed row is sent once per run, with the row id as the email
 *     Idempotency-Key and the push tag (IdemKey).
 *   - mark_schedule_notification runs only after the provider answers
 *     (RecordAfter).
 *
 * This module has no Deno imports, so Vitest covers it. The edge functions
 * own the clients, the auth checks, and the real senders.
 */
import { BUDGET_EXHAUSTED_ERROR, DEFAULT_BUDGET_MS, RESEND_DEFAULT_INTERVAL_MS } from './emailQueue.ts';

export interface ClaimedNotification {
  notification_id: string;
  employee_id: string;
  change_log_ids: string[];
  reclaimed: boolean;
}

export interface DeliveryChange {
  id: string;
  shift_id: string | null;
  change_type: string;
  changed_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
}

export interface DeliveryEmployee {
  id: string;
  name: string | null;
  email: string | null;
  user_id: string | null;
}

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ChangeLine {
  shiftId: string | null;
  kind: ChangeKind;
  text: string;
  /** ISO start of the shift, for ordering. */
  sortKey: string;
}

type Snapshot = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const ownedBy = (data: Snapshot | null, employeeId: string): Snapshot | null =>
  data && str(data.employee_id) === employeeId ? data : null;

const formatDay = (iso: string, timeZone: string): string =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone });

const formatTime = (iso: string, timeZone: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });

/** "Mon, Jan 7, 10:00 AM – 6:00 PM". */
export function formatShiftWindow(data: Snapshot, timeZone: string): string {
  const start = str(data.start_time);
  const end = str(data.end_time);
  if (!start) return 'a shift';
  const head = `${formatDay(start, timeZone)}, ${formatTime(start, timeZone)}`;
  return end ? `${head} – ${formatTime(end, timeZone)}` : head;
}

/** "Mon, Jan 7, 10:00 AM – 6:00 PM (Server)", or null for no snapshot. */
export function describeShift(data: Snapshot | null | undefined, timeZone: string): string | null {
  if (!data || !str(data.start_time)) return null;
  const position = str(data.position);
  return `${formatShiftWindow(data, timeZone)}${position ? ` (${position})` : ''}`;
}

const isCancelled = (data: Snapshot): boolean => data.status === 'cancelled';

/**
 * One line per shift for one employee. For a shift with more than one
 * change, the line compares the first `before` with the last `after`, so
 * the employee reads the net result. A shift that the employee could not
 * see before and cannot see after (added, then deleted) gives no line.
 */
export function buildChangeLines(
  changes: DeliveryChange[],
  employeeId: string,
  timeZone: string,
): ChangeLine[] {
  const groups = new Map<string, { shiftId: string | null; changes: DeliveryChange[] }>();
  for (const c of changes) {
    const key = c.shift_id ?? `change:${c.id}`;
    const group = groups.get(key) ?? { shiftId: c.shift_id, changes: [] };
    group.changes.push(c);
    groups.set(key, group);
  }

  const lines: ChangeLine[] = [];
  for (const { shiftId, changes: list } of groups.values()) {
    list.sort((a, b) => a.changed_at.localeCompare(b.changed_at) || a.id.localeCompare(b.id));
    const first = list[0];
    const last = list[list.length - 1];
    const before = first.change_type === 'published' ? null : ownedBy(first.before_data, employeeId);
    const afterRaw = last.change_type === 'deleted' ? null : ownedBy(last.after_data, employeeId);
    // A cancelled shift reads as removed.
    const after = afterRaw && !isCancelled(afterRaw) ? afterRaw : null;

    if (before && after) {
      const from = describeShift(before, timeZone);
      const to = describeShift(after, timeZone);
      lines.push({
        shiftId,
        kind: 'changed',
        text:
          from === to
            ? `Updated: ${to}`
            : `Changed: ${formatShiftWindow(before, timeZone)} → ${to}`,
        sortKey: str(after.start_time) ?? '',
      });
    } else if (after) {
      lines.push({ shiftId, kind: 'added', text: `New shift: ${describeShift(after, timeZone)}`, sortKey: str(after.start_time) ?? '' });
    } else if (before) {
      lines.push({ shiftId, kind: 'removed', text: `Removed: ${describeShift(before, timeZone)}`, sortKey: str(before.start_time) ?? '' });
    }
  }

  return lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/** Push title and body for a set of lines. */
export function summarizeLines(lines: ChangeLine[]): { title: string; body: string } {
  if (lines.length === 1) return { title: 'Schedule update', body: lines[0].text };
  return {
    title: 'Schedule update',
    body: `${lines.length} changes to your schedule. Open the app to see them.`,
  };
}

/**
 * The result of one channel send.
 *   sent      - the provider accepted it;
 *   failed    - the provider rejected it, so nothing arrived;
 *   uncertain - no answer (a timeout); it may have arrived.
 */
export type ChannelResult = 'sent' | 'failed' | 'uncertain';

/** A channel sender. Null when the channel is off for this restaurant. */
export type ChannelSender =
  | ((employee: DeliveryEmployee, lines: ChangeLine[], notificationId: string) => Promise<ChannelResult>)
  | null;

/** The ledger status that a run writes. `deferred` = not tried; see the SQL. */
export type MarkStatus = 'sent' | 'skipped' | 'failed' | 'deferred';

export interface DeliverDeps {
  timeZone: string;
  loadChanges: (ids: string[]) => Promise<DeliveryChange[]>;
  loadEmployees: (ids: string[]) => Promise<DeliveryEmployee[]>;
  sendEmail: ChannelSender;
  sendPush: ChannelSender;
  mark: (id: string, status: MarkStatus, channels: string[], error: string | null, uncertain: boolean) => Promise<void>;
  /** Minimum gap between email starts. Default: the Resend limit. */
  intervalMs?: number;
  /** Wall-clock ceiling for the run. Default: the email queue budget. */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface DeliveryOutcome {
  notificationId: string;
  employeeId: string;
  employeeName: string | null;
  status: MarkStatus;
  channels: string[];
  lines: ChangeLine[];
  error: string | null;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Try one channel. A throw counts as uncertain: the request may have left. */
async function attempt(
  sender: ChannelSender,
  employee: DeliveryEmployee,
  lines: ChangeLine[],
  notificationId: string,
  errors: string[],
): Promise<ChannelResult> {
  if (!sender) return 'failed';
  try {
    return await sender(employee, lines, notificationId);
  } catch (e) {
    errors.push(errorText(e));
    return 'uncertain';
  }
}

/**
 * Send every claimed row, then mark it. Never throws for one row: a failed
 * row is marked `failed`, so its pairs stay pending and the next claim takes
 * the row back with the same id.
 */
export async function deliverClaimed(
  claims: ClaimedNotification[],
  deps: DeliverDeps,
): Promise<DeliveryOutcome[]> {
  if (claims.length === 0) return [];

  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? RESEND_DEFAULT_INTERVAL_MS;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = now();
  const outOfBudget = () => now() - startedAt > budgetMs;

  let changes: DeliveryChange[];
  let employees: DeliveryEmployee[];
  try {
    [changes, employees] = await Promise.all([
      deps.loadChanges([...new Set(claims.flatMap((c) => c.change_log_ids))]),
      deps.loadEmployees([...new Set(claims.map((c) => c.employee_id))]),
    ]);
  } catch (e) {
    // Nothing was sent. Give the rows back at once, so the next claim takes
    // them; a row left 'claimed' would wait for the lease, and after the
    // idempotency window it would never be sent.
    for (const c of claims) {
      await deps.mark(c.notification_id, 'deferred', [], `load failed: ${errorText(e)}`, false);
    }
    throw e;
  }
  const changeById = new Map(changes.map((c) => [c.id, c]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const outcomes: DeliveryOutcome[] = [];
  let lastEmailAt: number | null = null;

  for (const claim of claims) {
    const employee = employeeById.get(claim.employee_id) ?? null;
    const lines = employee
      ? buildChangeLines(
          claim.change_log_ids.map((id) => changeById.get(id)).filter((c): c is DeliveryChange => !!c),
          claim.employee_id,
          deps.timeZone,
        )
      : [];
    const base = {
      notificationId: claim.notification_id,
      employeeId: claim.employee_id,
      employeeName: employee?.name ?? null,
      lines,
    };

    const finish = async (status: MarkStatus, channels: string[], error: string | null, uncertain = false) => {
      await deps.mark(claim.notification_id, status, channels, error, uncertain);
      outcomes.push({ ...base, status, channels, error });
    };

    if (outOfBudget()) {
      await finish('deferred', [], BUDGET_EXHAUSTED_ERROR);
      continue;
    }
    if (!employee) {
      await finish('failed', [], 'employee not found');
      continue;
    }
    if (lines.length === 0) {
      await finish('skipped', [], 'no visible change');
      continue;
    }

    const errors: string[] = [];
    const channels: string[] = [];
    let uncertain = false;

    if (deps.sendEmail && employee.email) {
      // The gap is measured from the start of the last email.
      if (lastEmailAt !== null) {
        const wait = intervalMs - (now() - lastEmailAt);
        if (wait > 0) await sleep(wait);
      }
      lastEmailAt = now();
      const result = await attempt(deps.sendEmail, employee, lines, claim.notification_id, errors);
      if (result === 'sent') channels.push('email');
      if (result === 'uncertain') uncertain = true;
    }
    // A slow push must not take the budget of the next rows.
    if (deps.sendPush && employee.user_id && !outOfBudget()) {
      const result = await attempt(deps.sendPush, employee, lines, claim.notification_id, errors);
      if (result === 'sent') channels.push('push');
      if (result === 'uncertain') uncertain = true;
    }

    if (channels.length > 0) {
      await finish('sent', channels, null);
    } else {
      await finish('failed', [], errors[0] ?? 'no channel reached the employee', uncertain);
    }
  }

  return outcomes;
}

export interface OutcomeSummary {
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
  /** 502 when any row failed or was deferred: the UI shows the shortfall. */
  httpStatus: 200 | 502;
}

export function summarizeOutcomes(outcomes: DeliveryOutcome[]): OutcomeSummary {
  const count = (s: MarkStatus) => outcomes.filter((o) => o.status === s).length;
  const failed = count('failed');
  const deferred = count('deferred');
  return { sent: count('sent'), skipped: count('skipped'), failed, deferred, httpStatus: failed + deferred > 0 ? 502 : 200 };
}

/** One recipient in the notify-schedule-published answer. */
export interface NotifyRecipient {
  notificationId: string;
  employeeId: string;
  employeeName: string | null;
  status: MarkStatus;
  channels: string[];
  changes: string[];
  error: string | null;
}

/** The body of the notify-schedule-published answer (200 or 502). */
export interface NotifyScheduleResponse {
  success: boolean;
  sent: number;
  /** failed + deferred, so the UI toast counts every employee not reached. */
  failed: number;
  skipped: number;
  deferred: number;
  pushSent: number;
  totalEmployees: number;
  nothingToSend?: true;
  recipients: NotifyRecipient[];
}

export function buildNotifyResponse(outcomes: DeliveryOutcome[], pushSent: number): NotifyScheduleResponse {
  const s = summarizeOutcomes(outcomes);
  return {
    success: s.httpStatus === 200,
    sent: s.sent,
    failed: s.failed + s.deferred,
    skipped: s.skipped,
    deferred: s.deferred,
    pushSent,
    totalEmployees: outcomes.length,
    recipients: outcomes.map((o) => ({
      notificationId: o.notificationId,
      employeeId: o.employeeId,
      employeeName: o.employeeName,
      status: o.status,
      channels: o.channels,
      changes: o.lines.map((l) => l.text),
      error: o.error,
    })),
  };
}

export const NOTHING_TO_SEND: NotifyScheduleResponse = Object.freeze({
  success: true,
  sent: 0,
  failed: 0,
  skipped: 0,
  deferred: 0,
  pushSent: 0,
  totalEmployees: 0,
  nothingToSend: true,
  recipients: [],
}) as NotifyScheduleResponse;

export interface RpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ClaimParams {
  restaurantId: string;
  from: string | null;
  to: string | null;
  source: 'publish' | 'shift_change';
  publicationId?: string | null;
  changeLogId?: string | null;
}

/** claim_schedule_notifications(). Service-role client only. */
export async function claimNotifications(client: RpcClient, params: ClaimParams): Promise<ClaimedNotification[]> {
  const { data, error } = await client.rpc('claim_schedule_notifications', {
    p_restaurant_id: params.restaurantId,
    p_from: params.from,
    p_to: params.to,
    p_source: params.source,
    p_publication_id: params.publicationId ?? null,
    p_change_log_id: params.changeLogId ?? null,
  });
  if (error) throw new Error(`claim_schedule_notifications failed: ${error.message}`);
  return (data ?? []) as ClaimedNotification[];
}

/** mark_schedule_notification(). Service-role client only. */
export async function markNotification(
  client: RpcClient,
  id: string,
  status: MarkStatus,
  channels: string[],
  error: string | null,
  uncertain: boolean,
): Promise<void> {
  const { data, error: rpcError } = await client.rpc('mark_schedule_notification', {
    p_id: id,
    p_status: status,
    p_channels: channels,
    p_error: error,
    p_uncertain: uncertain,
  });
  if (rpcError) {
    // The send already happened. The row stays 'claimed': the pending tool
    // shows it as retrying, then in_doubt, and a retry inside the window
    // uses the same idempotency key.
    console.error(`mark_schedule_notification failed for ${id}: ${rpcError.message}`);
  } else if (data === false) {
    // Another run took the row back after the lease (the lease is longer than
    // the edge wall clock, so this is rare). That run writes the final state.
    console.error(`mark_schedule_notification: row ${id} is no longer claimed by this run`);
  }
}
