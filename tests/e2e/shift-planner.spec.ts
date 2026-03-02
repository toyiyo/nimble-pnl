import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Shift Planner v2 (Template-First)', () => {
  test('creates shift template and displays in grid', async ({ page }) => {
    const testUser = generateTestUser('planner-v2');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed employees
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Should see empty template state
    await expect(page.getByText('No shift templates yet')).toBeVisible({ timeout: 10000 });

    // Should see employees in sidebar
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Bob Smith')).toBeVisible({ timeout: 5000 });

    // Click "Add Shift Template"
    await page.getByRole('button', { name: /add shift template/i }).click();

    // Fill template dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Fill name
    await dialog.locator('#template-name').fill('Morning');

    // Fill times
    await dialog.locator('#start-time').fill('06:00');
    await dialog.locator('#end-time').fill('12:00');

    // Fill position
    await dialog.locator('#position').fill('Server');

    // Select weekdays (Mon-Fri) — click day toggle buttons by their aria-labels
    await dialog.getByRole('button', { name: 'Monday' }).click();
    await dialog.getByRole('button', { name: 'Tuesday' }).click();
    await dialog.getByRole('button', { name: 'Wednesday' }).click();
    await dialog.getByRole('button', { name: 'Thursday' }).click();
    await dialog.getByRole('button', { name: 'Friday' }).click();

    // Set up response listener for template creation
    const templateCreatePromise = page.waitForResponse(
      resp => resp.url().includes('rest/v1/shift_templates') && resp.status() === 201,
      { timeout: 15000 },
    );

    // Submit
    await dialog.getByRole('button', { name: /add template/i }).click();

    // Wait for creation
    await templateCreatePromise;

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Template should appear in grid
    await expect(page.getByText('Morning')).toBeVisible({ timeout: 5000 });
    // Time range should show (compact format like "6a-12p")
    await expect(page.getByText(/6a.*12p/)).toBeVisible({ timeout: 5000 });
  });

  test('week navigation changes displayed dates', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-nav');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    // Seed an employee (needed to not hit empty-employees state)
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Charlie Brown', position: 'Host', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1200 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for planner to render (employees sidebar or empty template state)
    await expect(page.getByText('Charlie Brown')).toBeVisible({ timeout: 10000 });

    // Capture current date range
    const dateRange = page.locator('.text-\\[15px\\].font-semibold');
    await expect(dateRange).toBeVisible();
    const initialText = await dateRange.textContent();
    expect(initialText).toBeTruthy();

    // Navigate next week
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(dateRange).not.toHaveText(initialText!, { timeout: 5000 });

    const nextWeekText = await dateRange.textContent();

    // Navigate back
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(dateRange).toHaveText(initialText!, { timeout: 5000 });

    expect(nextWeekText).not.toBe(initialText);
  });

  test('empty state shows when no employees exist', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-empty');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Should show no-employees empty state
    await expect(page.getByText('No employees found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/add employees to start building/i)).toBeVisible();
  });

  test('sidebar search filters employees by name', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-search');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
          { name: 'Carol Davis', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // All three employees should be visible
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Bob Smith')).toBeVisible();
    await expect(page.getByText('Carol Davis')).toBeVisible();

    // Search for "alice"
    const searchInput = page.getByLabel('Search employees');
    await searchInput.fill('alice');

    // Only Alice should be visible
    await expect(page.getByText('Alice Johnson')).toBeVisible();
    await expect(page.getByText('Bob Smith')).not.toBeVisible();
    await expect(page.getByText('Carol Davis')).not.toBeVisible();

    // Clear search
    await searchInput.clear();

    // All employees should be visible again
    await expect(page.getByText('Alice Johnson')).toBeVisible();
    await expect(page.getByText('Bob Smith')).toBeVisible();
    await expect(page.getByText('Carol Davis')).toBeVisible();
  });

  test('sidebar role filter narrows employee list', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-filter');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
          { name: 'Carol Davis', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for employees to load
    await expect(page.getByText('Alice Johnson')).toBeVisible({ timeout: 10000 });

    // Open role filter dropdown
    const filterTrigger = page.getByLabel('Filter by role');
    await expect(filterTrigger).toBeVisible();
    await filterTrigger.click();

    // Select "Cook" role
    await page.getByRole('option', { name: 'Cook' }).click();

    // Only Bob (Cook) should be visible
    await expect(page.getByText('Bob Smith')).toBeVisible();
    await expect(page.getByText('Alice Johnson')).not.toBeVisible();
    await expect(page.getByText('Carol Davis')).not.toBeVisible();

    // Reset to "All roles"
    await filterTrigger.click();
    await page.getByRole('option', { name: 'All roles' }).click();

    // All employees should be visible again
    await expect(page.getByText('Alice Johnson')).toBeVisible();
    await expect(page.getByText('Bob Smith')).toBeVisible();
    await expect(page.getByText('Carol Davis')).toBeVisible();
  });

  test('assigned employee renders as chip in grid cell', async ({ page }) => {
    const testUser = generateTestUser('planner-v2-chip');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    // Seed employees
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    // Seed a template + shift for Alice via Supabase
    // Use explicit UTC timestamps so grid matching works (template time = shift time extraction)
    const seedResult = await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as any).__supabase;

        // Compute Monday of the current week (local date)
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now);
        mon.setDate(mon.getDate() + diff);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const monStr = `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`;

        return (async () => {
          // Insert template (all 7 days active)
          const { data: tmpl, error: tmplErr } = await supabase
            .from('shift_templates')
            .insert({
              restaurant_id: restId,
              name: 'Morning',
              start_time: '06:00:00',
              end_time: '12:00:00',
              position: 'Server',
              days: [0, 1, 2, 3, 4, 5, 6],
              break_duration: 0,
              is_active: true,
            })
            .select()
            .single();

          if (tmplErr) return { error: `template: ${tmplErr.message}` };

          // Insert shift using explicit UTC timestamps
          // buildTemplateGridData extracts HH:MM:SS from the T-split, so the UTC time
          // must match the template's start_time/end_time for proper grid placement
          const { error: shiftErr } = await supabase.from('shifts').insert({
            restaurant_id: restId,
            employee_id: empId,
            start_time: `${monStr}T06:00:00+00:00`,
            end_time: `${monStr}T12:00:00+00:00`,
            position: 'Server',
            status: 'scheduled',
            break_duration: 0,
            is_published: false,
            locked: false,
          });

          if (shiftErr) return { error: `shift: ${shiftErr.message}` };
          return { monStr, templateId: tmpl.id };
        })();
      },
      { restId: restaurantId, empId: (employees as any).find((e: any) => e.name === 'Alice Johnson').id },
    );

    if ((seedResult as any).error) {
      throw new Error(`Seed failed: ${(seedResult as any).error}`);
    }

    // Navigate to scheduling page
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Template should appear in grid
    await expect(page.getByText('Morning')).toBeVisible({ timeout: 10000 });

    // Alice's employee chip should render in the grid cell
    // EmployeeChip displays the name and a remove button with aria-label
    await expect(
      page.getByRole('button', { name: /remove alice johnson from shift/i }),
    ).toBeVisible({ timeout: 10000 });

    // Bob should NOT appear in the grid (no shift assigned)
    await expect(
      page.getByRole('button', { name: /remove bob smith from shift/i }),
    ).not.toBeVisible();

    // But Bob should be in the sidebar
    await expect(page.getByText('Bob Smith')).toBeVisible();
  });
});
