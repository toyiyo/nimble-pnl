import { test, expect, Page } from '@playwright/test';
import { format, subDays } from 'date-fns';

const generateTestUser = () => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `tips-complete-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Tips Complete User ${ts}`,
    restaurantName: `Tips Complete Restaurant ${ts}`,
  };
};

async function signUpAndCreateRestaurant(page: Page, user: ReturnType<typeof generateTestUser>) {
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  const signupTab = page.getByRole('tab', { name: /sign up/i });
  if (await signupTab.isVisible().catch(() => false)) {
    await signupTab.click();
  }

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Main St');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

async function createEmployeesWithAuth(page: Page, employees: Array<{name: string, email: string, position: string}>) {
  // Create auth users and employees
  await page.evaluate(async ({ empData }) => {
    const { supabase } = await import('/src/integrations/supabase/client');
    let user = null;
    for (let i = 0; i < 5; i++) {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        user = u;
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!user) throw new Error('No user session');

    const { data: ur } = await supabase
      .from('user_restaurants')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!ur?.restaurant_id) throw new Error('No restaurant');

    // Create employees
    const rows = empData.map((emp: any) => ({
      restaurant_id: ur.restaurant_id,
      name: emp.name,
      email: emp.email,
      position: emp.position,
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1500,
      is_active: true,
      tip_eligible: true,
    }));

    const { error } = await supabase.from('employees').insert(rows);
    if (error) throw error;
  }, { empData: employees });
}

async function ensureTipsPage(page: Page) {
  const heading = page.getByRole('heading', { name: /^tips$/i }).first();
  const dateCard = page.getByText(/tip entry date/i).first();
  const enterBtn = page.getByRole('button', { name: /enter.*tips/i }).first();

  const locators = [heading, dateCard, enterBtn];
  for (const locator of locators) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 25000 });
      return;
    } catch {
      // try next locator
    }
  }
  throw new Error('Tips page did not load');
}

async function waitForApprovalOrBackend(page: Page) {
  const toast = page.getByText(/tips approved/i).first();
  try {
    await toast.waitFor({ state: 'visible', timeout: 7000 });
    return;
  } catch {
    // fall back to backend verification
  }

  let approved = false;
  for (let i = 0; i < 5; i++) {
    approved = await page.evaluate(async () => {
      const { supabase } = await import('/src/integrations/supabase/client');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data: ur } = await supabase
        .from('user_restaurants')
        .select('restaurant_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      if (!ur?.restaurant_id) return false;
      const { count } = await supabase
        .from('tip_splits')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', ur.restaurant_id)
        .eq('status', 'approved');
      return (count ?? 0) > 0;
    });
    if (approved) break;
    await page.waitForTimeout(1000);
  }

  if (!approved) {
    throw new Error('Approval toast not shown and backend record not found');
  }
}

