import { test, expect, Page } from '@playwright/test';

const generateTestUser = () => {
  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return {
    email: `tips-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Tips User ${ts}`,
    restaurantName: `Tips Restaurant ${ts}`,
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
  } else {
    const signupBtn = page.getByRole('button', { name: /sign up|create account|get started/i }).first();
    const signupLink = page.getByRole('link', { name: /sign up|create account|get started/i }).first();
    if (await signupBtn.isVisible().catch(() => false)) {
      await signupBtn.click();
    } else if (await signupLink.isVisible().catch(() => false)) {
      await signupLink.click();
    }
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
  await dialog.getByLabel(/address/i).fill('123 Tip Street');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  const cuisineSelect = dialog.getByRole('combobox').filter({ hasText: /select cuisine type/i });
  if (await cuisineSelect.isVisible().catch(() => false)) {
    await cuisineSelect.click();
    await page.getByRole('option', { name: /american/i }).click();
  }
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

async function createEmployeesViaAPI(page: Page, names: string[]) {
  await page.evaluate(async ({ employees }) => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user session');

    const { data: ur } = await supabase
      .from('user_restaurants')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!ur?.restaurant_id) throw new Error('No restaurant');

    const rows = employees.map((name: string, idx: number) => ({
      restaurant_id: ur.restaurant_id,
      name,
      position: 'Server',
      status: 'active',
      compensation_type: 'hourly',
      hourly_rate: 1200 + idx * 100,
      is_active: true,
      tip_eligible: true,
    }));

    const { error } = await supabase.from('employees').insert(rows);
    if (error) throw error;
  }, { employees: names });
}

test.describe('Tip pooling flow', () => {
  test('manual tips split by hours with live preview', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    const employeeNames = ['Alice Tips', 'Bob Tips'];
    await createEmployeesViaAPI(page, employeeNames);

    await page.goto('/tips');
    const tipsHeading = page.getByRole('heading', { name: /^tips$/i }).first();
    await expect(tipsHeading).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#tipAmount')).toBeVisible({ timeout: 15000 });

    await page.locator('#tipAmount').fill('100');
    await page.getByRole('spinbutton', { name: /alice tips/i }).fill('5');
    await page.getByRole('spinbutton', { name: /bob tips/i }).fill('3');

    await expect(page.getByText('$62.50')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$37.50')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/total remaining/i)).toBeVisible();

    await page.getByRole('button', { name: /approve tips/i }).click();
    await page.waitForTimeout(1000);

    // Verify persistence
    let tipRows: any[] = [];
    for (let i = 0; i < 5; i++) {
      tipRows = await page.evaluate(async () => {
        const { supabase } = await import('/src/integrations/supabase/client');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No session');
        const { data: ur } = await supabase
          .from('user_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();
        if (!ur?.restaurant_id) throw new Error('No restaurant');
        const { data, error } = await supabase
          .from('employee_tips')
          .select('*')
          .eq('restaurant_id', ur.restaurant_id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      });
      if (tipRows.length >= 2) break;
      await page.waitForTimeout(500);
    }

    expect(Array.isArray(tipRows)).toBe(true);
    expect(tipRows.length).toBeGreaterThanOrEqual(2);
    const sum = tipRows.slice(0, 2).reduce((s: number, row: any) => s + row.tip_amount, 0);
    expect(sum).toBe(10000);

    // History section shows entries
    await expect(page.getByText(/recent splits/i)).toBeVisible();
  });
});
