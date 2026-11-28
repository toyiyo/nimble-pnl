import { describe, it, expect, vi } from 'vitest';
import {
  runPublishWeek,
  runGetWeekChangeLog,
  runGetPendingNotifications,
  localDateTime,
  type PublishToolDeps,
} from '../../supabase/functions/_shared/mcpPublishTools';

const R = 'rest-1';
const TZ = 'America/Chicago';
const ANA = 'emp-ana';
const BEN = 'emp-ben';
const NOW = new Date('2030-01-03T18:00:00Z'); // Thu Jan 3, 2030, noon in Chicago

type Result = { data: unknown; error: { message: string } | null };

/** A PostgREST-like builder: every filter returns the builder; await gives the table result. */
function fakeSupabase(tables: Record<string, Result>, rpcs: Record<string, Result | ((args: unknown) => Result)>) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpc = vi.fn(async (name: string, args: unknown) => {
    const r = rpcs[name];
    if (!r) throw new Error(`unexpected rpc ${name}`);
    return typeof r === 'function' ? r(args) : r;
  });
  const from = vi.fn((table: string) => {
    const entry = { table, filters: [] as unknown[][] };
    calls.push(entry);
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'limit', 'is']) {
      builder[m] = (...a: unknown[]) => {
        entry.filters.push([m, ...a]);
        return builder;
      };
    }
    builder.then = (resolve: (r: Result) => unknown) => resolve(tables[table] ?? { data: [], error: null });
    return builder;
  });
  return { client: { rpc, from }, rpc, from, calls };
}

const draftShift = (id: string, employeeId: string | null, startUtc: string, endUtc: string) => ({
  id,
  employee_id: employeeId,
  start_time: startUtc,
  end_time: endUtc,
  position: 'Server',
});

const pendingRow = (over: Record<string, unknown>) => ({
  change_log_id: 'c1',
  employee_id: ANA,
  employee_name: 'Ana',
  shift_date: '2030-01-07',
  change_type: 'updated',
  changed_at: '2030-01-03T17:00:00Z',
  changed_by: 'user-1',
  shift_id: 's1',
  shift_before: { employee_id: ANA, start_time: '2030-01-07T16:00:00Z', end_time: '2030-01-08T00:00:00Z', position: 'Server' },
  shift_after: { employee_id: ANA, start_time: '2030-01-07T17:00:00Z', end_time: '2030-01-08T00:00:00Z', position: 'Server' },
  state: 'pending',
  notification_id: null,
  ...over,
});

function deps(fake: ReturnType<typeof fakeSupabase>, over: Partial<PublishToolDeps> = {}): PublishToolDeps {
  return {
    supabase: fake.client,
    tz: TZ,
    now: NOW,
    invokeNotify: vi.fn(async () => ({ status: 200, body: { sent: 0, failed: 0, nothingToSend: true, recipients: [] } })),
    notifyWaitMs: 50,
    ...over,
  };
}

const baseTables = () => ({
  shifts: { data: [draftShift('d1', BEN, '2030-01-08T15:00:00Z', '2030-01-08T23:00:00Z'), draftShift('d2', null, '2030-01-09T15:00:00Z', '2030-01-09T23:00:00Z')], error: null },
  employees: { data: [{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }], error: null },
});

describe('localDateTime', () => {
  it('formats an instant in the restaurant zone', () => {
    expect(localDateTime('2030-01-07T16:00:00Z', TZ)).toBe('2030-01-07 10:00');
  });
  it('returns null for no value', () => {
    expect(localDateTime(null, TZ)).toBeNull();
  });
});

