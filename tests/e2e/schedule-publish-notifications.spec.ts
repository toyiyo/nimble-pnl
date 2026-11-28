import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';
import { getServiceRoleClient } from '../helpers/e2e-service-role';

/**
 * Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
 *
 * Covers the seam from the publish action to the notification ledger:
 *   - the UI publish writes one `published` change-log row and one
 *     notification row per employee (schedule_notifications);
 *   - the MCP publish_week tool (through ai-execute-tool, the path the
 *     connector forwards to) previews the recipient, publishes, and a second
 *     confirm with no change sends nothing (TLA+ NoEmptyNotification);
 *   - get_week_change_log names who got a notification, and
 *     get_pending_notifications is empty after the send.
 *
 * CI has no email or push keys, so a send reaches nobody and the row is
 * `failed`. The test then marks the row `sent` with the service role (Node
 * process only), the same state a real delivery leaves.
 */
test.use({ timezoneId: 'America/New_York' });

type WindowHelpers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __supabase: any;
  __getRestaurantId: () => Promise<string>;
};

/** Monday of the current local week, as YYYY-MM-DD (the page runs in America/New_York). */
async function currentMonday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  });
}

/** One active employee and one Wednesday 10:00-16:00 draft shift in the current week. */
async function seedEmployeeAndShift(page: Page, restaurantId: string, name: string): Promise<string> {
  return page.evaluate(
    async ({ restId, employeeName }) => {
      const supabase = (window as unknown as WindowHelpers).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: employeeName,
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select('id')
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const wednesday = new Date(monday);
      wednesday.setDate(monday.getDate() + 2);
      wednesday.setHours(10, 0, 0, 0);
      const end = new Date(wednesday);
      end.setHours(16, 0, 0, 0);

      const { error: shiftError } = await supabase.from('shifts').insert({
        restaurant_id: restId,
        employee_id: employee.id,
        start_time: wednesday.toISOString(),
        end_time: end.toISOString(),
        position: 'Server',
      });
      if (shiftError) throw new Error(`shifts insert failed: ${shiftError.message}`);
      return employee.id as string;
    },
    { restId: restaurantId, employeeName: name },
  );
}

/** Call a connector tool the way the MCP server forwards it: ai-execute-tool with the user JWT. */
async function callTool(page: Page, restaurantId: string, toolName: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ restId, tool, toolArgs }) => {
      const supabase = (window as unknown as WindowHelpers).__supabase;
      const { data, error } = await supabase.functions.invoke('ai-execute-tool', {
        body: { tool_name: tool, arguments: toolArgs, restaurant_id: restId },
      });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(`ai-execute-tool ${tool} failed: ${JSON.stringify(body ?? error.message)}`);
      }
      return data;
    },
    { restId: restaurantId, tool: toolName, toolArgs: args },
  );
}

async function ledger(page: Page, restaurantId: string) {
  return page.evaluate(async (restId) => {
    const supabase = (window as unknown as WindowHelpers).__supabase;
    const [logs, notes, links] = await Promise.all([
      supabase.from('schedule_change_logs').select('id, change_type').eq('restaurant_id', restId),
      supabase.from('schedule_notifications').select('id, status, employee_id').eq('restaurant_id', restId),
      supabase.from('schedule_notification_changes').select('change_log_id, employee_id').eq('restaurant_id', restId),
    ]);
    return {
      published: (logs.data ?? []).filter((r: { change_type: string }) => r.change_type === 'published').length,
      notifications: notes.data ?? [],
      links: links.data ?? [],
    };
  }, restaurantId);
}

async function markAllSent(restaurantId: string) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from('schedule_notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString(), channels: ['email'] })
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(`mark sent failed: ${error.message}`);
}

async function signUp(page: Page, prefix: string): Promise<string> {
  await signUpAndCreateRestaurant(page, generateTestUser(prefix));
  await exposeSupabaseHelpers(page);
  const restaurantId = await page.evaluate(() => (window as unknown as WindowHelpers).__getRestaurantId());
  expect(restaurantId).toBeTruthy();
  return restaurantId;
}

test.describe('Publish notification ledger', () => {
  test('a UI publish logs the publish and claims one notification per employee', async ({ page }) => {
    const restaurantId = await signUp(page, 'publedger');
    const employeeId = await seedEmployeeAndShift(page, restaurantId, 'Lena Ledger');

    await page.goto('/scheduling');
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publishBtn).toBeEnabled({ timeout: 15000 });
    await publishBtn.click();

    const dialog = page.getByRole('dialog', { name: /publish schedule/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /notify employees about this schedule/i })).toBeChecked();

    const notifyResponse = page.waitForResponse((r) => r.url().includes('notify-schedule-published'), { timeout: 30000 });
    await dialog.getByRole('button', { name: /publish schedule/i }).click();
    await notifyResponse;

    await expect.poll(async () => (await ledger(page, restaurantId)).published, { timeout: 10000 }).toBe(1);
    const state = await ledger(page, restaurantId);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].employee_id).toBe(employeeId);
    expect(['sent', 'failed']).toContain(state.notifications[0].status);
    expect(state.links).toHaveLength(1);

    // The change log dialog shows the new published row.
    await page.getByRole('button', { name: 'Changes' }).click();
    await expect(page.getByRole('dialog').getByText('published', { exact: true })).toBeVisible();
  });

  test('MCP publish_week previews, publishes, and a second publish with no change sends nothing', async ({ page }) => {
    const restaurantId = await signUp(page, 'mcppub');
    await seedEmployeeAndShift(page, restaurantId, 'Milo Mcp');
    const weekStart = await currentMonday(page);

    const preview = await callTool(page, restaurantId, 'publish_week', { week_start: weekStart, preview: true });
    expect(preview.ok).toBe(true);
    expect(preview.data.shifts_to_publish).toBe(1);
    expect(preview.data.tz).toBeTruthy();
    expect(preview.data.recipients).toHaveLength(1);
    expect(preview.data.recipients[0].employee_name).toBe('Milo Mcp');
    expect(preview.data.recipients[0].changes[0]).toMatch(/^New shift: Wed, /);
    expect((await ledger(page, restaurantId)).published).toBe(0); // the preview changes nothing

    const first = await callTool(page, restaurantId, 'publish_week', { week_start: weekStart, confirmed: true });
    expect(first.ok).toBe(true);
    expect(first.data.publication_id).toBeTruthy();
    expect((await ledger(page, restaurantId)).published).toBe(1);

    await markAllSent(restaurantId);

    const pending = await callTool(page, restaurantId, 'get_pending_notifications', { week_start: weekStart });
    expect(pending.data.count).toBe(0);

    const second = await callTool(page, restaurantId, 'publish_week', { week_start: weekStart, confirmed: true });
    expect(second.ok).toBe(true);
    expect(second.data.notifications).toBe('none');
    expect(second.data.recipients).toEqual([]);
    expect((await ledger(page, restaurantId)).notifications).toHaveLength(1); // no new row

    const log = await callTool(page, restaurantId, 'get_week_change_log', { week_start: weekStart });
    expect(log.data.tz).toBeTruthy();
    expect(log.data.changes).toHaveLength(1);
    expect(log.data.changes[0].change_type).toBe('published');
    expect(log.data.changes[0].notifications).toEqual([
      expect.objectContaining({ employee: 'Milo Mcp', status: 'sent' }),
    ]);
  });
});
