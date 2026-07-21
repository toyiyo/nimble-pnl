/* eslint-disable @typescript-eslint/no-explicit-any */
// `(window as any).__supabase` / `__getRestaurantId` are the e2e page-side test
// hooks exposed by exposeSupabaseHelpers — untyped by design, as in the sibling
// scheduling e2e specs. Disable no-explicit-any file-wide to match that pattern.
import { test, expect, type Page, type Request } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E for the manager decision path of Open Shift Claiming (approval-required):
 * a pending claim is approved/rejected in the TradeApprovalQueue, which must
 *  - persist the manager's reviewer note (new `reviewer_note` column),
 *  - flip the claim status (and, on approve, create the shift),
 *  - fire the `notify-open-shift-claim` edge function (fire-and-forget) with the
 *    correct action, and
 *  - show the "will be notified" banner on BOTH approve and reject.
 *
 * The two existing open-shift-claiming specs only cover the instant-claim path
 * (`require_shift_claim_approval: false`) and never touch this queue — this
 * fills that gap.
 *
 * The notification is fire-and-forget and the edge function is not served in the
 * e2e stack, so we intercept the `functions/v1/notify-open-shift-claim` request
 * (stubbing a 200) to assert the client actually invokes it with the right body;
 * real email/push delivery is covered by unit tests, not asserted here.
 */

const NOTIFY_GLOB = '**/functions/v1/notify-open-shift-claim';

interface SeededClaim {
  restaurantId: string;
  claimId: string;
  employeeId: string;
  employeeName: string;
  templateName: string;
}

/**
 * Sign up a manager (owner), enable approval-required open shifts, and seed one
 * PENDING claim from a separate employee. The manager stays `owner` so the
 * /scheduling approval queue is visible.
 */
async function seedPendingClaim(page: Page, slug: string, employeeName: string): Promise<SeededClaim> {
  const testUser = generateTestUser(slug);
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const seeded = await page.evaluate(
    async (args: { restId: string; employeeName: string }) => {
      const supabase = (window as any).__supabase;
      const { restId, employeeName } = args;

      // Approval-required open shifts.
      const { error: settingsError } = await supabase
        .from('staffing_settings')
        .upsert(
          { restaurant_id: restId, open_shifts_enabled: true, require_shift_claim_approval: true },
          { onConflict: 'restaurant_id' }
        );
      if (settingsError) throw new Error(`staffing_settings upsert failed: ${settingsError.message}`);

      // Active template (capacity > 1 for realism; approve does not re-check capacity).
      const { data: template, error: templateError } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: restId,
          name: 'Weekend Prep',
          start_time: '09:00:00',
          end_time: '17:00:00',
          position: 'Cook',
          capacity: 2,
          days: [0, 1, 2, 3, 4, 5, 6],
          is_active: true,
        })
        .select()
        .single();
      if (templateError) throw new Error(`shift_templates insert failed: ${templateError.message}`);

      // The claiming employee. RLS `employees_insert_own_claims` only permits
      // inserting a claim whose employee is linked to the caller's own user_id, so
      // (as in the sibling claiming specs) the employee row is linked to the manager's
      // auth user. The display name stays distinct so the queue still reads naturally.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: employeeName,
          position: 'Cook',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      // A future claim date (approve builds the shift from template times + this date;
      // no day-of-week / publication check on the approve path).
      const d = new Date();
      d.setDate(d.getDate() + 7);
      const pad = (n: number) => String(n).padStart(2, '0');
      const shiftDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      const { data: claim, error: claimError } = await supabase
        .from('open_shift_claims')
        .insert({
          restaurant_id: restId,
          shift_template_id: template.id,
          shift_date: shiftDate,
          claimed_by_employee_id: employee.id,
          status: 'pending_approval',
        })
        .select()
        .single();
      if (claimError) throw new Error(`open_shift_claims insert failed: ${claimError.message}`);

      return { claimId: claim.id, employeeId: employee.id, templateName: template.name };
    },
    { restId: restaurantId as string, employeeName }
  );

  return {
    restaurantId: restaurantId as string,
    claimId: seeded.claimId,
    employeeId: seeded.employeeId,
    employeeName,
    templateName: seeded.templateName,
  };
}

/** Intercept the fire-and-forget notify invoke; return the collected POST bodies. */
async function interceptNotify(page: Page): Promise<Array<Record<string, unknown>>> {
  const notifyBodies: Array<Record<string, unknown>> = [];
  await page.route(NOTIFY_GLOB, async (route) => {
    const req: Request = route.request();
    if (req.method() === 'POST') {
      try {
        notifyBodies.push(req.postDataJSON() as Record<string, unknown>);
      } catch {
        // ignore unparseable body
      }
    }
    // Stub a success (+ CORS) so the browser's preflight/POST resolve without the
    // real edge function, which isn't served in the e2e stack.
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
      contentType: 'application/json',
      body: JSON.stringify({ success: true, emailSent: false, pushSent: 0 }),
    });
  });
  return notifyBodies;
}

