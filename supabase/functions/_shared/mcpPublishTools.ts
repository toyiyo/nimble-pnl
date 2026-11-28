// MCP connector tools for publish and schedule notifications:
//   publish_week               (write: preview, then confirmed)
//   get_week_change_log        (read)
//   get_pending_notifications  (read)
//
// Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
// TLA+:   specs/tla/publish-notifications/PublishNotifications.tla
//
// publish_week uses the same code path as the UI publish
// (src/hooks/useSchedulePublish.tsx): the publish_schedule RPC with the
// user client, then the notify-schedule-published edge function with the
// user JWT. ai-execute-tool only dispatches here and injects the deps.
import { addDaysToDateStr } from "./labor/restaurantClock.ts";
import { restaurantDayBounds, ymdInTimeZone } from "./restaurantDate.ts";
import {
  buildChangeLines,
  formatShiftWindow,
  type DeliveryChange,
} from "./scheduleNotificationDelivery.ts";

/** The answer of notify-schedule-published, as the tool reads it. */
export interface NotifyAnswer {
  status: number;
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export interface PublishToolDeps {
  /** The user client (the caller's JWT). RLS and the RPC checks apply. */
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  tz: string;
  now: Date;
  /** POST to notify-schedule-published with the caller's JWT. */
  invokeNotify: (body: { publicationId: string; restaurantId: string; weekStart: string; weekEnd: string }) => Promise<NotifyAnswer>;
  /** EdgeRuntime.waitUntil, when the runtime has it. */
  waitUntil?: (p: Promise<unknown>) => void;
  /**
   * How long the confirm waits for the notify answer. The MCP forward
   * timeout is 25 s (supabase/functions/mcp/index.ts:26), and a large send
   * can take 90 s (supabase/functions/_shared/emailQueue.ts:41).
   */
  notifyWaitMs?: number;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolResult = any;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_HORIZON_DAYS = 56;
const MAX_ROWS = 300;
const DEFAULT_NOTIFY_WAIT_MS = 15_000;

const isRealDate = (s: unknown): s is string =>
  typeof s === "string" && YMD.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const invalid = (message: string): ToolResult => ({ ok: false, error: { code: "INVALID_ARGUMENTS", message } });

const rpcFailure = (code: string, message: string): ToolResult => ({
  ok: false,
  error: { code: /not authorized/i.test(message) ? "TOOL_PERMISSION_DENIED" : code, message },
});

/** "YYYY-MM-DD HH:mm" in the restaurant zone. */
export function localDateTime(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function weekOf(weekStart: unknown): { start: string; end: string } | { error: string } {
  if (!isRealDate(weekStart)) return { error: "week_start must be a real date in YYYY-MM-DD form." };
  return { start: weekStart, end: addDaysToDateStr(weekStart, 6) };
}

interface PendingRow {
  change_log_id: string;
  employee_id: string;
  employee_name: string | null;
  shift_date: string;
  change_type: string;
  changed_at: string;
  shift_id: string | null;
  shift_before: Record<string, unknown> | null;
  shift_after: Record<string, unknown> | null;
  state: "pending" | "failed" | "in_doubt" | "sending";
}

const asChange = (r: PendingRow): DeliveryChange => ({
  id: r.change_log_id,
  shift_id: r.shift_id,
  change_type: r.change_type,
  changed_at: r.changed_at,
  before_data: r.shift_before,
  after_data: r.shift_after,
});

async function loadPending(deps: PublishToolDeps, restaurantId: string, from: string, to: string) {
  const { data, error } = await deps.supabase.rpc("get_schedule_pending_notifications", {
    p_restaurant_id: restaurantId,
    p_from: from,
    p_to: to,
  });
  return { rows: (data ?? []) as PendingRow[], error: error as { message: string } | null };
}

interface Recipient {
  employee_id: string;
  employee_name: string | null;
  changes: string[];
}

/**
 * What a publish would send, per employee: the pending pairs that a claim
 * takes (pending and failed), plus the drafts that the publish flips.
 * Pairs in flight (sending) are not in it; in-doubt pairs are listed apart.
 */
async function previewWeek(deps: PublishToolDeps, restaurantId: string, week: { start: string; end: string }, notify: boolean) {
  const bounds = restaurantDayBounds(week.start, week.end, deps.tz);
  const [draftsRes, pending] = await Promise.all([
    deps.supabase
      .from("shifts")
      .select("id, employee_id, start_time, end_time, position")
      .eq("restaurant_id", restaurantId)
      .eq("is_published", false)
      .gte("start_time", bounds.start.toISOString())
      .lte("start_time", bounds.end.toISOString())
      .order("start_time", { ascending: true })
      .limit(1000),
    loadPending(deps, restaurantId, week.start, week.end),
  ]);
  if (draftsRes.error) return { error: `Failed to fetch shifts: ${draftsRes.error.message}` };
  if (pending.error) return { error: pending.error.message };

  const drafts = (draftsRes.data ?? []) as {
    id: string; employee_id: string | null; start_time: string; end_time: string; position: string | null;
  }[];

  const changesByEmployee = new Map<string, DeliveryChange[]>();
  const names = new Map<string, string | null>();
  const unconfirmed: { employee_id: string; employee_name: string | null; change_log_id: string }[] = [];

  if (notify) {
    for (const r of pending.rows) {
      names.set(r.employee_id, r.employee_name);
      if (r.state === "in_doubt") {
        unconfirmed.push({ employee_id: r.employee_id, employee_name: r.employee_name, change_log_id: r.change_log_id });
        continue;
      }
      if (r.state === "sending") continue;
      const list = changesByEmployee.get(r.employee_id) ?? [];
      list.push(asChange(r));
      changesByEmployee.set(r.employee_id, list);
    }
    for (const d of drafts) {
      if (!d.employee_id) continue;
      const list = changesByEmployee.get(d.employee_id) ?? [];
      list.push({
        id: `draft:${d.id}`,
        shift_id: d.id,
        change_type: "published",
        changed_at: deps.now.toISOString(),
        before_data: null,
        after_data: { ...d, is_published: true },
      });
      changesByEmployee.set(d.employee_id, list);
    }
  }

  const missingNames = [...changesByEmployee.keys()].filter((id) => !names.get(id));
  if (missingNames.length > 0) {
    const { data, error } = await deps.supabase
      .from("employees")
      .select("id, name")
      .eq("restaurant_id", restaurantId)
      .in("id", missingNames);
    if (error) return { error: `Failed to fetch employees: ${error.message}` };
    for (const e of (data ?? []) as { id: string; name: string | null }[]) names.set(e.id, e.name);
  }

  const recipients: Recipient[] = [];
  for (const [employeeId, changes] of changesByEmployee) {
    const lines = buildChangeLines(changes, employeeId, deps.tz);
    if (lines.length === 0) continue;
    recipients.push({ employee_id: employeeId, employee_name: names.get(employeeId) ?? null, changes: lines.map((l) => l.text) });
  }
  recipients.sort((a, b) => (a.employee_name ?? "").localeCompare(b.employee_name ?? ""));

  return {
    shiftsToPublish: drafts.length,
    openShiftsToPublish: drafts.filter((d) => !d.employee_id).length,
    recipients,
    unconfirmed,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  return Promise.race([p.then((value) => ({ done: true as const, value })), timeout]).finally(() => clearTimeout(timer));
}

export async function runPublishWeek(
  args: { week_start?: unknown; notify?: unknown; preview?: unknown; confirmed?: unknown },
  restaurantId: string,
  deps: PublishToolDeps,
): Promise<ToolResult> {
  const preview = args?.preview === true;
  const confirmed = args?.confirmed === true;
  if (!preview && !confirmed) {
    return { ok: false, error: { code: "INVALID_REQUEST", message: "Must specify preview:true or confirmed:true" } };
  }
  if (args.notify !== undefined && typeof args.notify !== "boolean") return invalid("notify must be true or false.");
  const notify = args.notify !== false;
  const week = weekOf(args.week_start);
  if ("error" in week) return invalid(week.error);

  const plan = await previewWeek(deps, restaurantId, week, notify);
  if ("error" in plan) return { ok: false, error: { code: "PREVIEW_FAILED", message: plan.error } };

  if (preview) {
    let message: string;
    if (plan.shiftsToPublish === 0 && plan.recipients.length === 0) {
      message = `Nothing to publish and nobody to notify for ${week.start} to ${week.end}.`;
    } else if (!notify) {
      message = `Will publish ${plan.shiftsToPublish} shift(s). No employee gets a notification (notify: false); their changes stay pending. Please confirm to proceed.`;
    } else {
      message = `Will publish ${plan.shiftsToPublish} shift(s) and notify ${plan.recipients.length} employee(s). Please confirm to proceed.`;
    }
    return {
      ok: true,
      data: {
        action: "publish_week",
        preview: true,
        week,
        tz: deps.tz,
        notify,
        shifts_to_publish: plan.shiftsToPublish,
        open_shifts_to_publish: plan.openShiftsToPublish,
        recipients: plan.recipients,
        unconfirmed: plan.unconfirmed,
        message,
      },
      evidence: [{ table: "shifts", summary: `${plan.shiftsToPublish} draft shift(s) in ${week.start}..${week.end}` }],
    };
  }

  const { data: publicationId, error: publishError } = await deps.supabase.rpc("publish_schedule", {
    p_restaurant_id: restaurantId,
    p_week_start: week.start,
    p_week_end: week.end,
    p_notes: null,
  });
  if (publishError) return rpcFailure("PUBLISH_FAILED", publishError.message);

  const base = {
    action: "publish_week",
    confirmed: true,
    week,
    tz: deps.tz,
    publication_id: publicationId as string,
    shifts_published: plan.shiftsToPublish,
  };

  if (!notify) {
    return {
      ok: true,
      data: { ...base, notifications: "skipped", recipients: [], message: "The schedule is published. No notifications were sent (notify: false)." },
    };
  }

  const call = deps.invokeNotify({ publicationId: publicationId as string, restaurantId, weekStart: week.start, weekEnd: week.end });
  const answer = await withTimeout(call, deps.notifyWaitMs ?? DEFAULT_NOTIFY_WAIT_MS);

  if (!answer.done) {
    deps.waitUntil?.(call.catch(() => undefined));
    return {
      ok: true,
      data: {
        ...base,
        notifications: "sending",
        recipients: plan.recipients,
        message:
          "The schedule is published. Notifications are still sending. Call get_pending_notifications in a minute to see what did not go out.",
      },
    };
  }

  const { status, body } = answer.value;
  const rows = Array.isArray(body?.recipients) ? body.recipients : null;
  if (!rows) {
    return {
      ok: true,
      data: {
        ...base,
        notifications: "error",
        recipients: [],
        message: `The schedule is published, but the notification service answered ${status}${body?.error ? ` (${body.error})` : ""}. Call get_pending_notifications to see who still needs a notification.`,
      },
    };
  }

  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recipients = rows.map((r: any) => ({
    employee_id: r.employeeId,
    employee_name: r.employeeName ?? null,
    status: r.status,
    channels: r.channels ?? [],
    changes: r.changes ?? [],
    ...(r.error && r.status !== "sent" ? { error: r.error } : {}),
  }));
  const sent = recipients.filter((r: { status: string }) => r.status === "sent").length;
  const failed = recipients.length - sent;
  const expected = new Set(plan.recipients.map((r) => r.employee_id));
  const actual = new Set(recipients.map((r: { employee_id: string }) => r.employee_id));
  const differs = expected.size !== actual.size || [...expected].some((id) => !actual.has(id));

  let notifications: string;
  let message: string;
  if (body?.nothingToSend) {
    notifications = "none";
    message = "The schedule is published. Nobody has a change since the last notification, so no notification was sent.";
  } else if (failed === 0) {
    notifications = "done";
    message = `The schedule is published. ${sent} employee(s) notified.`;
  } else {
    notifications = sent > 0 ? "partial" : "failed";
    message = `The schedule is published. ${sent} notified, ${failed} failed. The failed ones stay in get_pending_notifications.`;
  }
  if (differs) message += " The recipients differ from the preview, because the schedule changed between the two calls.";

  return {
    ok: true,
    data: { ...base, notifications, recipients, differs_from_preview: differs, message },
    evidence: [{ table: "schedule_notifications", summary: `${sent} sent, ${failed} failed` }],
  };
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shiftText = (data: any, tz: string): string | null =>
  data && data.start_time ? `${formatShiftWindow(data, tz)}${data.position ? ` (${data.position})` : ""}` : null;

export async function runGetWeekChangeLog(
  args: { week_start?: unknown },
  restaurantId: string,
  deps: PublishToolDeps,
): Promise<ToolResult> {
  const week = weekOf(args?.week_start);
  if ("error" in week) return invalid(week.error);

  const { data, error } = await deps.supabase.rpc("get_schedule_week_change_log", {
    p_restaurant_id: restaurantId,
    p_from: week.start,
    p_to: week.end,
  });
  if (error) return rpcFailure("CHANGE_LOG_FAILED", error.message);

  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (data ?? []) as any[];
  const rows = all.slice(0, MAX_ROWS);
  const tz = deps.tz;

  const changes = rows.map((r) => {
    const pendingFor = (r.pending_employees ?? []).map((p: { employee_name: string | null }) => p.employee_name ?? "Unknown");
    return {
      change_log_id: r.change_log_id,
      change_type: r.change_type,
      changed_at: localDateTime(r.changed_at, tz),
      changed_by: r.changed_by ? (r.changed_by_name || r.changed_by_email || "Unknown user") : "System",
      employee: r.employee_name ?? null,
      before: shiftText(r.shift_before, tz),
      after: shiftText(r.shift_after, tz),
      reason: r.reason ?? null,
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notifications: (r.notifications ?? []).map((n: any) => ({
        employee: n.employee_name ?? null,
        status: n.status,
        source: n.source,
        channels: n.channels ?? [],
        sent_at: localDateTime(n.sent_at, tz),
      })),
      ...(pendingFor.length > 0 ? { pending_for: pendingFor } : {}),
      ...(r.tracked === false ? { tracked: false, legacy_notified_at: localDateTime(r.notified_at, tz) } : {}),
    };
  });

  return {
    ok: true,
    data: {
      week,
      tz,
      count: changes.length,
      changes,
      ...(all.length > MAX_ROWS ? { data_limits: [`Only the first ${MAX_ROWS} of ${all.length} changes are listed.`] } : {}),
      note:
        "Times are local to the restaurant (tz). tracked:false rows are from before the notification ledger; legacy_notified_at is the only record for them.",
    },
  };
}

export async function runGetPendingNotifications(
  args: { week_start?: unknown },
  restaurantId: string,
  deps: PublishToolDeps,
): Promise<ToolResult> {
  let from: string;
  let to: string;
  if (args?.week_start == null || args.week_start === "") {
    from = ymdInTimeZone(deps.now, deps.tz);
    to = addDaysToDateStr(from, PENDING_HORIZON_DAYS);
  } else {
    const week = weekOf(args.week_start);
    if ("error" in week) return invalid(week.error);
    from = week.start;
    to = week.end;
  }

  const pending = await loadPending(deps, restaurantId, from, to);
  if (pending.error) return rpcFailure("PENDING_FAILED", pending.error.message);

  const byState: Record<string, number> = {};
  for (const r of pending.rows) byState[r.state] = (byState[r.state] ?? 0) + 1;

  const items = pending.rows.slice(0, MAX_ROWS).map((r) => ({
    change_log_id: r.change_log_id,
    employee: r.employee_name ?? null,
    shift_date: r.shift_date,
    change_type: r.change_type,
    change: buildChangeLines([asChange(r)], r.employee_id, deps.tz)[0]?.text ?? null,
    changed_at: localDateTime(r.changed_at, deps.tz),
    state: r.state,
  }));

  return {
    ok: true,
    data: {
      range: { start: from, end: to },
      tz: deps.tz,
      count: pending.rows.length,
      by_state: byState,
      pending: items,
      ...(pending.rows.length > MAX_ROWS ? { data_limits: [`Only the first ${MAX_ROWS} of ${pending.rows.length} are listed.`] } : {}),
      message: pending.rows.length === 0
        ? `No pending notifications for ${from} to ${to}.`
        : "pending: never sent. failed: the last send failed. in_doubt: a send started but did not confirm. sending: in flight now. publish_week with notify sends pending and failed ones.",
    },
  };
}
