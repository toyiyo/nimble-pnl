import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E coverage for the Impact-Aware Deletion feature (T8). See
 * docs/superpowers/specs/2026-07-20-impact-aware-deletion-design.md.
 *
 * Flow A — shift template hard delete with a pending open-shift claim:
 * the Impact Ledger must surface the claimant, require an explicit
 * acknowledgment before "Delete template" unlocks, and the delete must
 * cascade the pending claim away with the template.
 *
 * Flow B — availability guardrail delete: deleting an `is_available:false`
 * (blackout) row must show the amber guardrail hero + ack checkbox before
 * "Delete block" unlocks, and the row must disappear from the grid after
 * confirming.
 */
test.describe('Impact-Aware Deletion', () => {
  test('Flow A: template delete surfaces pending claim, requires ack, cascades on delete', async ({ page }) => {
    const testUser = generateTestUser('deletion-template');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed: a template + an employee (linked to the signed-in manager, so
    // the manager's own auth.uid() satisfies the employees_insert_own_claims
    // RLS policy) + one pending open_shift_claim against that template.
    const seed = await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;

      const { data: template, error: templateError } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: restId,
          name: 'Closing Server',
          start_time: '16:00:00',
          end_time: '22:00:00',
          position: 'Server',
          capacity: 2,
          days: [0, 1, 2, 3, 4, 5, 6], // every day — deterministic regardless of today's weekday
          is_active: true,
        })
        .select()
        .single();
      if (templateError) throw new Error(`shift_templates insert failed: ${templateError.message}`);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: 'Alex Rivera',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      // A future shift_date so the claim is unambiguously "pending" work.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const shiftDateStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

      const { error: claimError } = await supabase.from('open_shift_claims').insert({
        restaurant_id: restId,
        shift_template_id: template.id,
        shift_date: shiftDateStr,
        claimed_by_employee_id: employee.id,
        status: 'pending_approval',
      });
      if (claimError) throw new Error(`open_shift_claims insert failed: ${claimError.message}`);

      return { templateId: template.id as string };
    }, restaurantId as string);

    // Navigate to the planner and locate the seeded template row.
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText('Closing Server')).toBeVisible({ timeout: 15000 });

    // Row actions button is hover-revealed — hover the row before clicking.
    const templateRow = page.locator('.group', { has: page.getByText('Closing Server') }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: 'Actions for Closing Server' });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();

    await page.getByRole('menuitem', { name: /delete template/i }).click();

    // Impact Ledger dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Delete "Closing Server"?')).toBeVisible();

    // High-impact pill + pending-claim ack gate — wait for the impact read
    // to resolve (loses the "Checking impact…" placeholder).
    await expect(dialog.getByText('Checking impact…')).not.toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('High impact')).toBeVisible();
    await expect(dialog.getByText(/1 pending claim/).first()).toBeVisible();
    await expect(dialog.getByText(/Alex Rivera/)).toBeVisible();

    const deleteButton = dialog.getByRole('button', { name: 'Delete template', exact: true });
    const ackCheckbox = dialog.getByRole('checkbox', {
      name: /I understand 1 employee's pending claim will be withdrawn\./,
    });
    await expect(ackCheckbox).toBeVisible();

    // Delete is gated on the ack until it's checked.
    await expect(deleteButton).toBeDisabled();
    await ackCheckbox.click();
    await expect(deleteButton).toBeEnabled();

    await deleteButton.click();

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Closing Server', { exact: true })).not.toBeVisible({ timeout: 10000 });

    // The template row is gone AND the cascade removed the pending claim.
    const finalState = await page.evaluate(async (args: { restId: string; templateId: string }) => {
      const supabase = (window as any).__supabase;
      const { data: templates } = await supabase
        .from('shift_templates')
        .select('id')
        .eq('restaurant_id', args.restId)
        .eq('id', args.templateId);
      const { data: claims } = await supabase
        .from('open_shift_claims')
        .select('id')
        .eq('restaurant_id', args.restId)
        .eq('shift_template_id', args.templateId);
      return { templateCount: templates?.length ?? -1, claimCount: claims?.length ?? -1 };
    }, { restId: restaurantId as string, templateId: seed.templateId });

    expect(finalState.templateCount).toBe(0);
    expect(finalState.claimCount).toBe(0);
  });

  test('Flow B: availability guardrail delete requires ack and removes the row', async ({ page }) => {
    const testUser = generateTestUser('deletion-avail');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          {
            name: 'Casey Morgan',
            position: 'Server',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1500,
          },
        ],
        restId: restaurantId,
      },
    );
    if (!(employees as any)?.length) {
      throw new Error('Employee seeding returned empty results');
    }
    const caseyId = (employees as any).find((e: any) => e.name === 'Casey Morgan')?.id;
    if (!caseyId) {
      throw new Error('Could not find Casey Morgan employee ID');
    }

    // Seed a recurring "blackout" (is_available:false) row on today's weekday
    // so it always falls inside the grid's default (current-week) view.
    const todayDow = new Date().getDay();
    await page.evaluate(
      ({ rows, restId }) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [
          {
            employee_id: caseyId,
            day_of_week: todayDow,
            start_time: '09:00:00',
            end_time: '17:00:00',
            is_available: false,
          },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /availability/i }).click();

    await expect(page.getByText('Casey Morgan').first()).toBeVisible({ timeout: 15000 });

    // Trash icon is hover-revealed — hover the employee row before clicking.
    const employeeRow = page.locator('tr', { has: page.getByText('Casey Morgan') });
    await expect(employeeRow).toBeVisible({ timeout: 10000 });
    await employeeRow.hover();
    const deleteButton = employeeRow.getByRole('button', { name: /delete casey morgan's .* availability/i });
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Guardrail dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Delete this block?')).toBeVisible();
    await expect(dialog.getByText('High impact')).toBeVisible();
    await expect(dialog.getByText(/guardrail/i)).toBeVisible();
    await expect(dialog.getByText(/Casey Morgan told you they can't work/)).toBeVisible();

    const confirmButton = dialog.getByRole('button', { name: 'Delete block', exact: true });
    const ackCheckbox = dialog.getByRole('checkbox', {
      name: /I understand shifts can be booked during a time Casey Morgan marked off\./,
    });
    await expect(ackCheckbox).toBeVisible();

    // Confirm is gated on the ack until it's checked.
    await expect(confirmButton).toBeDisabled();
    await ackCheckbox.click();
    await expect(confirmButton).toBeEnabled();

    await confirmButton.click();

    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Row reverts to the "no availability" empty state for Casey Morgan.
    await expect(employeeRow.getByText(/no availability set/i)).toBeVisible({ timeout: 10000 });

    const remaining = await page.evaluate(async (args: { restId: string; employeeId: string }) => {
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('employee_availability')
        .select('id')
        .eq('restaurant_id', args.restId)
        .eq('employee_id', args.employeeId);
      return data?.length ?? -1;
    }, { restId: restaurantId as string, employeeId: caseyId });

    expect(remaining).toBe(0);
  });
});
