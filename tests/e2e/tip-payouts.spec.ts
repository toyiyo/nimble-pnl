import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

interface WindowWithHelpers extends Window {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId: string) => Promise<string | null>;
  __insertEmployees: (rows: unknown[], restaurantId: string) => Promise<unknown[]>;
  __checkApprovedSplits: (restaurantId: string) => Promise<boolean>;
}

async function createEmployeesWithAuth(page: Page, employees: Array<{name: string, email: string, position: string}>) {
  await exposeSupabaseHelpers(page);

  await page.evaluate(async ({ empData }) => {
    const win = window as unknown as WindowWithHelpers;
    const user = await win.__getAuthUser();
    if (!user?.id) throw new Error('No user session');

    const restaurantId = await win.__getRestaurantId(user.id);
    if (!restaurantId) throw new Error('No restaurant');

    const rows = empData.map((emp: { name: string; email: string; position: string }) => ({
      name: emp.name,
      email: emp.email,
      position: emp.position,
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1500,
      is_active: true,
      tip_eligible: true,
    }));

    await win.__insertEmployees(rows, restaurantId);
  }, { empData: employees });
}

async function ensureTipsPage(page: Page) {
  const heading = page.getByRole('heading', { name: /^tips$/i }).first();
  await heading.waitFor({ state: 'visible', timeout: 25000 });
}

async function switchToDailyEntryMode(page: Page) {
  const dailyEntryButton = page.getByRole('button', { name: /daily entry/i });
  await expect(dailyEntryButton).toBeVisible({ timeout: 5000 });
  await dailyEntryButton.click();
  const enterBtn = page.getByRole('button', { name: /enter.*tips/i }).first();
  await expect(enterBtn).toBeVisible({ timeout: 5000 });
}

async function enterAndApproveTips(page: Page, amount: string, employees: Array<{name: string, hours: string}>) {
  const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
  await enterTipsButton.click();
  await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 12000 });
  await page.locator('#tip-amount').fill(amount);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.locator('#tip-amount')).not.toBeVisible({ timeout: 5000 });

  for (const emp of employees) {
    await page.getByRole('spinbutton', { name: new RegExp(emp.name, 'i') }).fill(emp.hours);
  }

  await page.getByRole('button', { name: /approve tips/i }).click();

  // Wait for approval
  const toast = page.getByText(/tips approved/i).first();
  try {
    await toast.waitFor({ state: 'visible', timeout: 7000 });
  } catch {
    // Fall back to backend verification
    await exposeSupabaseHelpers(page);
    let approved = false;
    for (let i = 0; i < 5; i++) {
      approved = await page.evaluate(async () => {
        const win = window as unknown as WindowWithHelpers;
        const user = await win.__getAuthUser();
        if (!user?.id) return false;
        const restaurantId = await win.__getRestaurantId(user.id);
        if (!restaurantId) return false;
        return await win.__checkApprovedSplits(restaurantId);
      });
      if (approved) break;
      await page.waitForTimeout(500);
    }
    if (!approved) throw new Error('Tip approval not confirmed');
  }
}

