import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getAdminSupabaseClient } from '../../helpers/supabase';

test.describe('Time Punches - force clock out', () => {
  let ownerId: string;
  let restaurantId: string;
  let employeeId: string;
  const testEmail = `tco-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    const user = await createTestUser(testEmail, testPassword, 'Force Clockout Owner');
    ownerId = user.id;
    restaurantId = await createTestRestaurant(ownerId, 'ForceClockOut Restaurant');

    const admin = getAdminSupabaseClient();

    // Create an employee manually
    const { data: employee } = await admin
      .from('employees')
      .insert({ restaurant_id: restaurantId, name: 'Force Employee' })
      .select()
      .single();

    employeeId = employee.id;

    // Create an incomplete punch (clock_in only)
    await admin.from('time_punches').insert({
      restaurant_id: restaurantId,
      employee_id: employeeId,
      punch_type: 'clock_in',
      punch_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      created_by: ownerId
    });
  });

  test.afterAll(async () => {
    const admin = getAdminSupabaseClient();
    // cleanup inserts: delete time punches and employees
    await admin.from('time_punches').delete().eq('employee_id', employeeId);
    await admin.from('employees').delete().eq('id', employeeId);

    await cleanupTestUser(ownerId);
  });

  test('manager/owner can force clock out incomplete sessions', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/', { timeout: 10000 });

    // Go to time punches
    await page.goto('/time-punches');
    await page.waitForLoadState('networkidle');

    // Wait for the Open / Incomplete Sessions card to appear
    await page.waitForSelector('text=Open / Incomplete Sessions');

    // Ensure the employee name is listed
    await expect(page.locator('text=Force Employee')).toBeVisible();

    // Click force clock out (open dialog)
    await page.click('button:has-text("Force Clock Out Now")');

    // Confirm the dialog appears
    await page.waitForSelector('text=Force Clock Out');

    // Fill a custom date/time for the clock out (30 minutes after clock-in)
    const chosen = new Date(Date.now() - 30 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localValue = `${chosen.getFullYear()}-${pad(chosen.getMonth()+1)}-${pad(chosen.getDate())}T${pad(chosen.getHours())}:${pad(chosen.getMinutes())}`;
    await page.fill('input[id="force_out_time"]', localValue);

    // Confirm the dialog
    await page.click('button:has-text("Force Clock Out"):visible');

    // Give mutation time to complete
    await page.waitForTimeout(1000);

    // Verify via admin client that a clock_out was created
    const admin = getAdminSupabaseClient();
    const { data: punches } = await admin
      .from('time_punches')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('punch_type', 'clock_out');

    expect(punches.length).toBeGreaterThan(0);
  });
});
