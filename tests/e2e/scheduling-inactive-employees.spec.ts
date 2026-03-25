import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Scheduling - Inactive Employee Visibility', () => {
  test('hides inactive employees without shifts from the schedule grid', async ({ page }) => {
    const testUser = generateTestUser('sched-inactive');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed 3 employees: 2 active, 1 inactive with no shifts
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Active Alice', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Active Bob', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
          { name: 'Inactive Carol', position: 'Server', status: 'inactive', is_active: false, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    // Seed a shift for Active Alice only (so Active Bob appears as active-without-shifts)
    const aliceId = await page.evaluate(
      ({ restId }) => {
        const supabase = (window as any).__supabase;
        return (async () => {
          const { data } = await supabase
            .from('employees')
            .select('id')
            .eq('restaurant_id', restId)
            .eq('name', 'Active Alice')
            .single();
          return data?.id;
        })();
      },
      { restId: restaurantId },
    );

    // Create shift for Alice on Monday of current week
    await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as any).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
        const end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();

        return (async () => {
          const { error } = await supabase.from('shifts').insert([{
            restaurant_id: restId,
            employee_id: empId,
            start_time: start,
            end_time: end,
            position: 'Server',
            status: 'scheduled',
            break_duration: 30,
            is_published: false,
            locked: false,
          }]);
          if (error) throw new Error(error.message);
        })();
      },
      { restId: restaurantId, empId: aliceId },
    );

    // Navigate to Scheduling page (Schedule tab is default)
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Wait for the grid to load — Alice should be visible
    await expect(page.getByText('Active Alice').first()).toBeVisible({ timeout: 10000 });

    // Active Bob should also be visible (active employees always shown even without shifts)
    await expect(page.getByText('Active Bob').first()).toBeVisible({ timeout: 5000 });

    // Inactive Carol should NOT be visible (inactive + no shifts this week)
    await expect(page.getByText('Inactive Carol')).not.toBeVisible();
  });

  test('shows inactive employees with shifts and displays Inactive badge', async ({ page }) => {
    const testUser = generateTestUser('sched-inactive-badge');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed 2 employees: 1 active, 1 inactive
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Active Alice', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Departing Dave', position: 'Cook', status: 'inactive', is_active: false, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    const daveId = (employees as any).find((e: any) => e.name === 'Departing Dave')?.id;
    if (!daveId) throw new Error('Could not find Departing Dave');

    // Seed a shift for Departing Dave (simulates 2-week notice: still has scheduled shifts)
    await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as any).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 9, 0, 0).toISOString();
        const end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 17, 0, 0).toISOString();

        return (async () => {
          const { error } = await supabase.from('shifts').insert([{
            restaurant_id: restId,
            employee_id: empId,
            start_time: start,
            end_time: end,
            position: 'Cook',
            status: 'scheduled',
            break_duration: 30,
            is_published: false,
            locked: false,
          }]);
          if (error) throw new Error(error.message);
        })();
      },
      { restId: restaurantId, empId: daveId },
    );

    // Navigate to Scheduling page
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Departing Dave should be visible (inactive but has shifts this week)
    await expect(page.getByText('Departing Dave').first()).toBeVisible({ timeout: 10000 });

    // The "Inactive" badge should be visible next to Dave's name in the table row
    const daveRow = page.locator('tr', { hasText: 'Departing Dave' });
    await expect(daveRow.getByText('Inactive')).toBeVisible();

    // Active Alice should also be visible
    await expect(page.getByText('Active Alice').first()).toBeVisible({ timeout: 5000 });
  });
});