test.describe('Tip Payouts - Manager Journey', () => {
  test.describe.configure({ mode: 'serial' });

  test('Manager: Record tip payouts from timeline', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Sarah Miller', email: 'sarah@test.com', position: 'Server' },
      { name: 'Tom Wilson', email: 'tom@test.com', position: 'Bartender' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page and enter/approve tips
    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '200', [
      { name: 'Sarah Miller', hours: '8' },
      { name: 'Tom Wilson', hours: '8' },
    ]);

    // Navigate to Overview to see the timeline
    await page.goto('/tips');
    await ensureTipsPage(page);

    // The overview mode shows the TipPeriodTimeline
    // Find the "Pay out" button on the timeline for today's approved split
    // The button has aria-label="Record payout for <date>" (payout as one word)
    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();

    // TipPayoutSheet should open
    const sheetTitle = page.getByText(/record tip payouts/i);
    await expect(sheetTitle).toBeVisible({ timeout: 5000 });

    // Verify both employees are listed with correct allocations
    await expect(page.getByText('Sarah Miller')).toBeVisible();
    await expect(page.getByText('Tom Wilson')).toBeVisible();
    // $200 split equally = $100 each
    await expect(page.getByText('Allocated: $100.00').first()).toBeVisible();

    // Verify total payout shows the full amount
    await expect(page.getByText('Total Payout')).toBeVisible();
    await expect(page.getByText('$200.00').first()).toBeVisible();

    // Click Confirm to record payouts
    const confirmButton = page.getByRole('button', { name: /confirm/i });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Sheet should close
    await expect(sheetTitle).not.toBeVisible({ timeout: 5000 });

    // Wait for toast or "Paid" badge to confirm success
    try {
      await page.getByText(/payouts recorded/i).first().waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      // Toast may have already dismissed; check "Paid" badge instead
    }

    // Timeline should now show "Paid" badge
    await expect(page.getByText('Paid').first()).toBeVisible({ timeout: 8000 });

    // "Pay out" button should no longer be visible for this day (fully paid)
    // Wait a moment for UI to re-render
    await page.waitForTimeout(500);
    const payOutButtons = page.getByRole('button', { name: /record payout/i });
    const count = await payOutButtons.count();
    // There should be no "Pay out" buttons for fully-paid days
    // (other days may still show it if they have approved splits)
    expect(count).toBe(0);
  });

  test('Manager: Partial payout shows correct badge', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Anna Smith', email: 'anna@test.com', position: 'Server' },
      { name: 'Bob Jones', email: 'bob@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Enter and approve tips
    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '200', [
      { name: 'Anna Smith', hours: '8' },
      { name: 'Bob Jones', hours: '8' },
    ]);

    // Seed a partial payout directly via Supabase (only Anna, $100 of $200 total)
    await exposeSupabaseHelpers(page);
    await page.evaluate(async () => {
      const win = window as unknown as WindowWithHelpers;
      const authUser = await win.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');
      const restaurantId = await win.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const supabase = (window as any).__supabase;

      // Get the approved split
      const { data: splits } = await supabase
        .from('tip_splits')
        .select('id, split_date, total_amount, tip_split_items(employee_id, amount)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved')
        .limit(1)
        .single();

      if (!splits) throw new Error('No approved split found');

      // Get Anna's employee_id from split items (pick the first one)
      const annaItem = splits.tip_split_items[0];
      if (!annaItem) throw new Error('No split item found');

      // Insert a partial payout (only Anna's share = $100 of $200 total)
      const { error } = await supabase
        .from('tip_payouts')
        .insert({
          restaurant_id: restaurantId,
          employee_id: annaItem.employee_id,
          payout_date: splits.split_date,
          amount: annaItem.amount, // 10000 cents = $100 (half of $200)
          tip_split_id: splits.id,
          paid_by: authUser.id,
        });

      if (error) throw new Error(`Failed to insert payout: ${error.message}`);
    });

    // Navigate to overview to see the timeline with partial badge
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Timeline should show "Partial" badge (only 1 of 2 employees paid)
    await expect(page.getByText('Partial').first()).toBeVisible({ timeout: 10000 });

    // "Pay out" button should still be visible (partially paid)
    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 3000 });
  });

  test('Manager: Payout sheet shows correct employee data', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Dave Clark', email: 'dave@test.com', position: 'Server' },
      { name: 'Eve Adams', email: 'eve@test.com', position: 'Bartender' },
    ];
    await createEmployeesWithAuth(page, employees);

    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '300', [
      { name: 'Dave Clark', hours: '6' },
      { name: 'Eve Adams', hours: '6' },
    ]);

    await page.goto('/tips');
    await ensureTipsPage(page);

    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();

    await expect(page.getByText(/record tip payouts/i)).toBeVisible({ timeout: 5000 });

    // Verify both employees are listed
    await expect(page.getByText('Dave Clark')).toBeVisible();
    await expect(page.getByText('Eve Adams')).toBeVisible();

    // Each gets $150 ($300 / 2 employees with equal hours)
    await expect(page.getByText('Allocated: $150.00').first()).toBeVisible();

    // Verify toggle switches exist for each employee
    await expect(page.getByRole('switch', { name: /toggle payout for dave clark/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /toggle payout for eve adams/i })).toBeVisible();

    // Verify Cash Paid inputs are visible (employees enabled by default)
    await expect(page.getByLabel(/cash paid to dave clark/i)).toBeVisible();
    await expect(page.getByLabel(/cash paid to eve adams/i)).toBeVisible();

    // Total Payout should show $300.00
    await expect(page.getByText('Total Payout')).toBeVisible();

    // Confirm button should be enabled
    await expect(page.getByRole('button', { name: /confirm/i })).toBeEnabled();

    // Cancel without saving
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/record tip payouts/i)).not.toBeVisible({ timeout: 3000 });
  });

  test('Manager: Payroll reflects tips paid out', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Eva Green', email: 'eva@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Enter and approve tips
    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '150', [
      { name: 'Eva Green', hours: '8' },
    ]);

    // Record payout
    await page.goto('/tips');
    await ensureTipsPage(page);

    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();
    await expect(page.getByText(/record tip payouts/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /confirm/i }).click();
    // Wait for payout to be saved (toast may dismiss quickly)
    try {
      await page.getByText(/payouts recorded/i).first().waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      // Toast may have dismissed; payout still saved
    }
    await page.waitForTimeout(500);

    // Navigate to Payroll page
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: /payroll/i }).first()).toBeVisible({ timeout: 15000 });

    // Verify the three tip columns exist
    await expect(page.getByText('Tips Earned').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Tips Paid').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Tips Owed').first()).toBeVisible({ timeout: 5000 });

    // Eva's tips: $150 earned, $150 paid, $0 owed
    // Look for the employee row
    await expect(page.getByText('Eva Green').first()).toBeVisible({ timeout: 10000 });

    // Find the $150.00 values (Tips Earned and Tips Paid should both show $150.00)
    const tipAmounts = page.getByText('$150.00');
    const tipCount = await tipAmounts.count();
    // At least 2 instances: Tips Earned and Tips Paid columns
    expect(tipCount).toBeGreaterThanOrEqual(2);

    // Tips Owed should show $0.00 for this employee
    await expect(page.getByText('$0.00').first()).toBeVisible({ timeout: 5000 });
  });

  test('Manager: Cancel payout sheet without saving', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Frank White', email: 'frank@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '100', [
      { name: 'Frank White', hours: '8' },
    ]);

    await page.goto('/tips');
    await ensureTipsPage(page);

    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();
    await expect(page.getByText(/record tip payouts/i)).toBeVisible({ timeout: 5000 });

    // Cancel without saving
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/record tip payouts/i)).not.toBeVisible({ timeout: 3000 });

    // "Pay out" button should still be visible (nothing was saved)
    await expect(page.getByRole('button', { name: /record payout/i }).first()).toBeVisible({ timeout: 3000 });

    // No "Paid" or "Partial" badge should appear on day cells
    // (use exact match to avoid matching "Paid Out" in the legend)
    const paidBadge = page.getByText('Paid', { exact: true });
    const partialBadge = page.getByText('Partial', { exact: true });
    expect(await paidBadge.count()).toBe(0);
    expect(await partialBadge.count()).toBe(0);
  });

  test('Manager: Select All / Deselect All toggle', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Grace Lee', email: 'grace@test.com', position: 'Server' },
      { name: 'Henry Kim', email: 'henry@test.com', position: 'Bartender' },
    ];
    await createEmployeesWithAuth(page, employees);

    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '200', [
      { name: 'Grace Lee', hours: '8' },
      { name: 'Henry Kim', hours: '8' },
    ]);

    await page.goto('/tips');
    await ensureTipsPage(page);

    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();
    await expect(page.getByText(/record tip payouts/i)).toBeVisible({ timeout: 5000 });

    // All employees should be selected by default (new payouts)
    // Click "Deselect All"
    const deselectAllBtn = page.getByRole('button', { name: /deselect all/i });
    await expect(deselectAllBtn).toBeVisible();
    await deselectAllBtn.click();

    // Total should drop to $0.00 and Confirm should be disabled
    await expect(page.getByText('$0.00').first()).toBeVisible({ timeout: 3000 });
    const confirmBtn = page.getByRole('button', { name: /confirm/i });
    await expect(confirmBtn).toBeDisabled();

    // Click "Select All" to re-enable all
    const selectAllBtn = page.getByRole('button', { name: /select all/i });
    await expect(selectAllBtn).toBeVisible();
    await selectAllBtn.click();

    // Total should return to $200.00
    await expect(page.getByText('$200.00').first()).toBeVisible({ timeout: 3000 });
    await expect(confirmBtn).toBeEnabled();

    // Cancel to clean up
    await page.getByRole('button', { name: /cancel/i }).click();
  });
});