describe('runPublishWeek', () => {
  it('rejects a call with neither preview nor confirmed', async () => {
    const fake = fakeSupabase(baseTables(), {});
    const out = await runPublishWeek({ week_start: '2030-01-07' }, R, deps(fake));
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects a bad week_start', async () => {
    const fake = fakeSupabase(baseTables(), {});
    const out = await runPublishWeek({ week_start: '2030-02-30', preview: true }, R, deps(fake));
    expect(out.error.code).toBe('INVALID_ARGUMENTS');
  });

  it('previews each employee who gets a message and the shifts in it', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [pendingRow({})], error: null },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', preview: true }, R, deps(fake));

    expect(out.ok).toBe(true);
    expect(out.data.preview).toBe(true);
    expect(out.data.tz).toBe(TZ);
    expect(out.data.week).toEqual({ start: '2030-01-07', end: '2030-01-13' });
    expect(out.data.shifts_to_publish).toBe(2);
    expect(out.data.open_shifts_to_publish).toBe(1);
    expect(out.data.recipients).toEqual([
      {
        employee_id: ANA,
        employee_name: 'Ana',
        changes: ['Changed: Mon, Jan 7, 10:00 AM – 6:00 PM → Mon, Jan 7, 11:00 AM – 6:00 PM (Server)'],
      },
      { employee_id: BEN, employee_name: 'Ben', changes: ['New shift: Tue, Jan 8, 9:00 AM – 5:00 PM (Server)'] },
    ]);
    expect(fake.rpc).not.toHaveBeenCalledWith('publish_schedule', expect.anything());
    // The draft read is bounded to the local week and to drafts.
    const shiftsCall = fake.calls.find((c) => c.table === 'shifts')!;
    expect(shiftsCall.filters).toContainEqual(['eq', 'is_published', false]);
    expect(shiftsCall.filters).toContainEqual(['eq', 'restaurant_id', R]);
  });

  it('lists in-doubt pairs apart, and leaves out pairs that are in flight', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: {
        data: [pendingRow({ state: 'in_doubt' }), pendingRow({ change_log_id: 'c2', employee_id: BEN, employee_name: 'Ben', state: 'sending' })],
        error: null,
      },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', preview: true }, R, deps(fake));
    expect(out.data.unconfirmed).toEqual([{ employee_id: ANA, employee_name: 'Ana', change_log_id: 'c1' }]);
    expect(out.data.recipients.map((r: { employee_id: string }) => r.employee_id)).toEqual([BEN]);
  });

  it('previews no recipients for a quiet publish', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [pendingRow({})], error: null },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', preview: true, notify: false }, R, deps(fake));
    expect(out.data.recipients).toEqual([]);
    expect(out.data.message).toContain('No employee gets a notification');
  });

  it('says so when there is nothing to publish and nobody to notify', async () => {
    const fake = fakeSupabase({ shifts: { data: [], error: null }, employees: { data: [], error: null } }, {
      get_schedule_pending_notifications: { data: [], error: null },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', preview: true }, R, deps(fake));
    expect(out.data.message).toBe('Nothing to publish and nobody to notify for 2030-01-07 to 2030-01-13.');
  });

  it('confirms: calls publish_schedule, then the same notify function as the UI', async () => {
    const order: string[] = [];
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: () => {
        order.push('rpc');
        return { data: 'pub-1', error: null };
      },
    });
    const invokeNotify = vi.fn(async () => {
      order.push('notify');
      return {
        status: 200,
        body: {
          sent: 1,
          failed: 0,
          recipients: [{ employeeId: BEN, employeeName: 'Ben', status: 'sent', channels: ['email'], changes: ['New shift: x'] }],
        },
      };
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake, { invokeNotify }));

    expect(order).toEqual(['rpc', 'notify']);
    expect(fake.rpc).toHaveBeenCalledWith('publish_schedule', {
      p_restaurant_id: R,
      p_week_start: '2030-01-07',
      p_week_end: '2030-01-13',
      p_notes: null,
    });
    expect(invokeNotify).toHaveBeenCalledWith({
      publicationId: 'pub-1',
      restaurantId: R,
      weekStart: '2030-01-07',
      weekEnd: '2030-01-13',
    });
    expect(out.data).toMatchObject({
      confirmed: true,
      publication_id: 'pub-1',
      notifications: 'done',
      recipients: [{ employee_id: BEN, employee_name: 'Ben', status: 'sent', channels: ['email'], changes: ['New shift: x'] }],
      differs_from_preview: false,
    });
  });

  it('flags a confirm whose recipients differ from the preview', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [pendingRow({})], error: null },
      publish_schedule: { data: 'pub-1', error: null },
    });
    const invokeNotify = vi.fn(async () => ({
      status: 200,
      body: { sent: 1, failed: 0, recipients: [{ employeeId: BEN, employeeName: 'Ben', status: 'sent', channels: ['push'], changes: [] }] },
    }));
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake, { invokeNotify }));
    expect(out.data.differs_from_preview).toBe(true);
  });

  it('skips the notify call for a quiet publish', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: 'pub-1', error: null },
    });
    const d = deps(fake);
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true, notify: false }, R, d);
    expect(d.invokeNotify).not.toHaveBeenCalled();
    expect(out.data.notifications).toBe('skipped');
  });

  it('reports nothing to send for a republish with no change', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: 'pub-2', error: null },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake));
    expect(out.data.notifications).toBe('none');
    expect(out.data.recipients).toEqual([]);
  });

  it('returns "sending" when the notify call is slower than the wait, and keeps it alive', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: 'pub-1', error: null },
    });
    const waitUntil = vi.fn();
    const invokeNotify = vi.fn(() => new Promise<never>(() => {}));
    const out = await runPublishWeek(
      { week_start: '2030-01-07', confirmed: true },
      R,
      deps(fake, { invokeNotify, waitUntil, notifyWaitMs: 5 }),
    );
    expect(out.data.notifications).toBe('sending');
    expect(out.data.message).toContain('get_pending_notifications');
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('reports a partial send from a 502 answer', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: 'pub-1', error: null },
    });
    const invokeNotify = vi.fn(async () => ({
      status: 502,
      body: { sent: 1, failed: 1, recipients: [
        { employeeId: ANA, employeeName: 'Ana', status: 'failed', channels: [], changes: ['x'], error: 'no channel reached the employee' },
        { employeeId: BEN, employeeName: 'Ben', status: 'sent', channels: ['email'], changes: ['y'] },
      ] },
    }));
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake, { invokeNotify }));
    expect(out.data.notifications).toBe('partial');
    expect(out.data.message).toContain('1 notified, 1 failed');
  });

  it('reports a notify error after a committed publish, without a throw', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: 'pub-1', error: null },
    });
    const invokeNotify = vi.fn(async () => ({ status: 403, body: { error: 'Access denied' } }));
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake, { invokeNotify }));
    expect(out.ok).toBe(true);
    expect(out.data.notifications).toBe('error');
    expect(out.data.message).toContain('The schedule is published');
  });

  it('returns the RPC error when the publish fails', async () => {
    const fake = fakeSupabase(baseTables(), {
      get_schedule_pending_notifications: { data: [], error: null },
      publish_schedule: { data: null, error: { message: 'deadlock detected' } },
    });
    const out = await runPublishWeek({ week_start: '2030-01-07', confirmed: true }, R, deps(fake));
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('PUBLISH_FAILED');
  });
});

