import { describe, it, expect, vi } from 'vitest';
import {
  buildChangeLines,
  summarizeLines,
  deliverClaimed,
  claimNotifications,
  summarizeOutcomes,
  buildNotifyResponse,
  describeShift,
  type DeliveryChange,
  type DeliveryEmployee,
  type DeliverDeps,
  type ClaimedNotification,
} from '../../supabase/functions/_shared/scheduleNotificationDelivery';

const TZ = 'America/Chicago';
const ANA = 'emp-ana';
const BEN = 'emp-ben';

// Monday 2030-01-07 in Chicago (UTC-6).
const shift = (employeeId: string, startUtc: string, endUtc: string, extra: Record<string, unknown> = {}) => ({
  employee_id: employeeId,
  start_time: startUtc,
  end_time: endUtc,
  position: 'Server',
  is_published: true,
  ...extra,
});

const change = (over: Partial<DeliveryChange>): DeliveryChange => ({
  id: 'c1',
  shift_id: 's1',
  change_type: 'published',
  changed_at: '2030-01-01T10:00:00Z',
  before_data: null,
  after_data: null,
  ...over,
});

describe('buildChangeLines', () => {
  it('describes a published shift as a new shift in local time', () => {
    const lines = buildChangeLines(
      [change({ after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') })],
      ANA,
      TZ,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('added');
    expect(lines[0].text).toBe('New shift: Mon, Jan 7, 10:00 AM – 6:00 PM (Server)');
  });

  it('describes a time change with the old and the new time', () => {
    const lines = buildChangeLines(
      [
        change({
          change_type: 'updated',
          before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
          after_data: shift(ANA, '2030-01-07T17:00:00Z', '2030-01-08T00:00:00Z'),
        }),
      ],
      ANA,
      TZ,
    );
    expect(lines[0].kind).toBe('changed');
    expect(lines[0].text).toBe(
      'Changed: Mon, Jan 7, 10:00 AM – 6:00 PM → Mon, Jan 7, 11:00 AM – 6:00 PM (Server)',
    );
  });

  it('tells the old employee that a reassigned shift is removed, and the new one that it is new', () => {
    const reassign = change({
      change_type: 'updated',
      before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
      after_data: shift(BEN, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
    });
    expect(buildChangeLines([reassign], ANA, TZ)[0].kind).toBe('removed');
    expect(buildChangeLines([reassign], BEN, TZ)[0].kind).toBe('added');
  });

  it('describes a deleted shift as removed', () => {
    const lines = buildChangeLines(
      [change({ change_type: 'deleted', before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') })],
      ANA,
      TZ,
    );
    expect(lines[0].text).toBe('Removed: Mon, Jan 7, 10:00 AM – 6:00 PM (Server)');
  });

  it('folds two changes of one shift into one line (first before, last after)', () => {
    const lines = buildChangeLines(
      [
        change({
          id: 'c2',
          change_type: 'updated',
          changed_at: '2030-01-01T11:00:00Z',
          before_data: shift(ANA, '2030-01-07T17:00:00Z', '2030-01-08T00:00:00Z'),
          after_data: shift(ANA, '2030-01-07T18:00:00Z', '2030-01-08T00:00:00Z'),
        }),
        change({
          id: 'c1',
          change_type: 'updated',
          changed_at: '2030-01-01T10:00:00Z',
          before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
          after_data: shift(ANA, '2030-01-07T17:00:00Z', '2030-01-08T00:00:00Z'),
        }),
      ],
      ANA,
      TZ,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('10:00 AM – 6:00 PM → Mon, Jan 7, 12:00 PM – 6:00 PM');
  });

  it('drops a shift whose changes cancel out (added, then deleted)', () => {
    const lines = buildChangeLines(
      [
        change({ id: 'c1', after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
        change({
          id: 'c2',
          change_type: 'deleted',
          changed_at: '2030-01-01T11:00:00Z',
          before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
        }),
      ],
      ANA,
      TZ,
    );
    expect(lines).toEqual([]);
  });

  it('says "Updated" when the window and position stay the same (for example, a notes change)', () => {
    const lines = buildChangeLines(
      [change({
        change_type: 'updated',
        before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z', { notes: 'a' }),
        after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z', { notes: 'b' }),
      })],
      ANA,
      TZ,
    );
    expect(lines[0].text).toBe('Updated: Mon, Jan 7, 10:00 AM – 6:00 PM (Server)');
  });

  it('describes a cancelled shift as removed', () => {
    const lines = buildChangeLines(
      [change({
        change_type: 'updated',
        before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'),
        after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z', { status: 'cancelled' }),
      })],
      ANA,
      TZ,
    );
    expect(lines[0].kind).toBe('removed');
  });

  it('sorts lines by shift start', () => {
    const lines = buildChangeLines(
      [
        change({ id: 'c1', shift_id: 's-late', after_data: shift(ANA, '2030-01-09T16:00:00Z', '2030-01-10T00:00:00Z') }),
        change({ id: 'c2', shift_id: 's-early', after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
      ],
      ANA,
      TZ,
    );
    expect(lines.map((l) => l.shiftId)).toEqual(['s-early', 's-late']);
  });
});

describe('summarizeLines', () => {
  it('uses the one line as the push body', () => {
    expect(summarizeLines([{ shiftId: 's', kind: 'added', text: 'New shift: X', sortKey: '' }])).toEqual({
      title: 'Schedule update',
      body: 'New shift: X',
    });
  });

  it('counts several lines', () => {
    const line = { shiftId: 's', kind: 'added' as const, text: 'x', sortKey: '' };
    expect(summarizeLines([line, line, line]).body).toBe('3 changes to your schedule. Open the app to see them.');
  });
});

const employees: DeliveryEmployee[] = [
  { id: ANA, name: 'Ana', email: 'ana@example.com', user_id: 'user-ana' },
  { id: BEN, name: 'Ben', email: null, user_id: null },
];

const changes: DeliveryChange[] = [
  change({ id: 'c-ana', shift_id: 's1', after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
  change({ id: 'c-ben', shift_id: 's2', after_data: shift(BEN, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
];

function makeDeps(over: Partial<DeliverDeps> = {}): DeliverDeps {
  return {
    timeZone: TZ,
    loadChanges: vi.fn(async (ids: string[]) => changes.filter((c) => ids.includes(c.id))),
    loadEmployees: vi.fn(async (ids: string[]) => employees.filter((e) => ids.includes(e.id))),
    sendEmail: vi.fn(async () => 'sent' as const),
    sendPush: vi.fn(async () => 'sent' as const),
    mark: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  };
}

const claim = (id: string, employeeId: string, ids: string[]): ClaimedNotification => ({
  notification_id: id,
  employee_id: employeeId,
  change_log_ids: ids,
  reclaimed: false,
});

describe('deliverClaimed', () => {
  it('sends each claimed row once and marks it sent with the channels that went out', async () => {
    const deps = makeDeps();
    const out = await deliverClaimed([claim('n1', ANA, ['c-ana'])], deps);

    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.sendEmail).mock.calls[0][2]).toBe('n1'); // idempotency key = row id
    expect(vi.mocked(deps.sendPush).mock.calls[0][2]).toBe('n1'); // push tag = row id
    expect(deps.mark).toHaveBeenCalledWith('n1', 'sent', ['email', 'push'], null, false);
    expect(out[0]).toMatchObject({ notificationId: 'n1', employeeName: 'Ana', status: 'sent', channels: ['email', 'push'] });
  });

  it('marks failed when no channel can reach the employee, so the pair stays pending', async () => {
    const deps = makeDeps();
    const out = await deliverClaimed([claim('n2', BEN, ['c-ben'])], deps);

    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.mark).toHaveBeenCalledWith('n2', 'failed', [], 'no channel reached the employee', false);
    expect(out[0].status).toBe('failed');
  });

  it('marks sent with one channel when the other fails', async () => {
    const deps = makeDeps({ sendEmail: vi.fn(async () => 'failed' as const) });
    await deliverClaimed([claim('n1', ANA, ['c-ana'])], deps);
    expect(deps.mark).toHaveBeenCalledWith('n1', 'sent', ['push'], null, false);
  });

  it('records the mark only after the send (TLA+ RecordAfter)', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      sendEmail: vi.fn(async () => {
        order.push('send');
        return 'sent' as const;
      }),
      sendPush: null,
      mark: vi.fn(async () => {
        order.push('mark');
      }),
    });
    await deliverClaimed([claim('n1', ANA, ['c-ana'])], deps);
    expect(order).toEqual(['send', 'mark']);
  });

  it('marks a thrown send as an uncertain failure, and goes on with the next row', async () => {
    const deps = makeDeps({
      sendEmail: vi.fn(async () => {
        throw new Error('boom');
      }),
      sendPush: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const out = await deliverClaimed([claim('n1', ANA, ['c-ana']), claim('n2', BEN, ['c-ben'])], deps);
    expect(out.map((o) => o.status)).toEqual(['failed', 'failed']);
    expect(deps.mark).toHaveBeenCalledWith('n1', 'failed', [], 'boom', true);
    expect(deps.mark).toHaveBeenCalledTimes(2);
  });

  it('marks a row with no visible change as skipped, with no send', async () => {
    const deps = makeDeps({
      loadChanges: vi.fn(async () => [
        change({ id: 'x1', after_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
        change({ id: 'x2', change_type: 'deleted', changed_at: '2030-01-01T11:00:00Z', before_data: shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z') }),
      ]),
    });
    await deliverClaimed([claim('n1', ANA, ['x1', 'x2'])], deps);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.mark).toHaveBeenCalledWith('n1', 'skipped', [], 'no visible change', false);
  });

  it('defers the rest when the time budget runs out, without a send', async () => {
    let t = 0;
    const deps = makeDeps({ now: () => t, budgetMs: 1000, sendEmail: vi.fn(async () => { t += 2000; return 'sent' as const; }) });
    const out = await deliverClaimed([claim('n1', ANA, ['c-ana']), claim('n3', ANA, ['c-ana'])], deps);
    expect(out.map((o) => o.status)).toEqual(['sent', 'deferred']);
    expect(deps.mark).toHaveBeenLastCalledWith('n3', 'deferred', [], 'send budget exhausted', false);
  });

  it('skips the push when the email used up the budget', async () => {
    let t = 0;
    const deps = makeDeps({ now: () => t, budgetMs: 1000, sendEmail: vi.fn(async () => { t += 2000; return 'sent' as const; }) });
    await deliverClaimed([claim('n1', ANA, ['c-ana'])], deps);
    expect(deps.sendPush).not.toHaveBeenCalled();
    expect(deps.mark).toHaveBeenCalledWith('n1', 'sent', ['email'], null, false);
  });

  it('marks a timed-out email as an uncertain failure', async () => {
    const deps = makeDeps({ sendEmail: vi.fn(async () => 'uncertain' as const), sendPush: null });
    await deliverClaimed([claim('n1', ANA, ['c-ana'])], deps);
    expect(deps.mark).toHaveBeenCalledWith('n1', 'failed', [], 'no channel reached the employee', true);
  });

  it('gives every row back when a load fails, then throws', async () => {
    const deps = makeDeps({ loadChanges: vi.fn(async () => { throw new Error('414'); }) });
    await expect(deliverClaimed([claim('n1', ANA, ['c-ana']), claim('n2', BEN, ['c-ben'])], deps)).rejects.toThrow('414');
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.mark).toHaveBeenCalledWith('n1', 'deferred', [], 'load failed: 414', false);
    expect(deps.mark).toHaveBeenCalledWith('n2', 'deferred', [], 'load failed: 414', false);
  });

  it('paces email sends from the start of the last email', async () => {
    let t = 0;
    const deps = makeDeps({ intervalMs: 500, now: () => t, sendEmail: vi.fn(async () => { t += 200; return 'sent' as const; }) });
    await deliverClaimed([claim('n1', ANA, ['c-ana']), claim('n3', ANA, ['c-ana'])], deps);
    expect(deps.sleep).toHaveBeenCalledWith(300);
  });

  it('does not sleep when the last email took longer than the interval', async () => {
    let t = 0;
    const deps = makeDeps({ intervalMs: 500, now: () => t, sendEmail: vi.fn(async () => { t += 900; return 'sent' as const; }) });
    await deliverClaimed([claim('n1', ANA, ['c-ana']), claim('n3', ANA, ['c-ana'])], deps);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('does nothing and loads nothing for an empty claim list', async () => {
    const deps = makeDeps();
    expect(await deliverClaimed([], deps)).toEqual([]);
    expect(deps.loadChanges).not.toHaveBeenCalled();
  });
});

describe('summarizeOutcomes and buildNotifyResponse', () => {
  const outcome = (status: 'sent' | 'skipped' | 'failed' | 'deferred') => ({
    notificationId: `n-${status}`, employeeId: 'e', employeeName: 'E', status, channels: [], lines: [], error: null,
  });

  it('counts each status and answers 200 when nobody was missed', () => {
    expect(summarizeOutcomes([outcome('sent'), outcome('skipped')])).toEqual({ sent: 1, skipped: 1, failed: 0, deferred: 0, httpStatus: 200 });
  });

  it('answers 502 when a row failed or was deferred', () => {
    expect(summarizeOutcomes([outcome('sent'), outcome('deferred')]).httpStatus).toBe(502);
    expect(summarizeOutcomes([outcome('failed')]).httpStatus).toBe(502);
  });

  it('reports failed + deferred as failed, and skipped apart from sent', () => {
    const body = buildNotifyResponse([outcome('sent'), outcome('skipped'), outcome('failed'), outcome('deferred')], 2);
    expect(body).toMatchObject({ success: false, sent: 1, skipped: 1, failed: 2, deferred: 1, pushSent: 2, totalEmployees: 4 });
    expect(body.recipients.map((r) => r.status)).toEqual(['sent', 'skipped', 'failed', 'deferred']);
  });
});

describe('describeShift', () => {
  it('names the window and the position', () => {
    expect(describeShift(shift(ANA, '2030-01-07T16:00:00Z', '2030-01-08T00:00:00Z'), TZ)).toBe('Mon, Jan 7, 10:00 AM – 6:00 PM (Server)');
  });
  it('returns null for no snapshot', () => {
    expect(describeShift(null, TZ)).toBeNull();
  });
});

describe('claimNotifications', () => {
  it('calls the claim RPC with the scope and returns its rows', async () => {
    const rows = [claim('n1', ANA, ['c-ana'])];
    const rpc = vi.fn(async () => ({ data: rows, error: null }));
    const out = await claimNotifications({ rpc }, {
      restaurantId: 'r1',
      from: '2030-01-07',
      to: '2030-01-13',
      source: 'publish',
      publicationId: 'p1',
    });
    expect(rpc).toHaveBeenCalledWith('claim_schedule_notifications', {
      p_restaurant_id: 'r1',
      p_from: '2030-01-07',
      p_to: '2030-01-13',
      p_source: 'publish',
      p_publication_id: 'p1',
      p_change_log_id: null,
    });
    expect(out).toEqual(rows);
  });

  it('logs when the mark finds the row no longer claimed', async () => {
    const { markNotification } = await import('../../supabase/functions/_shared/scheduleNotificationDelivery');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    await markNotification({ rpc }, 'n1', 'sent', ['email'], null, false);
    expect(rpc).toHaveBeenCalledWith('mark_schedule_notification', {
      p_id: 'n1', p_status: 'sent', p_channels: ['email'], p_error: null, p_uncertain: false,
    });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('no longer claimed'));
    err.mockRestore();
  });

  it('throws on an RPC error', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'nope' } }));
    await expect(
      claimNotifications({ rpc }, { restaurantId: 'r1', from: null, to: null, source: 'shift_change', changeLogId: 'c1' }),
    ).rejects.toThrow('claim_schedule_notifications failed: nope');
  });
});
