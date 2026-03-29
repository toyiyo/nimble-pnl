import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

// WindowWithHelpers type for browser-context evaluate calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = Window & { __getRestaurantId: () => Promise<string>; __insertEmployees: (r: any[], id: string) => Promise<any[]>; __supabase: any };

test.describe('Scheduling - Inactive Employee Visibility', () => {
  test('hides inactive employees without shifts from the schedule grid', async ({ page }) => {
    const testUser = generateTestUser('sched-inactive');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as Win).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ emps, restId }) => (window as unknown as Win).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Active Alice', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Active Bob', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
          { name: 'Inactive Carol', position: 'Server', status: 'inactive', is_active: false, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    const aliceId = await page.evaluate(
      ({ restId }) => {
        const supabase = (window as unknown as Win).__supabase;
        return (async () => {
          const { data } = await supabase.from('employees').select('id').eq('restaurant_id', restId).eq('name', 'Active Alice').single();
          return data?.id;
        })();
      },
      { restId: restaurantId },
    );

    await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as unknown as Win).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
        const end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();
        return (async () => {
          const { error } = await supabase.from('shifts').insert([{
            restaurant_id: restId, employee_id: empId,
            start_time: start, end_time: end,
            position: 'Server', status: 'scheduled',
            break_duration: 30, is_published: false, locked: false,
          }]);
          if (error) throw new Error(error.message);
        })();
      },
      { restId: restaurantId, empId: aliceId },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await expect(page.getByText('Active Alice').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active Bob').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Inactive Carol')).not.toBeVisible();
  });

  test('shows inactive employees with scheduled shifts and displays Inactive badge', async ({ page }) => {
    const testUser = generateTestUser('sched-inactive-badge');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as Win).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employees = await page.evaluate(
      ({ emps, restId }) => (window as unknown as Win).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Active Alice', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Departing Dave', position: 'Cook', status: 'inactive', is_active: false, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    const daveId = (employees as { id: string; name: string }[]).find(e => e.name === 'Departing Dave')?.id;
    if (!daveId) throw new Error('Could not find Departing Dave');

    await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as unknown as Win).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 9, 0, 0).toISOString();
        const end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 17, 0, 0).toISOString();
        return (async () => {
          const { error } = await supabase.from('shifts').insert([{
            restaurant_id: restId, employee_id: empId,
            start_time: start, end_time: end,
            position: 'Cook', status: 'scheduled',
            break_duration: 30, is_published: false, locked: false,
          }]);
          if (error) throw new Error(error.message);
        })();
      },
      { restId: restaurantId, empId: daveId },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await expect(page.getByText('Departing Dave').first()).toBeVisible({ timeout: 10000 });

    const daveRow = page.getByRole('row', { name: /Departing Dave/i });
    await expect(daveRow.getByText('Inactive')).toBeVisible();

    await expect(page.getByText('Active Alice').first()).toBeVisible({ timeout: 5000 });
  });

  test('hides inactive employees whose only shifts are cancelled', async ({ page }) => {
    const testUser = generateTestUser('sched-inactive-cancel');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as Win).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employees = await page.evaluate(
      ({ emps, restId }) => (window as unknown as Win).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Active Alice', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Cancelled Carl', position: 'Cook', status: 'inactive', is_active: false, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    const carlId = (employees as { id: string; name: string }[]).find(e => e.name === 'Cancelled Carl')?.id;
    if (!carlId) throw new Error('Could not find Cancelled Carl');
    const aliceId = (employees as { id: string; name: string }[]).find(e => e.name === 'Active Alice')?.id;

    // Seed a CANCELLED shift for Carl — he should NOT appear in the grid
    await page.evaluate(
      ({ restId, carlEmpId, aliceEmpId }) => {
        const supabase = (window as unknown as Win).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        return (async () => {
          const carlStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 9, 0, 0).toISOString();
          const carlEnd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 15, 0, 0).toISOString();
          const aliceStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
          const aliceEnd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();
          const { error } = await supabase.from('shifts').insert([
            { restaurant_id: restId, employee_id: carlEmpId, start_time: carlStart, end_time: carlEnd, position: 'Cook', status: 'cancelled', break_duration: 30, is_published: false, locked: false },
            { restaurant_id: restId, employee_id: aliceEmpId, start_time: aliceStart, end_time: aliceEnd, position: 'Server', status: 'scheduled', break_duration: 30, is_published: false, locked: false },
          ]);
          if (error) throw new Error(error.message);
        })();
      },
      { restId: restaurantId, carlEmpId: carlId, aliceEmpId: aliceId },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await expect(page.getByText('Active Alice').first()).toBeVisible({ timeout: 10000 });
    // Cancelled Carl should NOT have a row in the schedule grid (inactive + only cancelled shifts)
    const scheduleTable = page.locator('table');
    await expect(scheduleTable.getByRole('row', { name: /Cancelled Carl/i })).not.toBeVisible();
  });
});