async function openApprovalQueue(page: Page): Promise<void> {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 10000 });
  await page.getByRole('tab', { name: /shift trades/i }).click();
  await expect(page.getByRole('heading', { name: /pending shift claims/i })).toBeVisible({ timeout: 15000 });
}

test.describe('Open Shift Claim — manager approval queue', () => {
  test('manager approves a pending claim: note persisted, shift created, employee notified', async ({ page }) => {
    const { restaurantId, claimId, employeeName } = await seedPendingClaim(page, 'claim-approve', 'Casey Claimer');
    const notifyBodies = await interceptNotify(page);

    await openApprovalQueue(page);

    // The pending claim card is visible with the claiming employee.
    const card = page.getByTestId('pending-claim').filter({ hasText: employeeName });
    await expect(card).toBeVisible({ timeout: 15000 });

    // Open the approve dialog.
    await card.getByRole('button', { name: /approve/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Approve Shift Claim')).toBeVisible({ timeout: 5000 });

    // The "will be notified" banner (shadcn Alert, role=alert) is present.
    await expect(dialog.getByRole('alert')).toContainText(/will be notified of your decision/i);

    // Enter a reviewer note.
    await dialog.locator('#claim-manager-note').fill('Approved via e2e');

    // Confirm — wait for the RPC to resolve.
    const rpcPromise = page
      .waitForResponse((r) => r.url().includes('approve_open_shift_claim') && r.status() === 200, { timeout: 15000 })
      .catch(() => null);
    await dialog.getByRole('button', { name: /^approve$/i }).click();
    await rpcPromise;

    // Dialog closes and the claim leaves the pending list.
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('pending-claim').filter({ hasText: employeeName })).toHaveCount(0, { timeout: 10000 });

    // The client invoked notify-open-shift-claim with the approved action for this claim.
    await expect.poll(() => notifyBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(notifyBodies.some((b) => b.claimId === claimId && b.action === 'approved')).toBe(true);

    // DB: claim approved, note persisted, shift created.
    const dbState = await page.evaluate(async (id: string) => {
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('open_shift_claims')
        .select('status, reviewer_note, resulting_shift_id')
        .eq('id', id)
        .single();
      return data;
    }, claimId);
    expect(dbState.status).toBe('approved');
    expect(dbState.reviewer_note).toBe('Approved via e2e');
    expect(dbState.resulting_shift_id).toBeTruthy();
    // The shift row exists for the restaurant.
    const shiftCount = await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;
      const { count } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restId)
        .eq('source', 'template');
      return count;
    }, restaurantId);
    expect(shiftCount).toBeGreaterThan(0);
  });

  test('manager rejects a pending claim: note persisted, no shift, employee notified', async ({ page }) => {
    const { claimId, employeeName } = await seedPendingClaim(page, 'claim-reject', 'Riley Reject');
    const notifyBodies = await interceptNotify(page);

    await openApprovalQueue(page);

    const card = page.getByTestId('pending-claim').filter({ hasText: employeeName });
    await expect(card).toBeVisible({ timeout: 15000 });

    // Open the reject dialog.
    await card.getByRole('button', { name: /reject/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Reject Shift Claim')).toBeVisible({ timeout: 5000 });

    // The "will be notified" banner now renders on the reject path too (the new behavior).
    await expect(dialog.getByRole('alert')).toContainText(/will be notified of your decision/i);

    await dialog.locator('#claim-manager-note').fill('Rejected via e2e');

    const rpcPromise = page
      .waitForResponse((r) => r.url().includes('reject_open_shift_claim') && r.status() === 200, { timeout: 15000 })
      .catch(() => null);
    await dialog.getByRole('button', { name: /^reject$/i }).click();
    await rpcPromise;

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('pending-claim').filter({ hasText: employeeName })).toHaveCount(0, { timeout: 10000 });

    // Notify invoked with the rejected action.
    await expect.poll(() => notifyBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(notifyBodies.some((b) => b.claimId === claimId && b.action === 'rejected')).toBe(true);

    // DB: claim rejected, note persisted, no resulting shift.
    const dbState = await page.evaluate(async (id: string) => {
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('open_shift_claims')
        .select('status, reviewer_note, resulting_shift_id')
        .eq('id', id)
        .single();
      return data;
    }, claimId);
    expect(dbState.status).toBe('rejected');
    expect(dbState.reviewer_note).toBe('Rejected via e2e');
    expect(dbState.resulting_shift_id).toBeNull();
  });
});
