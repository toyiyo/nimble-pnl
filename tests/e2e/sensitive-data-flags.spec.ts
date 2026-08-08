import { expect, test } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// A role without view:pay_rates opens the roster and sees no pay.
//
// The gate is in Postgres, so the check that matters is the response body, not
// the rendered text. A client-only gate would still ship the rate over the
// wire, and this role is collaborator-flavored — an external person who can
// call PostgREST with their own token.
test('a role without view:pay_rates receives no rate from PostgREST', async ({ page }) => {
  const member = generateTestUser('no-pay-member');
  const owner = generateTestUser('no-pay-owner');

  // 1. Sign the member up first, purely to mint a real auth.users row — the
  //    membership row's user_id is a foreign key, so it cannot be faked.
  await page.goto('/auth');
  await exposeSupabaseHelpers(page);
  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/full name/i).fill(member.fullName);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const memberUserId = await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });
  expect(memberUserId).toBeTruthy();

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Owner seeds: a custom role holding only the scheduling area (no
  //    view:pay_rates, no view:employee_pii role_flags row at all), the
  //    member's membership on that role, and one employee row with a real
  //    rate and a real email — proof of what a leak would look like.
  const roleName = `Scheduler ${Date.now()}`;
  await page.evaluate(
    async ({ memberUserId, roleName }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({ restaurant_id: restaurantId, name: roleName, flavor: 'collaborator', builtin: false })
        .select('id')
        .single();
      if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

      const { error: areaError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'scheduling', level: 'view' });
      if (areaError) throw new Error(`area insert failed: ${areaError.message}`);

      const { error: memberError } = await supabase.from('user_restaurants').insert({
        user_id: memberUserId,
        restaurant_id: restaurantId,
        role: 'collaborator_custom',
        role_id: role.id,
      });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);

      const { error: employeeError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        name: 'Rate Carrier',
        email: 'rate-carrier@example.com',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 1800,
      });
      if (employeeError) throw new Error(`employee insert failed: ${employeeError.message}`);
    },
    { memberUserId, roleName }
  );

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 4. Sign in as the member — a real credentialed session, not the owner's.
  await page.goto('/auth');
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15000 });

  // Some other query on the page (the caller's own self-scope employee
  // lookup) also hits employees_secure, via `.single()`, and 406s here
  // because this member has no linked employee record. That is a
  // different request from the roster fetch this test cares about, so
  // only keep responses whose body is a row array — the roster shape.
  const bodies: unknown[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/rest/v1/employees_secure')) {
      const json = await response.json().catch(() => null);
      if (Array.isArray(json)) bodies.push(json);
    }
  });

  // Wait for the roster fetch specifically — the row-array shape, not the
  // caller's own `.single()` self-scope lookup on the same table.
  const rosterResponse = page.waitForResponse(async (response) => {
    if (!response.url().includes('/rest/v1/employees_secure')) return false;
    const json = await response.json().catch(() => null);
    return Array.isArray(json);
  }, { timeout: 10000 });
  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: /schedule/i })).toBeVisible({ timeout: 10000 });
  await rosterResponse;

  const rows = bodies.flat().filter(Boolean) as Array<Record<string, unknown>>;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.hourly_rate).toBeNull();
    expect(row.email).toBeNull();
  }
});