describe('runGetWeekChangeLog', () => {
  it('returns each change with actor, local times, tz, and who got a notification', async () => {
    const fake = fakeSupabase({}, {
      get_schedule_week_change_log: {
        data: [
          {
            change_log_id: 'c1',
            change_type: 'updated',
            changed_at: '2030-01-03T17:00:00Z',
            changed_by: 'user-1',
            changed_by_name: 'Jo Manager',
            changed_by_email: 'jo@example.com',
            shift_id: 's1',
            employee_id: ANA,
            employee_name: 'Ana',
            shift_before: { employee_id: ANA, start_time: '2030-01-07T16:00:00Z', end_time: '2030-01-08T00:00:00Z', position: 'Server' },
            shift_after: { employee_id: ANA, start_time: '2030-01-07T17:00:00Z', end_time: '2030-01-08T00:00:00Z', position: 'Server' },
            reason: null,
            tracked: true,
            notified_at: null,
            notifications: [
              { notification_id: 'n1', employee_id: ANA, employee_name: 'Ana', status: 'sent', source: 'shift_change', channels: ['email'], claimed_at: '2030-01-03T17:00:05Z', sent_at: '2030-01-03T17:00:06Z' },
            ],
            pending_employees: [],
          },
          {
            change_log_id: 'c2',
            change_type: 'deleted',
            changed_at: '2030-01-03T18:00:00Z',
            changed_by: null,
            changed_by_name: null,
            changed_by_email: null,
            shift_id: 's2',
            employee_id: BEN,
            employee_name: 'Ben',
            shift_before: { employee_id: BEN, start_time: '2030-01-08T16:00:00Z', end_time: '2030-01-09T00:00:00Z', position: 'Cook' },
            shift_after: null,
            reason: null,
            tracked: true,
            notified_at: null,
            notifications: [],
            pending_employees: [{ employee_id: BEN, employee_name: 'Ben' }],
          },
        ],
        error: null,
      },
    });
    const out = await runGetWeekChangeLog({ week_start: '2030-01-07' }, R, deps(fake));

    expect(fake.rpc).toHaveBeenCalledWith('get_schedule_week_change_log', {
      p_restaurant_id: R,
      p_from: '2030-01-07',
      p_to: '2030-01-13',
    });
    expect(out.ok).toBe(true);
    expect(out.data.tz).toBe(TZ);
    expect(out.data.changes[0]).toEqual({
      change_log_id: 'c1',
      change_type: 'updated',
      changed_at: '2030-01-03 11:00',
      changed_by: 'Jo Manager',
      employee: 'Ana',
      before: 'Mon, Jan 7, 10:00 AM – 6:00 PM (Server)',
      after: 'Mon, Jan 7, 11:00 AM – 6:00 PM (Server)',
      reason: null,
      notifications: [{ employee: 'Ana', status: 'sent', source: 'shift_change', channels: ['email'], sent_at: '2030-01-03 11:00' }],
    });
    expect(out.data.changes[1].changed_by).toBe('System');
    expect(out.data.changes[1].notifications).toEqual([]);
    expect(out.data.changes[1].pending_for).toEqual(['Ben']);
  });

  it('marks a pre-ledger row as untracked, with notified_at', async () => {
    const fake = fakeSupabase({}, {
      get_schedule_week_change_log: {
        data: [{
          change_log_id: 'c0', change_type: 'updated', changed_at: '2029-12-01T17:00:00Z', changed_by: 'u', changed_by_name: null,
          changed_by_email: 'a@b.c', shift_id: 's', employee_id: ANA, employee_name: 'Ana', shift_before: null, shift_after: null,
          reason: null, tracked: false, notified_at: '2029-12-01T17:01:00Z', notifications: [], pending_employees: [],
        }],
        error: null,
      },
    });
    const out = await runGetWeekChangeLog({ week_start: '2030-01-07' }, R, deps(fake));
    expect(out.data.changes[0]).toMatchObject({ changed_by: 'a@b.c', tracked: false, legacy_notified_at: '2029-12-01 11:01' });
    expect(out.data.changes[0].pending_for).toBeUndefined();
  });

  it('requires week_start', async () => {
    const out = await runGetWeekChangeLog({}, R, deps(fakeSupabase({}, {})));
    expect(out.error.code).toBe('INVALID_ARGUMENTS');
  });

  it('returns an access error from the RPC as TOOL_PERMISSION_DENIED', async () => {
    const fake = fakeSupabase({}, {
      get_schedule_week_change_log: { data: null, error: { message: 'Not authorized to view scheduling for restaurant x' } },
    });
    const out = await runGetWeekChangeLog({ week_start: '2030-01-07' }, R, deps(fake));
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('TOOL_PERMISSION_DENIED');
  });
});