test.describe('Tip Payouts - Employee Tips View', () => {
  test('Employee tips page shows paid badge after payout', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Create employee linked to the current auth user
    await exposeSupabaseHelpers(page);
    const setupResult = await page.evaluate(async () => {
      const win = window as unknown as WindowWithHelpers;
      const authUser = await win.__getAuthUser();
      if (!authUser?.id) throw new Error('No user session');
      const restaurantId = await win.__getRestaurantId(authUser.id);
      if (!restaurantId) throw new Error('No restaurant');

      const employees = [{
        name: 'My Employee',
        email: `emp-${Date.now()}@test.com`,
        position: 'Server',
        status: 'active',
        compensation_type: 'hourly',
        hourly_rate: 1500,
        tip_eligible: true,
        user_id: authUser.id, // Link to current auth user so employee-tips page works
      }];

      const result = await win.__insertEmployees(employees, restaurantId) as Array<{ id: string }>;
      return { employeeId: result[0].id, restaurantId };
    });

    if (!setupResult) return;

    // Enter and approve tips as manager
    await page.goto('/tips');
    await ensureTipsPage(page);
    await switchToDailyEntryMode(page);
    await enterAndApproveTips(page, '120', [
      { name: 'My Employee', hours: '8' },
    ]);

    // Record payout
    await page.goto('/tips');
    await ensureTipsPage(page);

    const payOutButton = page.getByRole('button', { name: /record payout/i }).first();
    await expect(payOutButton).toBeVisible({ timeout: 10000 });
    await payOutButton.click();
    await expect(page.getByText(/record tip payouts/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /confirm/i }).click();
    // Wait for payout to be saved (toast may dismiss quickly)
    try {
      await page.getByText(/payouts recorded/i).first().waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      // Toast may have dismissed; payout still saved
    }
    await page.waitForTimeout(500);

    // Navigate to Employee Tips page (route is /employee/tips)
    await page.goto('/employee/tips');
    await expect(page.getByRole('heading', { name: /my tips/i }).first()).toBeVisible({ timeout: 15000 });

    // Should show the "Paid $120.00 cash" badge on the breakdown
    await expect(page.getByText(/paid.*\$120\.00.*cash/i).first()).toBeVisible({ timeout: 10000 });
  });
});
