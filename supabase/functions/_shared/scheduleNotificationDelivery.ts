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

const positionSuffix = (data: Snapshot): string => {
  const position = str(data.position);
  return position ? ` (${position})` : '';
};

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
  const byShift = new Map<string, DeliveryChange[]>();
  for (const c of changes) {
    const key = c.shift_id ?? `change:${c.id}`;
    const list = byShift.get(key) ?? [];
    list.push(c);
    byShift.set(key, list);
  }

  const lines: ChangeLine[] = [];
  for (const [key, list] of byShift) {
    list.sort((a, b) => a.changed_at.localeCompare(b.changed_at) || a.id.localeCompare(b.id));
    const first = list[0];
    const last = list[list.length - 1];
    const before = first.change_type === 'published' ? null : ownedBy(first.before_data, employeeId);
    const after = last.change_type === 'deleted' ? null : ownedBy(last.after_data, employeeId);
    const shiftId = key.startsWith('change:') ? null : key;

    if (before && after) {
      lines.push({
        shiftId,
        kind: 'changed',
        text: `Changed: ${formatShiftWindow(before, timeZone)} → ${formatShiftWindow(after, timeZone)}${positionSuffix(after)}`,
        sortKey: str(after.start_time) ?? '',
      });
    } else if (after) {
      lines.push({
        shiftId,
        kind: 'added',
        text: `New shift: ${formatShiftWindow(after, timeZone)}${positionSuffix(after)}`,
        sortKey: str(after.start_time) ?? '',
      });
    } else if (before) {
      lines.push({
        shiftId,
        kind: 'removed',
        text: `Removed: ${formatShiftWindow(before, timeZone)}${positionSuffix(before)}`,
        sortKey: str(before.start_time) ?? '',
      });
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

/** A channel sender. Null when the channel is off for this restaurant. */
export type ChannelSender =
  | ((employee: DeliveryEmployee, lines: ChangeLine[], notificationId: string) => Promise<boolean>)
  | null;

export interface DeliverDeps {
  timeZone: string;
  loadChanges: (ids: string[]) => Promise<DeliveryChange[]>;
  loadEmployees: (ids: string[]) => Promise<DeliveryEmployee[]>;
  sendEmail: ChannelSender;
  sendPush: ChannelSender;
  mark: (id: string, status: 'sent' | 'failed', channels: string[], error: string | null) => Promise<void>;
  /** Gap between email sends. Default 500 ms (Resend: 2 per second). */
  intervalMs?: number;
  /** Wall-clock ceiling for the run. Default 90 s. */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface DeliveryOutcome {
  notificationId: string;
  employeeId: string;
  employeeName: string | null;
  status: 'sent' | 'failed';
  channels: string[];
  lines: ChangeLine[];
  reclaimed: boolean;
  error: string | null;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Try one channel. A throw counts as a failure, not as a crash of the run. */
async function attempt(
  sender: ChannelSender,
  employee: DeliveryEmployee,
  lines: ChangeLine[],
  notificationId: string,
  errors: string[],
): Promise<boolean> {
  if (!sender) return false;
  try {
    return await sender(employee, lines, notificationId);
  } catch (e) {
    errors.push(errorText(e));
    return false;
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
  const intervalMs = deps.intervalMs ?? 500;
  const budgetMs = deps.budgetMs ?? 90_000;
  const startedAt = now();

  const changeIds = [...new Set(claims.flatMap((c) => c.change_log_ids))];
  const employeeIds = [...new Set(claims.map((c) => c.employee_id))];
  const [changes, employees] = await Promise.all([
    deps.loadChanges(changeIds),
    deps.loadEmployees(employeeIds),
  ]);
  const changeById = new Map(changes.map((c) => [c.id, c]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const outcomes: DeliveryOutcome[] = [];
  let emailsSent = 0;

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
      reclaimed: claim.reclaimed,
    };

    const finish = async (status: 'sent' | 'failed', channels: string[], error: string | null) => {
      await deps.mark(claim.notification_id, status, channels, error);
      outcomes.push({ ...base, status, channels, error });
    };

    if (now() - startedAt > budgetMs) {
      // Nothing was sent for this row, so a retry is safe at once.
      await finish('failed', [], 'send budget exhausted');
      continue;
    }
    if (!employee) {
      await finish('failed', [], 'employee not found');
      continue;
    }
    if (lines.length === 0) {
      await finish('sent', [], 'no visible change');
      continue;
    }

    const errors: string[] = [];
    const channels: string[] = [];
    if (deps.sendEmail && employee.email) {
      if (emailsSent > 0 && intervalMs > 0) await sleep(intervalMs);
      emailsSent++;
      if (await attempt(deps.sendEmail, employee, lines, claim.notification_id, errors)) channels.push('email');
    }
    if (deps.sendPush && employee.user_id) {
      if (await attempt(deps.sendPush, employee, lines, claim.notification_id, errors)) channels.push('push');
    }

    if (channels.length > 0) {
      await finish('sent', channels, null);
    } else {
      await finish('failed', [], errors[0] ?? 'no channel reached the employee');
    }
  }

  return outcomes;
}

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
  status: 'sent' | 'failed',
  channels: string[],
  error: string | null,
): Promise<void> {
  const { error: rpcError } = await client.rpc('mark_schedule_notification', {
    p_id: id,
    p_status: status,
    p_channels: channels,
    p_error: error,
  });
  if (rpcError) {
    // The send already happened. Log, and let the row stay 'claimed': the
    // pending tool shows it as in_doubt, and a retry inside the window uses
    // the same idempotency key.
    console.error(`mark_schedule_notification failed for ${id}: ${rpcError.message}`);
  }
}