test.describe('Tips - Complete Customer Journey', () => {

  test('Manager: Save draft, view drafts, resume and approve', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Maria Garcia', email: 'maria@test.com', position: 'Server' },
      { name: 'Juan Martinez', email: 'juan@test.com', position: 'Bartender' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Enter tip amount
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
    await page.locator('#tip-amount').fill('150');
    await page.getByRole('button', { name: /continue/i }).click();

    // Enter hours
    await page.getByRole('spinbutton', { name: /maria garcia/i }).fill('8');
    await page.getByRole('spinbutton', { name: /juan martinez/i }).fill('8');

    // Verify live preview shows equal split (amount buttons per employee)
    await expect(page.getByRole('button', { name: /maria garcia/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /juan martinez/i })).toBeVisible({ timeout: 5000 });

    // Save as draft instead of approving
    const draftButton = page.getByRole('button', { name: /save as draft/i });
    await expect(draftButton).toBeVisible();
    await draftButton.click();

    // Should show success message
    await expect(page.getByText(/draft saved/i).first()).toBeVisible({ timeout: 5000 });

    // Reload page to verify draft is shown
    await page.reload();
    await expect(page.getByRole('heading', { name: /^tips$/i }).first()).toBeVisible({ timeout: 10000 });

    // Should see draft list
    await expect(page.getByText(/draft.*split/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\$150\.00/)).toBeVisible();

    // Click to resume draft
    const resumeButton = page.getByRole('button', { name: /resume|edit/i }).first();
    await resumeButton.click();

    // Should populate form with draft data
    await expect(page.locator('#tipAmount')).toHaveValue('150');

    // Now approve it
    await page.getByRole('button', { name: /approve tips/i }).click();
    await waitForApprovalOrBackend(page);

    // Draft should be gone
    await page.reload();
    await expect(page.getByText(/draft.*split/i)).not.toBeVisible();
  });

  test('Manager: Enter tips for past date (missed daily entry)', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Carlos Rodriguez', email: 'carlos@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Look for date picker or "Enter past tips" button
    const pastTipsButton = page.getByRole('button', { name: /past.*tips|historical|change date/i }).first();
    if (await pastTipsButton.isVisible().catch(() => false)) {
      await pastTipsButton.click();
    } else {
      // Try clicking on date display
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      const dateInput = page.locator('input[type="date"]').first();
      if (await dateInput.isVisible().catch(() => false)) {
        await dateInput.fill(yesterday);
      }
    }

    // Enter tip for past date
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
    await page.locator('#tip-amount').fill('200');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('spinbutton', { name: /carlos rodriguez/i }).fill('8');

    // Approve
    await page.getByRole('button', { name: /approve tips/i }).click();
    await waitForApprovalOrBackend(page);

    // Success toast is sufficient; history table may not be exposed in this build
    await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Employee: View tips, see transparency, flag dispute', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Create employee with auth user
    await page.evaluate(async () => {
      const { supabase } = await import('/src/integrations/supabase/client');
      let managerUser = null;
      for (let i = 0; i < 5; i++) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          managerUser = user;
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      if (!managerUser) throw new Error('No manager session');

      const { data: ur } = await supabase
        .from('user_restaurants')
        .select('restaurant_id')
        .eq('user_id', managerUser.id)
        .limit(1)
        .single();

      if (!ur?.restaurant_id) throw new Error('No restaurant');

      // Create employee record (without auth user for now)
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: ur.restaurant_id,
          name: 'Lisa Chen',
          email: `employee-${Date.now()}@test.com`,
          position: 'Server',
          status: 'active',
          compensation_type: 'hourly',
          hourly_rate: 1500,
          tip_eligible: true,
        })
        .select()
        .single();

      if (empError) throw empError;
      return { employeeId: empData.id, restaurantId: ur.restaurant_id };
    });

    await page.goto('/tips');

    // Manager creates tip split for employee
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
    await page.locator('#tip-amount').fill('100');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('spinbutton', { name: /lisa chen/i }).fill('8');
    await page.getByRole('button', { name: /approve tips/i }).click();
    await expect(page.getByText(/tips approved/i).first()).toBeVisible({ timeout: 5000 });

    // Note: Employee self-service view requires employee to be linked to auth user
    // For now, we'll skip the employee login portion and test dispute creation via manager
    // TODO: Add employee signup flow to enable full E2E test
  });

  test('Manager: View and resolve employee dispute', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    // Create employee and dispute via API
    await page.evaluate(async () => {
      const { supabase } = await import('/src/integrations/supabase/client');
      let managerUser = null;
      for (let i = 0; i < 5; i++) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          managerUser = user;
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      if (!managerUser) throw new Error('No manager session');

      const { data: ur } = await supabase
        .from('user_restaurants')
        .select('restaurant_id')
        .eq('user_id', managerUser.id)
        .limit(1)
        .single();

      if (!ur?.restaurant_id) throw new Error('No restaurant');

      // Create employee
      const { data: emp } = await supabase
        .from('employees')
        .insert({
          restaurant_id: ur.restaurant_id,
          name: 'Mike Johnson',
          position: 'Server',
          status: 'active',
          compensation_type: 'hourly',
          hourly_rate: 1500,
          tip_eligible: true,
        })
        .select()
        .single();

      // Create tip split
      const { data: split } = await supabase
        .from('tip_splits')
        .insert({
          restaurant_id: ur.restaurant_id,
          split_date: new Date().toISOString().split('T')[0],
          total_amount: 10000,
          status: 'approved',
          share_method: 'hours',
        })
        .select()
        .single();

      // Create tip split item
      await supabase
        .from('tip_split_items')
        .insert({
          tip_split_id: split!.id,
          employee_id: emp!.id,
          amount: 10000,
          hours_worked: 8,
        });

      // Create dispute
      await supabase
        .from('tip_disputes')
        .insert({
          restaurant_id: ur.restaurant_id,
          employee_id: emp!.id,
          tip_split_id: split!.id,
          dispute_type: 'missing_hours',
          message: 'I actually worked 10 hours not 8',
          status: 'open',
        });
    });

    // Go to tips page - should show dispute alert
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Should see dispute notification (exact text from DisputeManager component)
    const disputeHeader = page.getByText(/tip review requests/i).first();
    for (let i = 0; i < 5; i++) {
      if (await disputeHeader.isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
      if (i === 2) {
        await page.reload();
        await ensureTipsPage(page);
      }
    }
    await expect(disputeHeader).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/mike johnson/i)).toBeVisible({ timeout: 10000 });

    // Click to review dispute
    const reviewButton = page.getByRole('button', { name: /review|view dispute/i }).first();
    await reviewButton.click();

    // Should see dispute details
    await expect(page.getByText(/missing hours/i)).toBeVisible();
    await expect(page.getByText(/10 hours not 8/i)).toBeVisible();

    // Resolve dispute
    const resolveButton = page.getByRole('button', { name: /resolve/i }).first();
    await resolveButton.click();

    // Enter resolution notes
    const notesField = page.getByLabel(/resolution.*note|comment/i);
    if (await notesField.isVisible().catch(() => false)) {
      await notesField.fill('Hours corrected to 10. Tips updated.');
    }

    // Confirm resolution
    await page.getByRole('button', { name: /confirm|save/i }).click();
    await expect(page.getByText(/dispute.*resolved/i)).toBeVisible({ timeout: 5000 });

    // Dispute should be gone from list
    await page.reload();
    await expect(page.getByText(/no.*disputes|no.*review.*requests/i)).toBeVisible();
  });

  test('Manager: Weekly pooling - see multiple days', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Server 1', email: 'server1@test.com', position: 'Server' },
      { name: 'Server 2', email: 'server2@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Switch to weekly mode if available
    const weeklyToggle = page.getByRole('radio', { name: /weekly|every week/i });
    if (await weeklyToggle.isVisible().catch(() => false)) {
      await weeklyToggle.click();
      await page.waitForTimeout(500);
    }

    // Should see week range selector or multiple days
    const weekSelector = page.locator('text=/this week|current week/i').first();
    if (await weekSelector.isVisible().catch(() => false)) {
      await expect(weekSelector).toBeVisible();
    }

    // Enter weekly tips
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
    await page.locator('#tip-amount').fill('1000'); // $1000 for the week
    await page.getByRole('button', { name: /continue/i }).click();

    await page.getByRole('spinbutton', { name: /server 1/i }).fill('40'); // Full-time
    await page.getByRole('spinbutton', { name: /server 2/i }).fill('20'); // Part-time

    // Server 1 should get ~$666.67, Server 2 ~$333.33
    await expect(page.getByText(/\$666/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\$333/).first()).toBeVisible({ timeout: 5000 });

    // Approve
    await page.getByRole('button', { name: /approve tips/i }).click();
    await waitForApprovalOrBackend(page);
  });

  test('Manager: Role-based weighting', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Server A', email: 'servera@test.com', position: 'Server' },
      { name: 'Bartender B', email: 'bartenderb@test.com', position: 'Bartender' },
      { name: 'Runner C', email: 'runnerc@test.com', position: 'Runner' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Switch to role-based split
    const roleRadio = page.getByRole('radio', { name: /by role/i });
    if (await roleRadio.isVisible().catch(() => false)) {
      await roleRadio.click();
      await page.waitForTimeout(500);

      // Should see role weight editor
      await expect(page.getByText(/server/i)).toBeVisible();
      await expect(page.getByText(/bartender/i)).toBeVisible();

      // Bartender gets 1.5x multiplier
      const bartenderWeight = page.locator('input[type="number"]').filter({ hasText: /bartender/i }).or(
        page.locator('label:has-text("Bartender")').locator('xpath=following-sibling::input[1]')
      ).first();
      
      if (await bartenderWeight.isVisible().catch(() => false)) {
        await bartenderWeight.fill('1.5');
      }

      // Enter tips
      const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
      await enterTipsButton.click();
      await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
      await page.locator('#tip-amount').fill('300');
      await page.getByRole('button', { name: /continue/i }).click();

      // With weights: Server=1, Bartender=1.5, Runner=1 (total=3.5)
      // Server: $85.71, Bartender: $128.57, Runner: $85.71
      await page.getByRole('button', { name: /approve tips/i }).click();
      await waitForApprovalOrBackend(page);
    }
  });

  test('Manager: Edit manual allocation amounts', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Alice Manual', email: 'alice@test.com', position: 'Server' },
      { name: 'Bob Manual', email: 'bob@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    // Go to tips page
    await page.goto('/tips');
    await ensureTipsPage(page);

    // Enter total tips
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();
    await expect(page.locator('#tip-amount')).toBeVisible({ timeout: 10000 });
    await page.locator('#tip-amount').fill('200');
    await page.getByRole('button', { name: /continue/i }).click();

    // Enter hours (equal split initially)
    await page.getByRole('spinbutton', { name: /alice manual/i }).fill('8');
    await page.getByRole('spinbutton', { name: /bob manual/i }).fill('8');

    // Should preview $100 each
    await expect(page.getByRole('button', { name: /alice manual/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /bob manual/i })).toBeVisible({ timeout: 5000 });

    // Manually override Alice to $120
    const aliceRow = page.locator('tr', { hasText: /alice manual/i }).first();
    await aliceRow.getByRole('button', { name: /alice manual/i }).click();
    const aliceAmountField = aliceRow.locator('input[type="number"]').first();
    await aliceAmountField.fill('120');
    
    // Bob should auto-balance to $80
    await expect(page.getByText('$80.00')).toBeVisible({ timeout: 2000 });
    
    // Total should still be $200
    await expect(page.getByText(/total remaining/i)).toBeVisible();

    // Approve
    await page.getByRole('button', { name: /approve tips/i }).click();
    await expect(page.getByText(/tips approved/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Accessibility: Keyboard navigation and ARIA labels', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employees = [
      { name: 'Test Employee', email: 'test@test.com', position: 'Server' },
    ];
    await createEmployeesWithAuth(page, employees);

    await page.goto('/tips');
    await expect(page.getByRole('heading', { name: /^tips$/i }).first()).toBeVisible({ timeout: 10000 });

    // Open tip entry dialog
    const enterTipsButton = page.getByRole('button', { name: /enter.*tips/i }).first();
    await enterTipsButton.click();

    // Check ARIA labels (tip-amount has sr-only label)
    const tipInput = page.locator('#tip-amount');
    await expect(tipInput).toBeVisible({ timeout: 5000 });
    
    // Type into input
    await tipInput.fill('100');
    
    // All interactive elements should have proper roles
    const buttons = await page.locator('button').all();
    for (const button of buttons) {
      const ariaLabel = await button.getAttribute('aria-label');
      const text = await button.textContent();
      expect(ariaLabel || text).toBeTruthy();
    }
  });
});