describe('runGetPendingNotifications', () => {
  it('reads today to today + 56 days when week_start is absent', async () => {
    const fake = fakeSupabase({}, { get_schedule_pending_notifications: { data: [], error: null } });
    const out = await runGetPendingNotifications({}, R, deps(fake));
    expect(fake.rpc).toHaveBeenCalledWith('get_schedule_pending_notifications', {
      p_restaurant_id: R,
      p_from: '2030-01-03',
      p_to: '2030-02-28',
    });
    expect(out.data.count).toBe(0);
    expect(out.data.message).toContain('No pending notifications');
  });

  it('lists each pending pair with its state and a count by state', async () => {
    const fake = fakeSupabase({}, {
      get_schedule_pending_notifications: {
        data: [pendingRow({}), pendingRow({ change_log_id: 'c2', employee_id: BEN, employee_name: 'Ben', state: 'failed' })],
        error: null,
      },
    });
    const out = await runGetPendingNotifications({ week_start: '2030-01-07' }, R, deps(fake));
    expect(fake.rpc).toHaveBeenCalledWith('get_schedule_pending_notifications', {
      p_restaurant_id: R,
      p_from: '2030-01-07',
      p_to: '2030-01-13',
    });
    expect(out.data.tz).toBe(TZ);
    expect(out.data.by_state).toEqual({ pending: 1, failed: 1 });
    expect(out.data.pending[0]).toEqual({
      change_log_id: 'c1',
      employee: 'Ana',
      shift_date: '2030-01-07',
      change_type: 'updated',
      change: 'Changed: Mon, Jan 7, 10:00 AM – 6:00 PM → Mon, Jan 7, 11:00 AM – 6:00 PM (Server)',
      changed_at: '2030-01-03 11:00',
      state: 'pending',
    });
  });
});
